import type { HookInput, GuardResult } from '@srbryers/core';
import { loadConfig } from '../config.js';

/**
 * Subagent gate guard: fires PreToolUse on Task.
 * Forces haiku model and caps max_turns on Explore/Plan subagents.
 */
export async function subagentGateGuard(input: HookInput, _cwd: string): Promise<GuardResult> {
  const toolInput = input.tool_input ?? {};
  const subagentType = toolInput.subagent_type as string | undefined;
  const model = toolInput.model as string | undefined;
  const maxTurns = toolInput.max_turns as number | undefined;
  const resume = toolInput.resume as string | undefined;

  // Exempt resumed agents — they inherit prior settings
  if (resume) return {};

  // Only gate Explore and Plan subagents
  if (subagentType !== 'Explore' && subagentType !== 'Plan') return {};

  const config = loadConfig();
  const guidance = config.guidance ?? {};
  const allowedModels = guidance.subagentAllowModels ?? ['haiku'];
  const turnsLimit = subagentType === 'Explore'
    ? (guidance.subagentExploreTurns ?? 10)
    : (guidance.subagentPlanTurns ?? 15);

  const violations: string[] = [];

  if (model && !allowedModels.includes(model)) {
    violations.push(`model "${model}" not in allowed list [${allowedModels.join(', ')}]`);
  }

  if (maxTurns === undefined || maxTurns > turnsLimit) {
    const current = maxTurns === undefined ? 'not set' : `${maxTurns}`;
    violations.push(`max_turns ${current}, limit is ${turnsLimit}`);
  }

  if (violations.length === 0) return {};

  return {
    decision: 'deny',
    blockReason: `SLOPE subagent-gate: ${subagentType} agent blocked — ${violations.join('; ')}. Resubmit with model: ${allowedModels[0]}, max_turns: ${turnsLimit}.`,
  };
}
