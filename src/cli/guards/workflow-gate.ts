import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadSprintState, saveSprintState } from '../sprint-state.js';

interface ReviewState {
  rounds_required: number;
  rounds_completed: number;
  plan_file?: string;
}

/**
 * Workflow gate guard: fires PreToolUse on ExitPlanMode.
 * Blocks ExitPlanMode until review rounds are complete.
 */
export async function workflowGateGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const statePath = join(cwd, '.slope', 'review-state.json');

  if (!existsSync(statePath)) return {};

  let state: ReviewState;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    // Malformed JSON — don't block on bad data
    return {};
  }

  // Validate shape
  if (typeof state.rounds_required !== 'number' || typeof state.rounds_completed !== 'number') {
    return {};
  }

  if (state.rounds_completed >= state.rounds_required) {
    // Transition sprint-state to implementing when review is complete
    const sprintState = loadSprintState(cwd);
    if (sprintState && (sprintState.phase === 'planning' || sprintState.phase === 'reviewing')) {
      sprintState.phase = 'implementing';
      saveSprintState(cwd, sprintState);
    }
    return {};
  }

  const remaining = state.rounds_required - state.rounds_completed;
  return {
    decision: 'deny',
    blockReason: [
      `SLOPE workflow-gate: Review incomplete (${state.rounds_completed}/${state.rounds_required} rounds). You MUST:`,
      `1. Ask the user to confirm or change the review tier (slope review start --tier=<tier>)`,
      `2. Conduct each review round, then run \`slope review round\` after each`,
      `3. Only call ExitPlanMode after all ${remaining} remaining round${remaining !== 1 ? 's are' : ' is'} complete`,
      ``,
      `To skip reviews: run \`slope review start --tier=skip\``,
    ].join('\n'),
  };
}
