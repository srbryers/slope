import type { HookInput, GuardResult } from '../../core/index.js';
import { loadSprintState, updateGate, isSprintComplete, pendingGates } from '../sprint-state.js';

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

/** Block `gh pr create` when gates are incomplete. */
function handlePreToolUse(input: HookInput, cwd: string): GuardResult {
  const command = input.tool_input?.command as string | undefined;
  if (!command || !command.includes('gh pr create')) return {};

  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.phase === 'complete' || isSprintComplete(state)) return {};

  const pending = pendingGates(state);
  return {
    decision: 'deny',
    blockReason: `SLOPE sprint-completion: Cannot create PR — Sprint ${state.sprint} has incomplete gates:\n${pending.map(g => `  - ${g}`).join('\n')}\n\nComplete these gates before creating the PR.`,
  };
}

/** Block session end when mid-sprint with incomplete gates. */
function handleStop(cwd: string): GuardResult {
  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.phase === 'complete' || isSprintComplete(state)) return {};

  // Only block during implementing/scoring phases — don't block during planning/reviewing
  if (state.phase !== 'implementing' && state.phase !== 'scoring') return {};

  const pending = pendingGates(state);
  return {
    blockReason: [
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
    ].join('\n'),
  };
}

/** Auto-detect test pass from Bash output and mark gate. */
function handlePostToolUse(input: HookInput, cwd: string): GuardResult {
  const command = input.tool_input?.command as string | undefined;
  if (!command) return {};

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
