import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, SlopeConfig, WorkflowExecution } from '../../core/index.js';
import { formatSprintLabel, loadWorkflow, parseSprintNumber } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { SqliteSlopeStore } from '../../store/index.js';
import { inferSprintContext } from '../sprint-inference.js';
import { inferSprintFromBranch, reconcileWorkflowExecutions } from '../workflow-resync.js';

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
    const resync = await reconcileWorkflowExecutions(cwd, store, { includeNewerRunning: false });
    const active = await store.listExecutions({ status: 'running' });
    if (active.length === 0) return resyncContext(resync);

    const exec = selectWorkflowExecution(active, input, cwd, config);
    if (!exec) {
      return withAdditionalContext(
        resyncContext(resync),
        'SLOPE workflow-step-gate: multiple running workflow executions; no session, branch, or sprint match, so edits are allowed.',
      );
    }

    if (!exec.current_phase || !exec.current_step) return resyncContext(resync);

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

    if (!stepType || stepType === 'agent_work') return resyncContext(resync);

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

function selectWorkflowExecution(
  active: WorkflowExecution[],
  input: HookInput,
  cwd: string,
  config: SlopeConfig,
): WorkflowExecution | null {
  const sprintLabels = sprintLabelsForContext(cwd, config);
  const sessionId = input.session_id?.trim();
  if (sessionId && sprintLabels.length > 0) {
    const bySessionAndSprint = active.find(exec =>
      exec.session_id === sessionId && sprintLabels.some(label => sprintIdsMatch(exec.sprint_id, label)),
    );
    if (bySessionAndSprint) return bySessionAndSprint;
  }

  for (const label of sprintLabels) {
    const bySprint = active.find(exec => sprintIdsMatch(exec.sprint_id, label));
    if (bySprint) return bySprint;
  }

  if (sessionId) {
    const bySession = active.find(exec => exec.session_id === sessionId);
    if (bySession) return bySession;
  }

  return active.length === 1 ? active[0] : null;
}

function sprintLabelsForContext(cwd: string, config: SlopeConfig): string[] {
  const labels = new Set<string>();
  const branchSprint = inferSprintFromBranch(cwd);
  if (branchSprint !== null) labels.add(formatSprintLabel(branchSprint));

  try {
    const inferred = inferSprintContext(cwd, config);
    if (inferred.source !== 'initial') labels.add(inferred.label);
  } catch {
    // Sprint inference is advisory for this guard; ambiguity should fail open.
  }

  return [...labels];
}

function sprintIdsMatch(left: string | undefined, right: string): boolean {
  const normalizedLeft = normalizeSprintLabel(left);
  const normalizedRight = normalizeSprintLabel(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

function normalizeSprintLabel(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = parseSprintNumber(value);
  return parsed === null ? value.trim().toUpperCase() : formatSprintLabel(parsed).toUpperCase();
}

function resyncContext(result: Awaited<ReturnType<typeof reconcileWorkflowExecutions>>): GuardResult {
  const lines: string[] = [];
  if (result.paused.length > 0) lines.push(`SLOPE workflow-step-gate: paused ${result.paused.length} stale workflow execution(s).`);
  if (result.fastForwarded.length > 0) {
    lines.push(...result.fastForwarded.map(item =>
      `SLOPE workflow-step-gate: fast-forwarded ${item.exec.sprint_id ?? item.exec.id} to ${item.phase}/${item.step}.`,
    ));
  }
  return lines.length > 0 ? { context: lines.join('\n') } : {};
}

function withAdditionalContext(result: GuardResult, context: string): GuardResult {
  return {
    ...result,
    context: [result.context, context].filter(Boolean).join('\n'),
  };
}
