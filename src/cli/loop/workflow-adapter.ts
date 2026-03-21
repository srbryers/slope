// Loop → Workflow Engine Bridge
// Translates the loop executor's step sequence into workflow engine calls.
// When LoopConfig.workflowName is set, the loop delegates step ordering to the engine.

import type { SlopeStore } from '../../core/store.js';
import type { WorkflowDefinition } from '../../core/workflow.js';
import type { WorkflowExecution } from '../../core/types.js';
import { WorkflowEngine } from '../../core/workflow-engine.js';
import { loadWorkflow } from '../../core/workflow-loader.js';
import { resolveVariables } from '../../core/workflow.js';
import type { LoopConfig, BacklogSprint } from './types.js';
import type { Logger } from './logger.js';

/** Manages a workflow execution lifecycle within a loop sprint run */
export class WorkflowAdapter {
  private engine = new WorkflowEngine();
  private execution: WorkflowExecution | null = null;
  private def: WorkflowDefinition | null = null;

  constructor(
    private readonly config: LoopConfig,
    private readonly store: SlopeStore,
    private readonly log: Logger,
  ) {}

  /** Check if workflow mode is enabled */
  get enabled(): boolean {
    return !!this.config.workflowName;
  }

  /**
   * Start a workflow execution for a sprint.
   * Returns the execution or null if workflow mode is disabled.
   */
  async start(sprint: BacklogSprint, cwd: string): Promise<WorkflowExecution | null> {
    if (!this.config.workflowName) return null;

    // Build variables from config + sprint
    const vars: Record<string, string> = {
      sprint_id: sprint.id,
      tickets: sprint.tickets.map(t => t.key).join(','),
      model: this.config.modelLocal,
      ...this.config.workflowVariables,
    };

    // Load and resolve workflow
    this.def = loadWorkflow(this.config.workflowName, cwd);
    const resolved = resolveVariables(this.def, vars);
    this.def = resolved;

    // Start execution
    this.execution = await this.engine.start(resolved, this.store, {
      sprint_id: sprint.id,
      variables: vars,
    });

    this.log.info(`Workflow "${this.config.workflowName}" started (${this.execution.id})`);
    return this.execution;
  }

  /**
   * Get the next step to execute.
   * Returns null if workflow is complete or not active.
   */
  async next(): Promise<{
    phase: string;
    step_id: string;
    step_type: string;
    prompt?: string;
    command?: string;
    is_complete: boolean;
    current_item?: string;
  } | null> {
    if (!this.execution || !this.def) return null;

    const info = await this.engine.next(this.execution.id, this.def, this.store);

    if (info.is_complete) {
      this.log.info('Workflow complete');
      return { phase: '', step_id: '', step_type: '', is_complete: true };
    }

    return {
      phase: info.phase!,
      step_id: info.step!.id,
      step_type: info.step!.type,
      prompt: info.step!.prompt,
      command: info.step!.command,
      is_complete: false,
      current_item: info.current_item,
    };
  }

  /**
   * Mark the current step as completed.
   */
  async completeStep(stepId: string, output?: Record<string, unknown>, exitCode?: number): Promise<void> {
    if (!this.execution || !this.def) return;

    const result = await this.engine.complete(
      this.execution.id,
      stepId,
      { output, exit_code: exitCode },
      this.def,
      this.store,
    );

    if (result.is_complete) {
      this.log.info('Workflow execution completed');
    } else if (result.advanced_to) {
      this.log.info(`Advanced to ${result.advanced_to.phase}/${result.advanced_to.step}`);
    }
  }

  /**
   * Skip the current step (e.g., on timeout or blocker).
   */
  async skipStep(stepId: string, reason: string): Promise<void> {
    if (!this.execution || !this.def) return;

    await this.engine.skip(this.execution.id, stepId, reason, this.def, this.store);
    this.log.info(`Skipped step "${stepId}": ${reason}`);
  }

  /**
   * Mark the workflow as failed (e.g., on unrecoverable error).
   */
  async fail(): Promise<void> {
    if (!this.execution) return;

    await this.engine.fail(this.execution.id, this.store);
    this.execution = { ...this.execution, status: 'failed' };
    this.log.info('Workflow execution failed');
  }

  /** Get the current execution ID */
  get executionId(): string | null {
    return this.execution?.id ?? null;
  }

  /** Get the current execution status (re-reads from store for accuracy) */
  async getStatus(): Promise<string | null> {
    if (!this.execution) return null;
    const fresh = await this.store.getExecution(this.execution.id);
    if (fresh) this.execution = fresh;
    return fresh?.status ?? null;
  }

  /** Get the cached execution status (may be stale — prefer getStatus()) */
  get status(): string | null {
    return this.execution?.status ?? null;
  }
}
