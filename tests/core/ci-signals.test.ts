import { describe, it, expect } from 'vitest';
import { detectRunner, parseTestOutput, parseVitestOutput, parseJestOutput } from '../../src/core/ci-signals.js';

// Sample outputs from real test runs
const VITEST_PASS = `
 RUN  v3.2.4 /home/user/project

 ✓ tests/foo.test.ts (10 tests) 4ms
 ✓ tests/bar.test.ts (5 tests) 8ms

 Test Files  2 passed (2)
      Tests  15 passed (15)
   Start at  10:53:11
   Duration  467ms (transform 952ms, setup 0ms, collect 1.65s, tests 129ms, environment 1ms, prepare 1.12s)
`;

const VITEST_MIXED = `
 RUN  v3.2.4 /home/user/project

 ✓ tests/foo.test.ts (10 tests) 4ms
 ✗ tests/bar.test.ts (5 tests | 2 failed) 12ms
 ✓ tests/baz.test.ts (3 tests) 6ms

 Test Files  2 passed | 1 failed (3)
      Tests  16 passed | 2 failed (18)
   Start at  10:53:11
   Duration  3.21s
`;

const VITEST_SKIPPED = `
 ✓ tests/core.test.ts (20 tests) 15ms
 ↓ tests/slow.test.ts (5 tests | 3 skipped) 2ms

 Test Files  2 passed (2)
      Tests  22 passed | 3 skipped (25)
   Duration  890ms
`;

const VITEST_WITH_RETRIES = `
 ✓ tests/flaky.test.ts (retry 1) 50ms
 ✓ tests/flaky.test.ts (retry 2) 30ms
 ✓ tests/stable.test.ts (10 tests) 5ms

 Test Files  2 passed (2)
      Tests  12 passed (12)
   Duration  200ms
`;

const VITEST_WITH_COVERAGE = `
 Test Files  5 passed (5)
      Tests  100 passed (100)
   Duration  2.5s

 % Coverage report from v8
----------|---------|----------|---------|---------|
File      | % Stmts | % Branch | % Funcs | % Lines |
----------|---------|----------|---------|---------|
All files |   85.5  |    72.3  |   90.1  |   85.5  |
----------|---------|----------|---------|---------|
`;

const JEST_PASS = `
Test Suites: 4 passed, 4 total
Tests:       28 passed, 28 total
Snapshots:   0 total
Time:        3.456 s
`;

const JEST_MIXED = `
Test Suites: 3 passed, 1 failed, 4 total
Tests:       25 passed, 3 failed, 28 total
Snapshots:   0 total
Time:        5.678 s
`;

const JEST_SKIPPED = `
Test Suites: 2 passed, 2 total
Tests:       15 passed, 5 skipped, 20 total
Snapshots:   0 total
Time:        1.234 s
`;

const JEST_WITH_COVERAGE = `
Test Suites: 3 passed, 3 total
Tests:       50 passed, 50 total
Time:        4.0 s

----------|---------|----------|---------|---------|
File      | % Stmts | % Branch | % Funcs | % Lines |
----------|---------|----------|---------|---------|
All files |   92.3  |    88.1  |   95.0  |   92.3  |
----------|---------|----------|---------|---------|
`;

const GENERIC_OUTPUT = `
Running tests...
12 tests passed
3 tests failed
1 test skipped
Done.
`;

describe('detectRunner', () => {
  it('detects vitest from output', () => {
    expect(detectRunner(VITEST_PASS)).toBe('vitest');
  });

  it('detects jest from output', () => {
    expect(detectRunner(JEST_PASS)).toBe('jest');
  });

  it('returns unknown for unrecognized output', () => {
    expect(detectRunner('some random output')).toBe('unknown');
  });

  it('detects vitest from Test Files pattern', () => {
    expect(detectRunner('Test Files  1 passed (1)')).toBe('vitest');
  });

  it('detects jest from Test Suites pattern', () => {
    expect(detectRunner('Test Suites: 1 passed, 1 total')).toBe('jest');
  });
});

describe('parseVitestOutput', () => {
  it('parses all-passing vitest output', () => {
    const signal = parseVitestOutput(VITEST_PASS);
    expect(signal.runner).toBe('vitest');
    expect(signal.test_total).toBe(15);
    expect(signal.test_passed).toBe(15);
    expect(signal.test_failed).toBe(0);
    expect(signal.suites_total).toBe(2);
    expect(signal.suites_passed).toBe(2);
    expect(signal.suites_failed).toBe(0);
    expect(signal.duration_ms).toBe(467);
    expect(signal.retries).toBe(0);
  });

  it('parses mixed pass/fail vitest output', () => {
    const signal = parseVitestOutput(VITEST_MIXED);
    expect(signal.test_total).toBe(18);
    expect(signal.test_passed).toBe(16);
    expect(signal.test_failed).toBe(2);
    expect(signal.suites_total).toBe(3);
    expect(signal.suites_passed).toBe(2);
    expect(signal.suites_failed).toBe(1);
    expect(signal.duration_ms).toBe(3210);
  });

  it('parses vitest output with skipped tests', () => {
    const signal = parseVitestOutput(VITEST_SKIPPED);
    expect(signal.test_total).toBe(25);
    expect(signal.test_passed).toBe(22);
    expect(signal.test_skipped).toBe(3);
  });

  it('counts retries', () => {
    const signal = parseVitestOutput(VITEST_WITH_RETRIES);
    expect(signal.retries).toBe(2);
  });

  it('extracts coverage percentage', () => {
    const signal = parseVitestOutput(VITEST_WITH_COVERAGE);
    expect(signal.coverage_pct).toBe(85.5);
  });
});

describe('parseJestOutput', () => {
  it('parses all-passing jest output', () => {
    const signal = parseJestOutput(JEST_PASS);
    expect(signal.runner).toBe('jest');
    expect(signal.test_total).toBe(28);
    expect(signal.test_passed).toBe(28);
    expect(signal.test_failed).toBe(0);
    expect(signal.suites_total).toBe(4);
    expect(signal.suites_passed).toBe(4);
    expect(signal.suites_failed).toBe(0);
    expect(signal.duration_ms).toBe(3456);
  });

  it('parses mixed pass/fail jest output', () => {
    const signal = parseJestOutput(JEST_MIXED);
    expect(signal.test_total).toBe(28);
    expect(signal.test_passed).toBe(25);
    expect(signal.test_failed).toBe(3);
    expect(signal.suites_total).toBe(4);
    expect(signal.suites_passed).toBe(3);
    expect(signal.suites_failed).toBe(1);
    expect(signal.duration_ms).toBe(5678);
  });

  it('parses jest output with skipped tests', () => {
    const signal = parseJestOutput(JEST_SKIPPED);
    expect(signal.test_total).toBe(20);
    expect(signal.test_passed).toBe(15);
    expect(signal.test_skipped).toBe(5);
  });

  it('extracts coverage percentage', () => {
    const signal = parseJestOutput(JEST_WITH_COVERAGE);
    expect(signal.coverage_pct).toBe(92.3);
  });
});

describe('parseTestOutput (auto-detect)', () => {
  it('auto-detects and parses vitest', () => {
    const signal = parseTestOutput(VITEST_PASS);
    expect(signal.runner).toBe('vitest');
    expect(signal.test_passed).toBe(15);
  });

  it('auto-detects and parses jest', () => {
    const signal = parseTestOutput(JEST_PASS);
    expect(signal.runner).toBe('jest');
    expect(signal.test_passed).toBe(28);
  });

  it('falls back to generic parser', () => {
    const signal = parseTestOutput(GENERIC_OUTPUT);
    expect(signal.runner).toBe('unknown');
    expect(signal.test_passed).toBe(12);
    expect(signal.test_failed).toBe(3);
    expect(signal.test_skipped).toBe(1);
    expect(signal.test_total).toBe(16);
  });
});
