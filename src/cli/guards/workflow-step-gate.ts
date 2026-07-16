import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HookInput, GuardResult, SlopeConfig, WorkflowExecution } from '../../core/index.js';
import { formatSprintLabel, loadWorkflow, parseSprintNumber } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { SqliteSlopeStore } from '../../store/index.js';
import { inferSprintContext } from '../sprint-inference.js';
import { inferSprintFromBranch, reconcileWorkflowExecutions, sprintLabelForExecution } from '../workflow-resync.js';

/**
 * Workflow-step-gate guard: fires PreToolUse on Edit/Write.
 * Blocks file edits when a workflow execution is active and
 * the current step type is not `agent_work`.
 */
export async function workflowStepGateGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Workflow steps only govern this repository; edits to files outside the
  // project root (agent memory dirs, other checkouts) are never gated. (#621)
  const targetPath = input.tool_input?.file_path as string | undefined;
  if (targetPath && !isWithinRepo(cwd, targetPath)) return {};

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
        noMatchingExecutionContext(active),
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
        `If this execution is abandoned, run \`slope sprint workflow resync\` or \`slope sprint workflow cleanup --stale\`.`,
      ].join('\n'),
    };
  } catch {
    // Store open failure — don't block
    return {};
  } finally {
    store?.close();
  }
}

function isWithinRepo(cwd: string, path: string): boolean {
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), resolved);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
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
      exec.session_id === sessionId && sprintLabels.some(label => executionMatchesSprint(exec, label)),
    );
    if (bySessionAndSprint) return bySessionAndSprint;
  }

  for (const label of sprintLabels) {
    const bySprint = active.find(exec => executionMatchesSprint(exec, label));
    if (bySprint) return bySprint;
  }

  if (sessionId && sprintLabels.length === 0) {
    const bySession = active.find(exec => exec.session_id === sessionId);
    if (bySession) return bySession;
  }

  if (sprintLabels.length > 0) return null;
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

function executionMatchesSprint(exec: WorkflowExecution, label: string): boolean {
  return sprintIdsMatch(sprintLabelForExecution(exec), label);
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

function noMatchingExecutionContext(active: WorkflowExecution[]): string {
  if (active.length === 1) {
    const exec = active[0];
    return [
      `SLOPE workflow-step-gate: running workflow execution ${sprintLabelForExecution(exec)} (${exec.workflow_name}) does not match the current sprint/session context, so edits are allowed.`,
      'Run `slope sprint workflow resync` or `slope sprint workflow cleanup --stale` if the execution is abandoned.',
    ].join('\n');
  }

  return [
    'SLOPE workflow-step-gate: multiple running workflow executions; no session, branch, or sprint match, so edits are allowed.',
    'Run `slope sprint workflow resync` or `slope sprint workflow cleanup --stale` if any execution is abandoned.',
  ].join('\n');
}

function resyncContext(result: Awaited<ReturnType<typeof reconcileWorkflowExecutions>>): GuardResult {
  const lines: string[] = [];
  if (result.paused.length > 0) lines.push(`SLOPE workflow-step-gate: paused ${result.paused.length} stale workflow execution(s).`);
  if (result.fastForwarded.length > 0) {
    lines.push(...result.fastForwarded.map(item =>
      `SLOPE workflow-step-gate: fast-forwarded ${sprintLabelForExecution(item.exec)} to ${item.phase}/${item.step}.`,
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
