import { describe, it, expect } from 'vitest';
import { classifyShotFromSignals } from '../../src/core/advisor.js';
import type { ExecutionTrace, CISignal, SlopeEvent } from '../../src/core/types.js';

function cleanTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    planned_scope_paths: ['packages/core/src/'],
    modified_files: ['packages/core/src/foo.ts'],
    test_results: [],
    reverts: 0,
    elapsed_minutes: 15,
    hazards_encountered: [],
    ...overrides,
  };
}

function passingCI(overrides: Partial<CISignal> = {}): CISignal {
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

function makeEvent(type: SlopeEvent['type'], data: Record<string, unknown> = {}): SlopeEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}

describe('classifyShotFromSignals — git-only (no CI, no events)', () => {
  it('defaults to green when only git signals available', () => {
    const result = classifyShotFromSignals({ trace: cleanTrace() });
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(0.7);
    expect(result.reasoning).toContain('no CI confirmation');
  });

  it('still detects misses from execution trace', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({ reverts: 2 }),
    });
    expect(result.result).toBe('missed_left');
    expect(result.reasoning).toContain('revert');
  });

  it('still detects over-scoping from execution trace', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        modified_files: ['packages/core/src/foo.ts', 'packages/cli/src/extra.ts'],
      }),
    });
    expect(result.result).toBe('missed_long');
  });
});

describe('classifyShotFromSignals — with CI signals', () => {
  it('upgrades to in_the_hole with passing CI', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI(),
    });
    expect(result.result).toBe('in_the_hole');
    expect(result.confidence).toBe(1.0);
    expect(result.reasoning).toContain('CI confirms');
    expect(result.reasoning).toContain('100/100');
  });

  it('keeps green when CI has retries', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI({ retries: 2 }),
    });
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(0.8);
    expect(result.reasoning).toContain('retry');
  });

  it('detects missed_right from CI test failures', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI({ test_failed: 3, test_passed: 97 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.miss_direction).toBe('right');
    expect(result.reasoning).toContain('3 test failure');
  });

  it('enriches trace miss with CI confirmation', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        test_results: [
          { suite: 'core', passed: false, first_run: true },
          { suite: 'cli', passed: true, first_run: true },
        ],
      }),
      ci: passingCI({ test_failed: 5 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.reasoning).toContain('CI confirms');
  });
});

describe('classifyShotFromSignals — with events', () => {
  it('detects missed_left from dead_end events', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      events: [
        makeEvent('dead_end', { approach: 'REST API v1' }),
        makeEvent('dead_end', { approach: 'GraphQL attempt' }),
      ],
    });
    expect(result.result).toBe('missed_left');
    expect(result.miss_direction).toBe('left');
    expect(result.reasoning).toContain('dead end');
  });

  it('detects missed_right from many failure events', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      events: [
        makeEvent('failure', { error: 'build' }),
        makeEvent('failure', { error: 'test' }),
        makeEvent('failure', { error: 'lint' }),
      ],
    });
    expect(result.result).toBe('missed_right');
    expect(result.reasoning).toContain('3 failure events');
  });

  it('detects missed_long from scope_change events', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      events: [
        makeEvent('scope_change', { reason: 'need to also fix related component' }),
      ],
    });
    expect(result.result).toBe('missed_long');
    expect(result.reasoning).toContain('scope change');
  });

  it('ignores non-miss event types (decision, compaction, hazard)', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI(),
      events: [
        makeEvent('decision', { choice: 'use pattern X' }),
        makeEvent('compaction', { tokens: 50000 }),
        makeEvent('hazard', { desc: 'flaky test' }),
      ],
    });
    expect(result.result).toBe('in_the_hole');
  });

  it('does not trigger failure miss with < 3 failures', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI(),
      events: [
        makeEvent('failure', { error: 'build' }),
        makeEvent('failure', { error: 'test' }),
      ],
    });
    // 2 failures is not enough to trigger the miss
    expect(result.result).toBe('in_the_hole');
  });
});

describe('classifyShotFromSignals — combined enrichment', () => {
  it('enriches trace miss with event data', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({ reverts: 1 }),
      events: [
        makeEvent('failure', { error: 'test' }),
      ],
    });
    expect(result.result).toBe('missed_left');
    expect(result.reasoning).toContain('failure event');
  });

  it('boosts confidence when multiple sources agree', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        test_results: [
          { suite: 'core', passed: false, first_run: true },
          { suite: 'cli', passed: true, first_run: true },
        ],
      }),
      ci: passingCI({ test_failed: 2 }),
      events: [makeEvent('failure', { error: 'build' })],
    });
    expect(result.result).toBe('missed_right');
    // All 3 sources agree (trace, CI, events) — confidence should be high
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('preserves green when trace has hazards requiring rework', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        hazards_encountered: [{ type: 'rough', description: 'flaky test' }],
        test_results: [{ suite: 'core', passed: true, first_run: false }],
      }),
      ci: passingCI(),
    });
    expect(result.result).toBe('green');
    expect(result.reasoning).toContain('hazards');
  });
});
