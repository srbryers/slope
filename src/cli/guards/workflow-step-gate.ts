import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HookInput, GuardResult, SlopeConfig, WorkflowExecution } from '../../core/index.js';
import { loadWorkflow, resolveRepoStatePath, sprintIdKey } from '../../core/index.js';
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
  const rawTarget = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const targetPath = typeof rawTarget === 'string' && rawTarget.trim() !== '' ? rawTarget : undefined;
  if (targetPath && !isWithinRepo(cwd, targetPath)) return {};

  const config = loadConfig(cwd);
  const storePath = resolveRepoStatePath(cwd, config.store_path ?? '.slope/slope.db');
  if (!existsSync(storePath)) return {};

  // Note: opens SQLite on every invocation — heavier than file-based guards.
  // Acceptable for v1 since workflow executions live only in the store.
  // Future: consider a lightweight sidecar file written by the workflow engine.
  let store: SqliteSlopeStore | null = null;
  try {
    store = new SqliteSlopeStore(storePath);
    const resync = await reconcileWorkflowExecutions(cwd, store, {
      includeNewerRunning: false,
      currentSessionId: input.session_id?.trim() || undefined,
    });
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
        `SLOPE workflow-step-gate: blocked by execution ${exec.id} for ${sprintLabelForExecution(exec)} (${exec.workflow_name}).`,
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
  // Compare real paths so symlinked roots (macOS /tmp) resolve consistently;
  // walk up to the nearest existing ancestor for not-yet-created targets.
  // On any resolution failure, treat the path as in-repo (gate stays active).
  try {
    const realCwd = realpathSync(resolve(cwd));
    let existing = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
    while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
    const rel = relative(realCwd, realpathSync(existing));
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
  } catch {
    return true;
  }
}

function selectWorkflowExecution(
  active: WorkflowExecution[],
  input: HookInput,
  cwd: string,
  config: SlopeConfig,
): WorkflowExecution | null {
  const sprintLabel = sprintLabelForContext(cwd, config);
  const sessionId = input.session_id?.trim();
  if (sprintLabel) {
    const sprintExecutions = active.filter(exec => executionMatchesSprint(exec, sprintLabel));
    const bySessionAndSprint = sessionId
      ? sprintExecutions.find(exec => exec.session_id === sessionId)
      : undefined;
    if (bySessionAndSprint) return bySessionAndSprint;
    return sprintExecutions.length === 1 ? sprintExecutions[0] : null;
  }

  if (sessionId) {
    const sessionExecutions = active.filter(exec => exec.session_id === sessionId);
    if (sessionExecutions.length === 1) return sessionExecutions[0];
  }

  return active.length === 1 ? active[0] : null;
}

function sprintLabelForContext(cwd: string, config: SlopeConfig): string | null {
  let inferred: ReturnType<typeof inferSprintContext> | null = null;
  try {
    inferred = inferSprintContext(cwd, config);
    if (inferred.source === 'sprint-state' || inferred.source === 'config') return inferred.label;
  } catch {
    // Sprint inference is advisory for this guard; ambiguity should fail open.
  }

  const branchSprint = inferSprintFromBranch(cwd);
  if (branchSprint !== null) return `S${branchSprint}`;
  return inferred && inferred.source !== 'initial' ? inferred.label : null;
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
  return sprintIdKey(value);
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
