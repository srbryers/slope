// SLOPE — Workflow Execution Engine
// Controls step ordering, validates state transitions, and persists execution state.

import type { SlopeStore } from './store.js';
import type { WorkflowExecution, CompletedStep } from './types.js';
import type { WorkflowDefinition, WorkflowStep } from './workflow.js';

// --- State Machine ---

/** Valid status transitions for workflow executions */
const VALID_TRANSITIONS: Record<string, string[]> = {
  running:   ['paused', 'completed', 'failed'],
  paused:    ['running', 'failed'],
  completed: [],
  failed:    [],
};

function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Types ---

/** Options for starting a workflow execution */
export interface StartOpts {
  sprint_id?: string;
  variables?: Record<string, string>;
  session_id?: string;
}

/** Information about the next step to execute */
export interface NextStepInfo {
  /** Whether the entire workflow is complete */
  is_complete: boolean;
  /** Phase ID of the next step (undefined if complete) */
  phase?: string;
  /** The step to execute (undefined if complete) */
  step?: WorkflowStep;
  /** For repeat_for phases: the current item being iterated */
  current_item?: string;
  /** Total items in repeat_for phase (if applicable) */
  total_items?: number;
  /** Index of current item (0-based, if applicable) */
  item_index?: number;
}

/** Result of advancing after completing/skipping a step */
export interface AdvanceResult {
  /** The phase/step that was advanced to (or undefined if workflow complete) */
  advanced_to?: { phase: string; step: string };
  /** Whether the entire workflow is now complete */
  is_complete: boolean;
  /** Hint for what to do next */
  next_action?: string;
}

/** Result of completing a step */
export interface StepResult {
  output?: Record<string, unknown>;
  exit_code?: number;
  /** When the step actually started (for accurate duration tracking) */
  started_at?: string;
}

// --- Engine ---

export class WorkflowEngine {
  /**
   * Start a new workflow execution.
   * Creates a store record and positions at the first step of the first phase.
   */
  async start(
    def: WorkflowDefinition,
    store: SlopeStore,
    opts: StartOpts = {},
  ): Promise<WorkflowExecution> {
    if (def.phases.length === 0) {
      throw new Error('Workflow has no phases');
    }

    const firstPhase = def.phases[0];
    if (firstPhase.steps.length === 0) {
      throw new Error(`Phase "${firstPhase.id}" has no steps`);
    }

    const execution = await store.startExecution({
      workflow_name: def.name,
      sprint_id: opts.sprint_id,
      variables: opts.variables,
      session_id: opts.session_id,
    });

    // Position at first step
    await store.updateExecutionState(execution.id, firstPhase.id, firstPhase.steps[0].id);

    return {
      ...execution,
      current_phase: firstPhase.id,
      current_step: firstPhase.steps[0].id,
    };
  }

  /**
   * Determine what should happen next for an execution.
   * Returns the current step to execute, or is_complete if done.
   */
  async next(
    executionId: string,
    def: WorkflowDefinition,
    store: SlopeStore,
  ): Promise<NextStepInfo> {
    const execution = await this.requireExecution(executionId, store);

    if (execution.status === 'completed') {
      return { is_complete: true };
    }
    if (execution.status === 'failed') {
      throw new Error(`Workflow execution "${executionId}" has failed`);
    }
    if (execution.status === 'paused') {
      throw new Error(`Workflow execution "${executionId}" is paused — resume before calling next()`);
    }

    // Find the next incomplete step
    return this.findNextStep(execution, def);
  }

  /**
   * Complete a step and advance the execution.
   * Records the step result and moves to the next step/phase.
   */
  async complete(
    executionId: string,
    stepId: string,
    result: StepResult,
    def: WorkflowDefinition,
    store: SlopeStore,
  ): Promise<AdvanceResult> {
    const execution = await this.requireExecution(executionId, store);
    this.validateCurrentStep(execution, stepId);

    // Determine current item for repeat_for phases
    const currentInfo = this.findNextStep(execution, def);

    await store.recordStepResult({
      execution_id: executionId,
      step_id: stepId,
      phase: execution.current_phase!,
      status: 'completed',
      output: result.output,
      exit_code: result.exit_code,
      item: currentInfo.current_item,
      started_at: result.started_at,
    });

    return this.advanceToNext(executionId, execution, def, store);
  }

  /**
   * Skip a step and advance. Skipped steps count as "done" for phase advancement.
   */
  async skip(
    executionId: string,
    stepId: string,
    reason: string,
    def: WorkflowDefinition,
    store: SlopeStore,
  ): Promise<AdvanceResult> {
    const execution = await this.requireExecution(executionId, store);
    this.validateCurrentStep(execution, stepId);

    // Determine current item for repeat_for phases
    const currentInfo = this.findNextStep(execution, def);

    await store.recordStepResult({
      execution_id: executionId,
      step_id: stepId,
      phase: execution.current_phase!,
      status: 'skipped',
      output: { reason },
      item: currentInfo.current_item,
    });

    return this.advanceToNext(executionId, execution, def, store);
  }

  /**
   * Transition execution to failed status.
   */
  async fail(
    executionId: string,
    store: SlopeStore,
  ): Promise<void> {
    const execution = await this.requireExecution(executionId, store);

    if (!isValidTransition(execution.status, 'failed')) {
      throw new Error(
        `Invalid workflow transition: "${execution.status}" → "failed". ` +
        `Valid transitions from "${execution.status}": ${VALID_TRANSITIONS[execution.status]?.join(', ') || 'none'}`,
      );
    }

    await store.completeExecution(executionId, 'failed');
  }

  /**
   * Pause a running execution. Preserves current phase/step for later resume.
   */
  async pause(
    executionId: string,
    store: SlopeStore,
  ): Promise<void> {
    const execution = await this.requireExecution(executionId, store);

    if (!isValidTransition(execution.status, 'paused')) {
      throw new Error(
        `Invalid workflow transition: "${execution.status}" → "paused". ` +
        `Valid transitions from "${execution.status}": ${VALID_TRANSITIONS[execution.status]?.join(', ') || 'none'}`,
      );
    }

    await store.completeExecution(executionId, 'paused');
  }

  /**
   * Resume a paused execution. Continues from the same phase/step.
   */
  async resume(
    executionId: string,
    store: SlopeStore,
  ): Promise<void> {
    const execution = await this.requireExecution(executionId, store);

    if (!isValidTransition(execution.status, 'running')) {
      throw new Error(
        `Invalid workflow transition: "${execution.status}" → "running". ` +
        `Valid transitions from "${execution.status}": ${VALID_TRANSITIONS[execution.status]?.join(', ') || 'none'}`,
      );
    }

    await store.completeExecution(executionId, 'running');
  }

  // --- Private helpers ---

  private async requireExecution(id: string, store: SlopeStore): Promise<WorkflowExecution> {
    const execution = await store.getExecution(id);
    if (!execution) {
      throw new Error(`Workflow execution "${id}" not found`);
    }
    return execution;
  }

  private validateCurrentStep(execution: WorkflowExecution, stepId: string): void {
    if (execution.status !== 'running') {
      throw new Error(
        `Cannot complete step on execution with status "${execution.status}" — must be "running"`,
      );
    }
    if (execution.current_step !== stepId) {
      throw new Error(
        `Step mismatch: execution is at "${execution.current_step}" but "${stepId}" was provided`,
      );
    }
  }

  /**
   * Find the next incomplete step in the workflow.
   * Handles repeat_for phases by expanding the iteration.
   */
  private findNextStep(
    execution: WorkflowExecution,
    def: WorkflowDefinition,
  ): NextStepInfo {
    const completedSet = new Set(
      execution.completed_steps.map((s: CompletedStep) => `${s.phase}:${s.step_id}${s.item ? ':' + s.item : ''}`),
    );

    for (const phase of def.phases) {
      if (phase.repeat_for) {
        // Expand the repeat_for phase
        const items = this.getRepeatItems(phase.repeat_for, execution.variables);
        for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
          const item = items[itemIdx];
          for (const step of phase.steps) {
            const key = `${phase.id}:${step.id}:${item}`;
            if (!completedSet.has(key)) {
              return {
                is_complete: false,
                phase: phase.id,
                step,
                current_item: item,
                total_items: items.length,
                item_index: itemIdx,
              };
            }
          }
        }
      } else {
        for (const step of phase.steps) {
          const key = `${phase.id}:${step.id}`;
          if (!completedSet.has(key)) {
            return {
              is_complete: false,
              phase: phase.id,
              step,
            };
          }
        }
      }
    }

    return { is_complete: true };
  }

  /**
   * After completing/skipping a step, advance to the next step or complete the workflow.
   */
  private async advanceToNext(
    executionId: string,
    _execution: WorkflowExecution,
    def: WorkflowDefinition,
    store: SlopeStore,
  ): Promise<AdvanceResult> {
    // Re-fetch execution to get updated completed_steps
    const updated = await this.requireExecution(executionId, store);
    const nextInfo = this.findNextStep(updated, def);

    if (nextInfo.is_complete) {
      await store.completeExecution(executionId, 'completed');
      return { is_complete: true };
    }

    await store.updateExecutionState(executionId, nextInfo.phase!, nextInfo.step!.id);

    return {
      advanced_to: { phase: nextInfo.phase!, step: nextInfo.step!.id },
      is_complete: false,
      next_action: this.describeStep(nextInfo.step!),
    };
  }

  /**
   * Get the items to iterate over for a repeat_for phase.
   * Looks up the variable name and splits comma-separated values or parses JSON array.
   */
  private getRepeatItems(variableName: string, variables: Record<string, string>): string[] {
    const value = variables[variableName];
    if (!value) return [];

    // Try JSON array first
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not JSON — treat as comma-separated
    }

    return value.split(',').map(s => s.trim()).filter(Boolean);
  }

  /** Human-readable description of what a step expects */
  private describeStep(step: WorkflowStep): string {
    switch (step.type) {
      case 'command':
        return `Run command: ${step.command}`;
      case 'validation':
        return `Validate: ${step.conditions?.join(', ') ?? step.prompt ?? step.id}`;
      case 'agent_input':
        return `Provide input: ${step.required_fields?.join(', ') ?? step.prompt ?? step.id}`;
      case 'agent_work':
        return `${step.prompt ?? `Execute: ${step.id}`}`;
      default:
        return step.id;
    }
  }
}
