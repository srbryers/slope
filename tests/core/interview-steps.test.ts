import { describe, it, expect } from 'vitest';
import { generateInterviewSteps } from '../../src/core/interview-steps.js';
import type { InterviewContext } from '../../src/core/interview-engine.js';

// Register built-in metaphors
import '../../src/core/metaphors/index.js';

function makeCtx(overrides: Partial<InterviewContext['detected']> = {}): InterviewContext {
  return {
    cwd: '/tmp/test',
    detected: {
      detectedPlatforms: [],
      ...overrides,
    },
  };
}

describe('generateInterviewSteps', () => {
  it('returns all expected step IDs', () => {
    const steps = generateInterviewSteps(makeCtx());
    const ids = steps.map((s) => s.id);
    expect(ids).toContain('project-name');
    expect(ids).toContain('metaphor');
    expect(ids).toContain('repo-url');
    expect(ids).toContain('sprint-number');
    expect(ids).toContain('platforms');
    expect(ids).toContain('team-members');
    expect(ids).toContain('vision');
    expect(ids).toContain('deep-analysis');
  });

  it('pre-fills projectName from detection', () => {
    const steps = generateInterviewSteps(makeCtx({ projectName: 'my-detected-app' }));
    const nameStep = steps.find((s) => s.id === 'project-name');
    expect(nameStep?.default).toBe('my-detected-app');
  });

  it('pre-fills sprintNumber from existing retros', () => {
    const steps = generateInterviewSteps(makeCtx({ existingSprintNumber: 5 }));
    const sprintStep = steps.find((s) => s.id === 'sprint-number');
    expect(sprintStep?.default).toBe('6');
  });

  it('defaults sprint to 1 when no retros exist', () => {
    const steps = generateInterviewSteps(makeCtx());
    const sprintStep = steps.find((s) => s.id === 'sprint-number');
    expect(sprintStep?.default).toBe('1');
  });

  it('shows detected platforms as defaults', () => {
    const steps = generateInterviewSteps(makeCtx({ detectedPlatforms: ['claude-code', 'cursor'] }));
    const platStep = steps.find((s) => s.id === 'platforms');
    expect(platStep?.default).toEqual(['claude-code', 'cursor']);
    // Detected options should have hint
    const ccOpt = platStep?.options?.find((o) => o.value === 'claude-code');
    expect(ccOpt?.hint).toBe('(detected)');
  });

  it('pre-fills repoUrl from detection', () => {
    const steps = generateInterviewSteps(makeCtx({ repoUrl: 'https://github.com/acme/app' }));
    const urlStep = steps.find((s) => s.id === 'repo-url');
    expect(urlStep?.default).toBe('https://github.com/acme/app');
  });

  it('includes all built-in metaphors plus custom option', () => {
    const steps = generateInterviewSteps(makeCtx());
    const metaphorStep = steps.find((s) => s.id === 'metaphor');
    expect(metaphorStep?.type).toBe('select');
    const values = metaphorStep?.options?.map((o) => o.value) ?? [];
    expect(values).toContain('golf');
    expect(values).toContain('gaming');
    expect(values).toContain('dnd');
    expect(values).toContain('custom');
  });

  it('deep-analysis step is conditional on _mode !== agent', () => {
    const steps = generateInterviewSteps(makeCtx());
    const daStep = steps.find((s) => s.id === 'deep-analysis');
    expect(daStep?.condition).toBeDefined();
    // CLI mode — should show
    expect(daStep!.condition!({})).toBe(true);
    // Agent mode — should hide
    expect(daStep!.condition!({ _mode: 'agent' })).toBe(false);
  });

  it('project-name validate rejects empty string', () => {
    const steps = generateInterviewSteps(makeCtx());
    const nameStep = steps.find((s) => s.id === 'project-name');
    expect(nameStep?.validate?.('')).toBe('Project name is required');
    expect(nameStep?.validate?.('valid')).toBeNull();
  });

  it('repo-url validate accepts empty (optional) and rejects invalid URL', () => {
    const steps = generateInterviewSteps(makeCtx());
    const urlStep = steps.find((s) => s.id === 'repo-url');
    expect(urlStep?.validate?.('')).toBeNull();
    expect(urlStep?.validate?.('not-a-url')).toBeTruthy();
    expect(urlStep?.validate?.('https://github.com/acme/app')).toBeNull();
  });
});
