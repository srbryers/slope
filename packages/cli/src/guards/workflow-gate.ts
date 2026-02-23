import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '@srbryers/core';

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

  if (state.rounds_completed >= state.rounds_required) return {};

  const planRef = state.plan_file ? ` (${state.plan_file})` : '';
  return {
    decision: 'deny',
    blockReason: `SLOPE workflow-gate: Review incomplete. ${state.rounds_completed}/${state.rounds_required} rounds done${planRef}. Complete remaining review rounds before exiting plan mode.`,
  };
}
