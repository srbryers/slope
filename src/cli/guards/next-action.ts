import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult, SlopeConfig } from '../../core/index.js';
import { loadConfig, loadScorecards, detectLatestSprint, parseRoadmap, formatStrategicContext } from '../../core/index.js';
import { resolveStore } from '../store.js';

/** Sprint state types for next-action detection */
type SprintState =
  | { type: 'mid-sprint'; sprintNumber: number; claimCount: number; targets: string[] }
  | { type: 'sprint-complete'; sprintNumber: number }
  | { type: 'needs-review'; sprintNumber: number }
  | { type: 'between-sprints'; roadmapContext?: string };

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
  const state = await detectSprintState(cwd);

  // Build suggestion text
  const suggestion = buildSuggestions(state);

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

  return { blockReason: suggestion };
}

/** Detect current sprint state via store then filesystem fallback */
export async function detectSprintState(cwd: string): Promise<SprintState> {
  // Try store first for active claims
  let claimsFromStore: { sprint_number: number; target: string }[] | null = null;
  try {
    const store = await resolveStore(cwd);
    try {
      const claims = await store.getActiveClaims();
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

  return { type: 'between-sprints', roadmapContext };
}

/** Build block reason text from sprint state */
export function buildSuggestions(state: SprintState): string {
  const header = 'SLOPE next-action: Before ending this session, present the user with options for what to do next.';

  switch (state.type) {
    case 'mid-sprint': {
      const targetList = state.targets.join(', ');
      return [
        header,
        '',
        `Current state: Mid-sprint — ${state.claimCount} active claim(s) for sprint ${state.sprintNumber}: ${targetList}`,
        '',
        'Suggested options:',
        '1. Continue with the next ticket',
        '2. Push and take a break — resume later',
        '3. End session — nothing more to do right now',
        '',
        'Present these using AskUserQuestion. If the user chooses to end the session, stop without further action.',
      ].join('\n');
    }

    case 'sprint-complete':
      return [
        header,
        '',
        `Current state: Sprint ${state.sprintNumber} is complete but unscored`,
        '',
        'Suggested options:',
        '1. Score the sprint — run post-hole routine',
        '2. Run `slope validate` on the scorecard',
        '3. Distill learnings into common issues',
        '4. End session — nothing more to do right now',
        '',
        'Present these using AskUserQuestion. If the user chooses to end the session, stop without further action.',
      ].join('\n');

    case 'needs-review': {
      return [
        header,
        '',
        `Current state: Sprint ${state.sprintNumber} has a scorecard but no review`,
        '',
        'Suggested options:',
        '1. Generate sprint review',
        '2. Distill learnings and update common issues',
        '3. Run `slope review` for the full sprint review',
        '4. End session — nothing more to do right now',
        '',
        'Present these using AskUserQuestion. If the user chooses to end the session, stop without further action.',
      ].join('\n');
    }

    case 'between-sprints': {
      const contextLine = state.roadmapContext
        ? `\n${state.roadmapContext}\n`
        : '';
      return [
        header,
        '',
        `Current state: No active sprint${contextLine}`,
        'Suggested options:',
        '1. Check next sprint candidates from the roadmap',
        '2. Start a new sprint',
        '3. Run `slope briefing` for a status overview',
        '4. End session — nothing more to do right now',
        '',
        'Present these using AskUserQuestion. If the user chooses to end the session, stop without further action.',
      ].join('\n');
    }
  }
}
