import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult, SlopeConfig, Suggestion } from '../../core/index.js';
import { loadConfig, loadScorecards, detectLatestSprint, parseRoadmap, formatStrategicContext } from '../../core/index.js';
import { resolveStore } from '../store.js';
import { loadFindings } from '../commands/review-state.js';
import { loadSprintState } from '../sprint-state.js';
import { getActiveWorktrees } from './git-utils.js';

/** Sprint state types for next-action detection */
type SprintState =
  | { type: 'mid-sprint'; sprintNumber: number; claimCount: number; targets: string[] }
  | { type: 'sprint-complete'; sprintNumber: number }
  | { type: 'needs-review'; sprintNumber: number }
  | { type: 'needs-amend'; sprintNumber: number; findingCount: number }
  | { type: 'testing-active' }
  | { type: 'between-sprints'; roadmapContext?: string }
  | { type: 'worktrees-active'; worktreeCount: number; branches: string[] };

/**
 * Next-action guard: fires on Stop.
 * Suggests next actions before session end based on sprint state.
 */
export async function nextActionGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Re-prompt prevention: check if we already prompted this session
  const slopeDir = join(cwd, '.slope');
  const stateFile = join(slopeDir, '.next-action-prompted');

  if (input.session_id) {
    try {
      if (existsSync(stateFile)) {
        const raw = JSON.parse(readFileSync(stateFile, 'utf8'));
        if (raw.session_id === input.session_id) {
          return {};
        }
      }
    } catch { /* corrupted state file — proceed */ }
  }

  // Detect sprint state
  const state = await detectSprintState(cwd, input.session_id);

  // Build structured suggestion
  const suggestion = buildSuggestionObject(state);

  // Write state file atomically
  try {
    mkdirSync(slopeDir, { recursive: true });
    const tmpPath = join(slopeDir, '.next-action-prompted.tmp');
    const json = JSON.stringify({
      session_id: input.session_id,
      prompted_at: new Date().toISOString(),
    });
    writeFileSync(tmpPath, json);
    renameSync(tmpPath, stateFile);
  } catch { /* best-effort — don't fail the guard */ }

  return { suggestion };
}

/** Detect current sprint state via store then filesystem fallback */
export async function detectSprintState(cwd: string, sessionId?: string): Promise<SprintState> {
  // If sprint-state.json exists and sprint is active, defer to sprint-completion guard.
  // That guard handles the hard block on Stop with gate-level detail.
  // next-action returns between-sprints to avoid duplicate messaging.
  const sprintState = loadSprintState(cwd);
  if (sprintState && sprintState.phase !== 'complete') {
    let config: SlopeConfig;
    try {
      config = loadConfig(cwd);
    } catch {
      return { type: 'between-sprints' };
    }
    return buildBetweenSprints(config, cwd, sprintState.sprint);
  }

  // Try store for active testing session + claims (single connection)
  let claimsFromStore: { sprint_number: number; target: string }[] | null = null;
  try {
    const store = await resolveStore(cwd);
    try {
      // Check for active testing session
      const testingSession = await store.getActiveTestingSession();
      if (testingSession) {
        return { type: 'testing-active' };
      }

      const allClaims = await store.getActiveClaims();
      // If session_id is available, filter to claims for this session only
      const claims = sessionId
        ? allClaims.filter(c => c.session_id === sessionId)
        : allClaims;
      if (claims.length > 0) {
        const sprintNumber = Math.max(...claims.map(c => c.sprint_number));
        return {
          type: 'mid-sprint',
          sprintNumber,
          claimCount: claims.length,
          targets: claims.map(c => c.target),
        };
      }
      claimsFromStore = claims;
    } finally {
      store.close();
    }
  } catch {
    // Store unavailable — try filesystem fallback
    try {
      const claimsPath = join(cwd, '.slope', 'claims.json');
      if (existsSync(claimsPath)) {
        const raw = JSON.parse(readFileSync(claimsPath, 'utf8'));
        if (Array.isArray(raw) && raw.length > 0) {
          const sprintNumber = Math.max(...raw.map((c: { sprint_number?: number }) => c.sprint_number ?? 0));
          return {
            type: 'mid-sprint',
            sprintNumber,
            claimCount: raw.length,
            targets: raw.map((c: { target?: string }) => c.target ?? 'unknown'),
          };
        }
      }
    } catch { /* filesystem fallback failed */ }
  }

  // Load config and scorecards for remaining checks
  let config: SlopeConfig;
  try {
    config = loadConfig(cwd);
  } catch {
    return { type: 'between-sprints' };
  }

  const latestScoredSprint = detectLatestSprint(config, cwd);

  // If no claims and no scorecards, we're between sprints
  if (latestScoredSprint === 0 && (claimsFromStore === null || claimsFromStore.length === 0)) {
    return buildBetweenSprints(config, cwd, 0);
  }

  // Check if the latest sprint has a review
  if (latestScoredSprint > 0) {
    const retrosDir = join(cwd, config.scorecardDir);
    const reviewPath = join(retrosDir, `sprint-${latestScoredSprint}-review.md`);
    if (!existsSync(reviewPath)) {
      return { type: 'needs-review', sprintNumber: latestScoredSprint };
    }

    // Check if findings exist but scorecard hasn't been amended
    const findingsData = loadFindings(cwd);
    if (findingsData && findingsData.findings.length > 0) {
      try {
        // Check if scorecard already has review hazards
        const scorecardPath = join(retrosDir, `sprint-${latestScoredSprint}.json`);
        if (existsSync(scorecardPath)) {
          const scorecard = JSON.parse(readFileSync(scorecardPath, 'utf8'));
          const hasReviewHazards = scorecard.shots?.some((s: { hazards?: Array<{ gotcha_id?: string }> }) =>
            s.hazards?.some((h: { gotcha_id?: string }) => h.gotcha_id?.startsWith('review:')),
          );
          if (!hasReviewHazards) {
            return {
              type: 'needs-amend',
              sprintNumber: latestScoredSprint,
              findingCount: findingsData.findings.length,
            };
          }
        }
      } catch { /* scorecard parse error — skip */ }
    }
  }

  // Default: between sprints
  return buildBetweenSprints(config, cwd, latestScoredSprint);
}

/** Build between-sprints state with optional roadmap context */
function buildBetweenSprints(config: SlopeConfig, cwd: string, latestSprint: number): SprintState {
  let roadmapContext: string | undefined;
  try {
    if (config.roadmapPath) {
      const roadmapFile = join(cwd, config.roadmapPath);
      if (existsSync(roadmapFile)) {
        const raw = JSON.parse(readFileSync(roadmapFile, 'utf8'));
        const { roadmap } = parseRoadmap(raw);
        if (roadmap) {
          const nextSprint = latestSprint + 1;
          const ctx = formatStrategicContext(roadmap, nextSprint);
          if (ctx) roadmapContext = ctx;
        }
      }
    }
  } catch { /* roadmap parsing failed — proceed without context */ }

  // Check for active agent worktrees before declaring "between sprints"
  const worktrees = getActiveWorktrees(cwd);
  if (worktrees.length > 0) {
    return {
      type: 'worktrees-active',
      worktreeCount: worktrees.length,
      branches: worktrees.map(w => w.branch),
    };
  }

  return { type: 'between-sprints', roadmapContext };
}

/** Build structured Suggestion from sprint state */
export function buildSuggestionObject(state: SprintState): Suggestion {
  switch (state.type) {
    case 'mid-sprint': {
      const targetList = state.targets.join(', ');
      return {
        id: 'next-action-mid-sprint',
        title: 'Next Action',
        context: `Mid-sprint — ${state.claimCount} active claim(s) for sprint ${state.sprintNumber}: ${targetList}`,
        options: [
          { id: 'continue', label: 'Continue with the next ticket' },
          { id: 'push-break', label: 'Push and take a break', description: 'Resume later' },
          { id: 'end', label: 'End session', description: 'Nothing more to do right now' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };
    }

    case 'sprint-complete':
      return {
        id: 'next-action-complete',
        title: 'Next Action',
        context: `Sprint ${state.sprintNumber} is complete but unscored`,
        options: [
          { id: 'score', label: 'Score the sprint', description: 'Run post-hole routine' },
          { id: 'validate', label: 'Validate scorecard', command: 'slope validate' },
          { id: 'distill', label: 'Distill learnings', command: 'slope distill --auto' },
          { id: 'end', label: 'End session', description: 'Nothing more to do right now' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };

    case 'needs-review':
      return {
        id: 'next-action-review',
        title: 'Next Action',
        context: `Sprint ${state.sprintNumber} has a scorecard but no review`,
        options: [
          { id: 'review', label: 'Generate sprint review', command: 'slope review' },
          { id: 'distill', label: 'Distill learnings', command: 'slope distill --auto' },
          { id: 'end', label: 'End session', description: 'Nothing more to do right now' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };

    case 'needs-amend':
      return {
        id: 'next-action-amend',
        title: 'Next Action',
        context: `Sprint ${state.sprintNumber} has ${state.findingCount} review finding(s) not yet applied to scorecard`,
        options: [
          { id: 'amend', label: 'Apply findings to scorecard', command: 'slope review amend' },
          { id: 'list', label: 'View findings first', command: 'slope review findings list' },
          { id: 'end', label: 'End session', description: 'Nothing more to do right now' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };

    case 'testing-active':
      return {
        id: 'next-action-testing',
        title: 'Next Action',
        context: 'Testing session active',
        options: [
          { id: 'continue', label: 'Continue testing' },
          { id: 'end-testing', label: 'End testing session' },
          { id: 'end', label: 'End session', description: 'Nothing more to do right now' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };

    case 'worktrees-active':
      return {
        id: 'next-action-worktrees',
        title: 'Next Action',
        context: `${state.worktreeCount} agent worktree(s) active: ${state.branches.join(', ')}. Sprint work in progress.`,
        options: [
          { id: 'dashboard', label: 'View agent dashboard', command: 'slope session dashboard' },
          { id: 'wait', label: 'Wait for agents to finish' },
          { id: 'end', label: 'End session', description: 'Agents will continue in worktrees' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };

    case 'between-sprints': {
      const contextLine = state.roadmapContext
        ? `\n${state.roadmapContext}`
        : '';
      return {
        id: 'next-action-between',
        title: 'Next Action',
        context: `No active sprint${contextLine}`,
        options: [
          { id: 'roadmap', label: 'Check next sprint candidates' },
          { id: 'start', label: 'Start a new sprint' },
          { id: 'briefing', label: 'Run briefing', command: 'slope briefing' },
          { id: 'end', label: 'End session', description: 'Nothing more to do right now' },
        ],
        requiresDecision: false,
        priority: 'normal',
      };
    }
  }
}

/** @deprecated Use buildSuggestionObject instead. Kept for backward compatibility. */
export function buildSuggestions(state: SprintState): string {
  const suggestion = buildSuggestionObject(state);
  const lines = [`SLOPE ${suggestion.title}: ${suggestion.context}`, '', 'Suggested options:'];
  for (let i = 0; i < suggestion.options.length; i++) {
    const opt = suggestion.options[i];
    const desc = opt.description ? ` — ${opt.description}` : '';
    lines.push(`${i + 1}. ${opt.label}${desc}`);
  }
  lines.push('', 'Present these using AskUserQuestion. If the user chooses to end the session, stop without further action.');
  return lines.join('\n');
}
