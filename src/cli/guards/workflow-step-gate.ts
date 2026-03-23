import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadWorkflow } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { SqliteSlopeStore } from '../../store/index.js';

/**
 * Workflow-step-gate guard: fires PreToolUse on Edit/Write.
 * Blocks file edits when a workflow execution is active and
 * the current step type is not `agent_work`.
 */
export async function workflowStepGateGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig(cwd);
  const storePath = join(cwd, config.store_path ?? '.slope/slope.db');
  if (!existsSync(storePath)) return {};

  // Note: opens SQLite on every invocation — heavier than file-based guards.
  // Acceptable for v1 since workflow executions live only in the store.
  // Future: consider a lightweight sidecar file written by the workflow engine.
  let store: SqliteSlopeStore | null = null;
  try {
    store = new SqliteSlopeStore(storePath);
    const active = await store.listExecutions({ status: 'running' });
    if (active.length === 0) return {};

    const exec = active[0];
    if (!exec.current_phase || !exec.current_step) return {};

    // Load the workflow definition to find the step's type
    let stepType: string | undefined;
    try {
      const workflow = loadWorkflow(exec.workflow_name, cwd);
      const phase = workflow.phases.find(p => p.id === exec.current_phase);
      const step = phase?.steps.find(s => s.id === exec.current_step);
      stepType = step?.type;
    } catch {
      // Workflow definition not found — don't block
      return {};
    }

    if (!stepType || stepType === 'agent_work') return {};

    return {
      decision: 'deny',
      blockReason: [
        `SLOPE workflow-step-gate: Current step "${exec.current_step}" (phase: ${exec.current_phase}) is type "${stepType}", not "agent_work".`,
        `File edits are only allowed during agent_work steps.`,
        `Complete the current ${stepType} step first via \`slope sprint run\` or workflow MCP tools.`,
      ].join('\n'),
    };
  } catch {
    // Store open failure — don't block
    return {};
  } finally {
    store?.close();
  }
}
