import { describe, it, expect } from 'vitest';
import { classifyShotFromSignals } from '../../src/core/advisor.js';
import type { ExecutionTrace, CISignal, PRSignal } from '../../src/core/types.js';

// --- Helpers ---

function makeTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    planned_scope_paths: ['packages/core/src/'],
    modified_files: ['packages/core/src/pr-signals.ts'],
    test_results: [{ suite: 'core', passed: true, first_run: true }],
    reverts: 0,
    elapsed_minutes: 30,
    hazards_encountered: [],
    ...overrides,
  };
}

function makeCI(overrides: Partial<CISignal> = {}): CISignal {
  return {
    runner: 'vitest',
    test_total: 100,
    test_passed: 100,
    test_failed: 0,
    test_skipped: 0,
    suites_total: 5,
    suites_passed: 5,
    suites_failed: 0,
    retries: 0,
    ...overrides,
  };
}

function makePR(overrides: Partial<PRSignal> = {}): PRSignal {
  return {
    platform: 'github',
    pr_number: 42,
    review_cycles: 1,
    change_request_count: 0,
    time_to_merge_minutes: 90,
    ci_checks_passed: 3,
    ci_checks_failed: 0,
    file_count: 5,
    additions: 100,
    deletions: 20,
    comment_count: 1,
    review_decision: 'APPROVED',
    ...overrides,
  };
}

describe('classifyShotFromSignals — backward compat (no PR)', () => {
  it('without PR or CI, defaults to green', () => {
    const result = classifyShotFromSignals({ trace: makeTrace() });
    expect(result.result).toBe('green');
    expect(result.reasoning).toContain('no CI confirmation');
  });

  it('with CI only, behaves identically to pre-PR logic', () => {
    const result = classifyShotFromSignals({ trace: makeTrace(), ci: makeCI() });
    expect(result.result).toBe('in_the_hole');
    expect(result.reasoning).toContain('CI confirms');
    // No PR mention in reasoning
    expect(result.reasoning).not.toContain('PR');
  });
});

describe('classifyShotFromSignals — PR boost', () => {
  it('clean PR + CI pass → in_the_hole with PR reasoning', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR(),
    });
    expect(result.result).toBe('in_the_hole');
    expect(result.confidence).toBe(1.0);
    expect(result.reasoning).toContain('PR #42 APPROVED');
    expect(result.reasoning).toContain('0 change requests');
  });

  it('clean PR without CI still defaults to green (CI required for in_the_hole)', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      pr: makePR(),
    });
    expect(result.result).toBe('green');
  });
});

describe('classifyShotFromSignals — PR penalty', () => {
  it('2+ change requests → missed_right', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({ change_request_count: 2 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.miss_direction).toBe('right');
    expect(result.confidence).toBe(0.7);
    expect(result.reasoning).toContain('change request');
    expect(result.reasoning).toContain('rework');
  });

  it('exactly 2 change requests triggers penalty', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({ change_request_count: 2, pr_number: 99 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.reasoning).toContain('PR #99');
  });

  it('3+ change requests also triggers penalty', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({ change_request_count: 5 }),
    });
    expect(result.result).toBe('missed_right');
  });
});

describe('classifyShotFromSignals — PR complexity', () => {
  it('high comment density + change request → green', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({
        change_request_count: 1,
        comment_count: 20,
        file_count: 5,
      }),
    });
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(0.8);
    expect(result.reasoning).toContain('comment density');
    expect(result.reasoning).toContain('complex but completed');
  });

  it('low comment density + 1 change request → in_the_hole (passes through to CI)', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({
        change_request_count: 1,
        comment_count: 2,
        file_count: 5,
      }),
    });
    // 2/5 = 0.4, not > 3, so falls through to CI check
    expect(result.result).toBe('in_the_hole');
  });
});

describe('classifyShotFromSignals — PR enrichment', () => {
  it('trace miss + PR change requests → boosted confidence', () => {
    const trace = makeTrace({
      modified_files: [
        'packages/core/src/pr-signals.ts',
        'packages/cli/src/commands/auto-card.ts', // out of scope
      ],
    });
    const result = classifyShotFromSignals({
      trace,
      ci: makeCI(),
      pr: makePR({ change_request_count: 1, pr_number: 50 }),
    });
    // Base miss from out-of-scope file
    expect(result.result).toBe('missed_long');
    expect(result.reasoning).toContain('PR #50');
    expect(result.reasoning).toContain('1 change request');
  });
});

describe('classifyShotFromSignals — edge cases', () => {
  it('pr_number=0 still works', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({ pr_number: 0, change_request_count: 3 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.reasoning).toContain('PR #0');
  });

  it('null time_to_merge does not affect classification', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({ time_to_merge_minutes: null }),
    });
    expect(result.result).toBe('in_the_hole');
  });

  it('PR with file_count=0 avoids division by zero in comment density', () => {
    const result = classifyShotFromSignals({
      trace: makeTrace(),
      ci: makeCI(),
      pr: makePR({ change_request_count: 1, comment_count: 10, file_count: 0 }),
    });
    // file_count=0 → density check short-circuits (0 > 0 is false), falls through
    expect(['green', 'in_the_hole']).toContain(result.result);
  });
});
