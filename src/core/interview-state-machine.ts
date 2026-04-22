// SLOPE — Interview State Machine
// UI-agnostic state machine for driving project interviews.
// Any harness (CLI, Pi, Claude) can instantiate and drive this.

import type { InterviewStep, StepType } from './interview-steps.js';

/** Normalized answer types after UI adapter processing */
export type AnswerValue = string | string[] | boolean;

/** Serializable interview state for persistence/resume */
export interface InterviewState {
  currentStepId: string | null;
  answers: Record<string, AnswerValue>;
  isComplete: boolean;
}

/** Result of submitting an answer */
export type SubmitResult =
  | { success: true }
  | { success: false; error: string };

/**
 * UI-agnostic interview state machine.
 *
 * Usage:
 *   const sm = new InterviewStateMachine(steps);
 *   const question = sm.nextQuestion();
 *   if (question) {
 *     const result = sm.submitAnswer(question.id, userValue);
 *   if (result.success) {
 *     const next = sm.nextQuestion();
 *   }
 *   }
 */
export class InterviewStateMachine {
  private steps: InterviewStep[];
  private answers: Record<string, AnswerValue> = {};
  private currentIndex = -1;
  private complete = false;

  constructor(steps: InterviewStep[]) {
    this.steps = steps;
  }

  /** Get the current serializable state */
  getState(): InterviewState {
    return {
      currentStepId: this.complete ? null : this.currentStepId(),
      answers: { ...this.answers },
      isComplete: this.complete,
    };
  }

  /** Restore state (e.g., after agent reconnect) */
  restoreState(state: InterviewState): void {
    this.answers = { ...state.answers };
    this.complete = state.isComplete;
    if (state.currentStepId) {
      this.currentIndex = this.steps.findIndex((s) => s.id === state.currentStepId);
    } else {
      this.currentIndex = -1;
    }
  }

  /** Get the current step without advancing (useful after restoreState) */
  currentQuestion(): InterviewStep | null {
    if (this.complete) return null;
    const step = this.steps[this.currentIndex];
    if (!step) return null;
    // Re-evaluate condition in case answers changed
    if (step.condition && !step.condition(this.answers as Record<string, unknown>)) {
      return null;
    }
    return step;
  }

  /** Get the next unanswered step that passes its condition */
  nextQuestion(): InterviewStep | null {
    if (this.complete) return null;

    const startIndex = this.currentIndex + 1;
    for (let i = startIndex; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (step.condition && !step.condition(this.answers as Record<string, unknown>)) {
        continue;
      }
      this.currentIndex = i;
      return step;
    }

    this.complete = true;
    return null;
  }

  /**
   * Submit an answer for the current step.
   * Validates the value using the step's validate function if present.
   * Does NOT advance — call nextQuestion() separately to get the next step.
   */
  submitAnswer(id: string, value: unknown): SubmitResult {
    if (this.complete) {
      return { success: false, error: 'Interview is already complete' };
    }

    const step = this.steps[this.currentIndex];
    if (!step || step.id !== id) {
      return { success: false, error: `Step mismatch: expected "${step?.id ?? 'none'}", got "${id}"` };
    }

    // Run step-level validation
    if (step.validate) {
      const error = step.validate(value);
      if (error) {
        return { success: false, error };
      }
    }

    // Normalize value to AnswerValue
    const normalized = this.normalizeValue(value, step.type);
    this.answers[id] = normalized;

    return { success: true };
  }

  /** Whether the interview has reached the end */
  isComplete(): boolean {
    return this.complete;
  }

  /** Get the collected answers (same shape as legacy answers map) */
  getResult(): Record<string, AnswerValue> {
    return { ...this.answers };
  }

  /** Get answers cast to unknown for compat with legacy init functions */
  getResultUnknown(): Record<string, unknown> {
    return this.answers as Record<string, unknown>;
  }

  private currentStepId(): string | null {
    const step = this.steps[this.currentIndex];
    return step?.id ?? null;
  }

  private normalizeValue(value: unknown, type: StepType): AnswerValue {
    switch (type) {
      case 'text':
        return String(value ?? '');
      case 'select':
        return String(value ?? '');
      case 'multiselect':
        return Array.isArray(value) ? (value as string[]) : [];
      case 'confirm':
        return Boolean(value);
      default:
        return String(value ?? '');
    }
  }
}
