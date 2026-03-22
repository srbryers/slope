import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { workflowGateGuard } from '../../../src/cli/guards/workflow-gate.js';
import type { HookInput } from '../../../src/core/index.js';

const TMP = join(import.meta.dirname ?? __dirname, '..', '..', '..', '.test-tmp-workflow-gate');

function makeInput(): HookInput {
  return {
    session_id: 'test-session',
    cwd: TMP,
    hook_event_name: 'PreToolUse',
    tool_name: 'ExitPlanMode',
    tool_input: {},
    tool_response: {},
  };
}

function writeReviewState(data: unknown): void {
  const slopeDir = join(TMP, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'review-state.json'), typeof data === 'string' ? data : JSON.stringify(data));
}

function writeSprintState(phase: string): void {
  const slopeDir = join(TMP, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'sprint-state.json'), JSON.stringify({
    sprint: 68,
    phase,
    gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
    started_at: '2026-03-22T00:00:00Z',
    updated_at: '2026-03-22T00:00:00Z',
  }));
}

describe('workflowGateGuard', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) {
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('allows when no review-state.json exists', async () => {
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows when review-state.json is malformed JSON', async () => {
    writeReviewState('not valid json {{{');
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows when review-state has non-number rounds_required', async () => {
    writeReviewState({ rounds_required: 'two', rounds_completed: 0 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows when review-state has non-number rounds_completed', async () => {
    writeReviewState({ rounds_required: 2, rounds_completed: null });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('denies when rounds incomplete', async () => {
    writeReviewState({ rounds_required: 3, rounds_completed: 1 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('1/3');
    expect(result.blockReason).toContain('2 remaining rounds are');
  });

  it('denies with singular grammar for 1 remaining round', async () => {
    writeReviewState({ rounds_required: 2, rounds_completed: 1 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('1/2');
    expect(result.blockReason).toContain('1 remaining round is');
  });

  it('allows when rounds_completed equals rounds_required', async () => {
    writeReviewState({ rounds_required: 2, rounds_completed: 2 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows when rounds_completed exceeds rounds_required', async () => {
    writeReviewState({ rounds_required: 1, rounds_completed: 3 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('transitions sprint-state from planning to implementing on completion', async () => {
    writeSprintState('planning');
    writeReviewState({ rounds_required: 1, rounds_completed: 1 });
    await workflowGateGuard(makeInput(), TMP);

    const state = JSON.parse(readFileSync(join(TMP, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.phase).toBe('implementing');
  });

  it('transitions sprint-state from reviewing to implementing on completion', async () => {
    writeSprintState('reviewing');
    writeReviewState({ rounds_required: 2, rounds_completed: 2 });
    await workflowGateGuard(makeInput(), TMP);

    const state = JSON.parse(readFileSync(join(TMP, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.phase).toBe('implementing');
  });

  it('does not transition sprint-state from implementing phase', async () => {
    writeSprintState('implementing');
    writeReviewState({ rounds_required: 1, rounds_completed: 1 });
    await workflowGateGuard(makeInput(), TMP);

    const state = JSON.parse(readFileSync(join(TMP, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.phase).toBe('implementing');
  });

  it('does not transition sprint-state from scoring phase', async () => {
    writeSprintState('scoring');
    writeReviewState({ rounds_required: 1, rounds_completed: 1 });
    await workflowGateGuard(makeInput(), TMP);

    const state = JSON.parse(readFileSync(join(TMP, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.phase).toBe('scoring');
  });

  it('allows when no sprint-state exists but reviews complete', async () => {
    writeReviewState({ rounds_required: 1, rounds_completed: 1 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('includes skip instruction in deny message', async () => {
    writeReviewState({ rounds_required: 3, rounds_completed: 0 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result.blockReason).toContain('slope review start --tier=skip');
  });

  it('allows when rounds_required is 0 (skip tier)', async () => {
    writeReviewState({ rounds_required: 0, rounds_completed: 0 });
    const result = await workflowGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });
});
