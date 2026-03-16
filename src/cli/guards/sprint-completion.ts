import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadSprintState, saveSprintState, updateGate, isSprintComplete, pendingGates } from '../sprint-state.js';

/**
 * Sprint-completion guard: enforces post-implementation gates.
 *
 * Single handler, three hook points (branches on hook_event_name):
 * - PreToolUse:Bash — blocks `gh pr create` if gates incomplete
 * - Stop — blocks session end if mid-sprint with incomplete gates
 * - PostToolUse:Bash — auto-detects test pass and marks gate
 */
export async function sprintCompletionGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const event = input.hook_event_name;

  if (event === 'PreToolUse') {
    return handlePreToolUse(input, cwd);
  }

  if (event === 'Stop') {
    return handleStop(cwd);
  }

  if (event === 'PostToolUse') {
    return handlePostToolUse(input, cwd);
  }

  return {};
}

/** Check if sprint-state matches the current branch. Returns a warning string or null. */
function checkStaleness(sprint: number, cwd: string): string | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
    // Match patterns like S22, s22, sprint-22, worktree-s22-*
    const branchMatch = branch.match(/(?:^|[-/])s(?:print-?)?(\d+)/i);
    if (branchMatch) {
      const branchSprint = parseInt(branchMatch[1], 10);
      if (branchSprint !== sprint) {
        return `Warning: sprint-state is for Sprint ${sprint} but branch "${branch}" suggests Sprint ${branchSprint}. Run \`slope sprint reset\` if stale.`;
      }
    }
    // No sprint number in branch name — can't verify, don't warn
  } catch {
    // git not available — skip check
  }
  return null;
}

/** Block `gh pr create` when gates are incomplete or scorecard is missing. */
function handlePreToolUse(input: HookInput, cwd: string): GuardResult {
  const command = input.tool_input?.command as string | undefined;
  if (!command || !command.includes('gh pr create')) return {};

  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.phase === 'complete') return {}; // Sprint fully complete — skip all checks

  // Check scorecard existence independently of gates
  const scorecardMissing = !scorecardExists(state.sprint, cwd);
  const gatesComplete = isSprintComplete(state);

  if (gatesComplete && !scorecardMissing) return {};

  const staleWarning = checkStaleness(state.sprint, cwd);
  const lines: string[] = [];

  if (scorecardMissing) {
    lines.push(
      `SLOPE sprint-completion: Cannot create PR — Sprint ${state.sprint} scorecard not found.`,
      '',
      'Create a scorecard and validate it:',
      '  - `slope auto-card` — generate from git + CI signals',
      '  - `slope validate` — validate scorecard (marks gate complete)',
    );
  }

  if (!gatesComplete) {
    const pending = pendingGates(state);
    if (lines.length > 0) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} has incomplete gates:`,
      ...pending.map(g => `  - ${g}`),
      '',
      'Complete these gates before creating the PR.',
    );
  }

  if (staleWarning) lines.push('', staleWarning);
  return {
    decision: 'deny',
    blockReason: lines.join('\n'),
  };
}

/** Block session end when mid-sprint with incomplete gates or missing scorecard. */
function handleStop(cwd: string): GuardResult {
  const state = loadSprintState(cwd);
  if (!state) return {};

  // Only block during implementing/scoring phases — don't block during planning/reviewing
  if (state.phase !== 'implementing' && state.phase !== 'scoring') return {};

  const scorecardMissing = !scorecardExists(state.sprint, cwd);
  const gatesComplete = isSprintComplete(state);

  if (gatesComplete && !scorecardMissing) return {};

  const staleWarning = checkStaleness(state.sprint, cwd);
  const lines: string[] = [];

  if (scorecardMissing) {
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} scorecard not found.`,
      '',
      'Create a scorecard before ending the session:',
      '  - `slope auto-card` — generate from git + CI signals',
      '  - `slope validate` — validate scorecard (marks gate complete)',
    );
  }

  if (!gatesComplete) {
    const pending = pendingGates(state);
    if (lines.length > 0) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} is incomplete. Remaining gates:`,
      ...pending.map(g => `  - ${g}`),
      '',
      'Complete these before ending the session:',
      '  - `slope sprint gate tests` — mark tests passing',
      '  - `slope sprint gate code_review` — mark code review done',
      '  - `slope sprint gate architect_review` — mark architect review done',
      '  - `slope validate` — validates scorecard (auto-marks gate)',
      '  - `slope review` — generates review markdown (auto-marks gate)',
      '',
      'Or use `slope sprint reset` to clear sprint state if this sprint was abandoned.',
    );
  }

  if (staleWarning) lines.push('', staleWarning);
  return { blockReason: lines.join('\n') };
}

/** Check if a scorecard file exists for the given sprint. */
function scorecardExists(sprint: number, cwd: string): boolean {
  const config = loadConfig(cwd);
  const pattern = config.scorecardPattern.replace('*', String(sprint));
  const scorecardPath = join(cwd, config.scorecardDir, pattern);
  return existsSync(scorecardPath);
}

/** Auto-detect test pass, validate success, and PR merge from Bash output. */
function handlePostToolUse(input: HookInput, cwd: string): GuardResult {
  const command = input.tool_input?.command as string | undefined;
  if (!command) return {};

  // Detect PR merge → transition to scoring phase
  if (/gh\s+pr\s+merge/.test(command)) {
    return handlePrMerge(input, cwd);
  }

  // Detect slope validate success → auto-update roadmap
  if (/\bslope\s+validate\b/.test(command)) {
    return handleValidateSuccess(input, cwd);
  }

  // Detect slope review completion → mark review_md gate
  if (/\bslope\s+review\b/.test(command) && !/\bslope\s+review\s+(start|round|status|reset|recommend|findings|amend|defer|deferred|resolve)\b/.test(command)) {
    return handleReviewCompletion(input, cwd);
  }

  // Detect slope auto-card completion → suggest validate next
  if (/\bslope\s+auto-card\b/.test(command)) {
    return handleAutoCardCompletion(input, cwd);
  }

  // Check if command looks like a test runner
  const isTestCommand = /\b(jest|vitest|bun\s+test|npx\s+jest|npx\s+vitest)\b/.test(command);
  if (!isTestCommand) return {};

  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.gates.tests) return {}; // Already marked

  // Check exit code — tool_response for Bash includes exit_code or stdout
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;

  // If exit code is explicitly 0, or if stdout contains pass indicators without failures
  if (exitCode === 0 || exitCode === '0') {
    updateGate(cwd, 'tests', true);
    return { context: 'SLOPE: Tests passed — gate marked complete.' };
  }

  return {};
}

/** Auto-update roadmap status when `slope validate` succeeds. */
function handleValidateSuccess(input: HookInput, cwd: string): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};

  const config = loadConfig(cwd);
  const roadmapPath = join(cwd, config.roadmapPath);
  if (!existsSync(roadmapPath)) return {};

  try {
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    if (!raw || !Array.isArray(raw.sprints)) return {};

    const sprint = raw.sprints.find((s: { id: number }) => s.id === state.sprint);
    if (!sprint || sprint.status === 'complete') return {};

    sprint.status = 'complete';

    // Also update phase status if all sprints in a phase are now complete
    if (Array.isArray(raw.phases)) {
      for (const phase of raw.phases) {
        if (!Array.isArray(phase.sprints) || !phase.sprints.includes(state.sprint)) continue;
        const allComplete = phase.sprints.every((sid: number) => {
          const s = raw.sprints.find((sp: { id: number }) => sp.id === sid);
          return s?.status === 'complete';
        });
        if (allComplete && phase.status !== 'complete') {
          phase.status = 'complete';
        }
      }
    }

    writeFileSync(roadmapPath, JSON.stringify(raw, null, 2) + '\n');
    return { context: `SLOPE: Updated roadmap — Sprint ${state.sprint} → complete` };
  } catch {
    return {};
  }
}

/** Detect `slope review` completion → mark review_md gate. */
function handleReviewCompletion(input: HookInput, cwd: string): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.gates.review_md) return {}; // Already marked

  updateGate(cwd, 'review_md', true);
  return { context: 'SLOPE: Review generated — gate marked complete.' };
}

/** Detect `slope auto-card` completion → suggest validate next. */
function handleAutoCardCompletion(input: HookInput, cwd: string): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};

  return { context: 'SLOPE: Scorecard generated. Run `slope validate` to verify and mark the scorecard gate complete.' };
}

/** Transition sprint to scoring phase after PR merge. */
function handlePrMerge(input: HookInput, cwd: string): GuardResult {
  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.phase === 'scoring' || state.phase === 'complete') return {};

  // Check merge succeeded (exit code 0)
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0' && exitCode !== undefined) return {};

  state.phase = 'scoring';
  saveSprintState(cwd, state);

  const pending = pendingGates(state);
  return {
    context: [
      `SLOPE: PR merged — sprint phase is now 'scoring'. Remaining gates:`,
      ...pending.map(g => `  - ${g}`),
      '',
      'Complete these before ending the session:',
      '  1. Create scorecard → `slope validate`',
      '  2. Generate review → `slope review`',
    ].join('\n'),
  };
}
