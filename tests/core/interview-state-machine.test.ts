// SLOPE — Interview State Machine Tests

import { describe, it, expect } from 'vitest';
import { InterviewStateMachine } from '../../src/core/interview-state-machine.js';
import type { InterviewStep } from '../../src/core/interview-steps.js';

const BASIC_STEPS: InterviewStep[] = [
  {
    id: 'project-name',
    question: 'What is your project name?',
    type: 'text',
    required: true,
    validate: (v) => {
      const s = String(v ?? '').trim();
      return s.length === 0 ? 'Project name is required' : null;
    },
  },
  {
    id: 'metaphor',
    question: 'Choose a metaphor',
    type: 'select',
    options: [
      { value: 'golf', label: 'Golf' },
      { value: 'tennis', label: 'Tennis' },
    ],
  },
  {
    id: 'confirm-step',
    question: 'Run deep analysis?',
    type: 'confirm',
    default: false,
  },
];

const CONDITIONAL_STEPS: InterviewStep[] = [
  {
    id: 'name',
    question: 'Name?',
    type: 'text',
  },
  {
    id: 'advanced',
    question: 'Advanced setting?',
    type: 'text',
    condition: (answers) => answers['enable-advanced'] === true,
  },
  {
    id: 'final',
    question: 'Final?',
    type: 'text',
  },
];

describe('InterviewStateMachine', () => {
  it('starts with no current step and is not complete', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    const state = sm.getState();
    expect(state.currentStepId).toBeNull();
    expect(state.isComplete).toBe(false);
    expect(state.answers).toEqual({});
  });

  it('returns first question via nextQuestion()', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    const step = sm.nextQuestion();
    expect(step).not.toBeNull();
    expect(step!.id).toBe('project-name');
  });

  it('advances through all questions sequentially', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    expect(sm.nextQuestion()!.id).toBe('project-name');
    sm.submitAnswer('project-name', 'MyProject');
    expect(sm.nextQuestion()!.id).toBe('metaphor');
    sm.submitAnswer('metaphor', 'golf');
    expect(sm.nextQuestion()!.id).toBe('confirm-step');
    sm.submitAnswer('confirm-step', true);
    expect(sm.nextQuestion()).toBeNull();
    expect(sm.isComplete()).toBe(true);
  });

  it('stores answers in getResult()', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    sm.submitAnswer('project-name', 'MyProject');
    sm.nextQuestion();
    sm.submitAnswer('metaphor', 'golf');
    const result = sm.getResult();
    expect(result['project-name']).toBe('MyProject');
    expect(result['metaphor']).toBe('golf');
  });

  it('normalizes answer types', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    sm.submitAnswer('project-name', 'Name');
    sm.nextQuestion();
    sm.submitAnswer('metaphor', 'golf');
    sm.nextQuestion();
    sm.submitAnswer('confirm-step', true);
    const result = sm.getResult();
    expect(typeof result['project-name']).toBe('string');
    expect(typeof result['metaphor']).toBe('string');
    expect(typeof result['confirm-step']).toBe('boolean');
  });

  it('validates answers and rejects invalid values', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    const result = sm.submitAnswer('project-name', '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Project name is required');
    expect(sm.getResult()['project-name']).toBeUndefined();
  });

  it('rejects submit when step id does not match current', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    const result = sm.submitAnswer('metaphor', 'golf');
    expect(result.success).toBe(false);
    expect(result.error).toContain('mismatch');
  });

  it('rejects submit when interview is complete', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    sm.submitAnswer('project-name', 'A');
    sm.nextQuestion();
    sm.submitAnswer('metaphor', 'golf');
    sm.nextQuestion();
    sm.submitAnswer('confirm-step', true);
    sm.nextQuestion(); // triggers completion
    expect(sm.isComplete()).toBe(true);
    const result = sm.submitAnswer('project-name', 'B');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already complete');
  });

  it('skips steps whose condition returns false', () => {
    const sm = new InterviewStateMachine(CONDITIONAL_STEPS);
    expect(sm.nextQuestion()!.id).toBe('name');
    sm.submitAnswer('name', 'Test');
    // advanced step is skipped because enable-advanced is not set
    expect(sm.nextQuestion()!.id).toBe('final');
    sm.submitAnswer('final', 'Done');
    sm.nextQuestion(); // triggers completion
    expect(sm.isComplete()).toBe(true);
    expect(sm.getResult()['advanced']).toBeUndefined();
  });

  it('includes steps whose condition returns true', () => {
    const stepsWithToggle: InterviewStep[] = [
      {
        id: 'enable-advanced',
        question: 'Enable?',
        type: 'confirm',
      },
      {
        id: 'advanced',
        question: 'Advanced?',
        type: 'text',
        condition: (answers) => answers['enable-advanced'] === true,
      },
    ];
    const sm = new InterviewStateMachine(stepsWithToggle);
    sm.nextQuestion();
    sm.submitAnswer('enable-advanced', true);
    expect(sm.nextQuestion()!.id).toBe('advanced');
    sm.submitAnswer('advanced', 'Value');
    sm.nextQuestion(); // triggers completion
    expect(sm.isComplete()).toBe(true);
    expect(sm.getResult()['advanced']).toBe('Value');
  });

  it('restoreState resumes at the correct step', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    sm.submitAnswer('project-name', 'MyProject');
    sm.nextQuestion(); // advances to metaphor, but don't submit

    const state = sm.getState();
    const sm2 = new InterviewStateMachine(BASIC_STEPS);
    sm2.restoreState(state);

    expect(sm2.getState().answers['project-name']).toBe('MyProject');
    expect(sm2.currentQuestion()!.id).toBe('metaphor');
  });

  it('getResultUnknown returns answers as unknown record', () => {
    const sm = new InterviewStateMachine(BASIC_STEPS);
    sm.nextQuestion();
    sm.submitAnswer('project-name', 'X');
    const unknown = sm.getResultUnknown();
    expect(unknown['project-name']).toBe('X');
  });
});
