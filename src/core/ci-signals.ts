// SLOPE — CI/Test Signal Parser
// Parses Vitest and Jest output into structured CISignal objects.

import type { CISignal, CIRunner } from './types.js';

/** Detect which test runner produced the output */
export function detectRunner(output: string): CIRunner {
  // Vitest markers
  if (output.includes('vitest') || output.includes('Vitest') || /Test Files\s+\d+/.test(output)) {
    return 'vitest';
  }
  // Jest markers
  if (output.includes('jest') || output.includes('Jest') || /Test Suites:/.test(output)) {
    return 'jest';
  }
  return 'unknown';
}

/** Parse test runner output into a structured CISignal */
export function parseTestOutput(output: string): CISignal {
  const runner = detectRunner(output);
  switch (runner) {
    case 'vitest': return parseVitestOutput(output);
    case 'jest': return parseJestOutput(output);
    default: return parseGenericOutput(output);
  }
}

/** Parse Vitest summary output */
export function parseVitestOutput(output: string): CISignal {
  const signal = emptyCISignal('vitest');

  // Test Files line: "Test Files  12 passed (12)" or "Test Files  2 passed | 1 failed (3)"
  const suitesMatch = output.match(/Test Files\s+(.+?)\((\d+)\)/);
  if (suitesMatch) {
    signal.suites_total = parseInt(suitesMatch[2], 10);
    const parts = suitesMatch[1];
    const passedMatch = parts.match(/(\d+)\s+passed/);
    const failedMatch = parts.match(/(\d+)\s+failed/);
    if (passedMatch) signal.suites_passed = parseInt(passedMatch[1], 10);
    if (failedMatch) signal.suites_failed = parseInt(failedMatch[1], 10);
  }

  // Tests line: "Tests  411 passed (411)" or "Tests  14 passed | 1 failed (15)"
  const testsMatch = output.match(/Tests\s+(.+?)\((\d+)\)/);
  if (testsMatch) {
    signal.test_total = parseInt(testsMatch[2], 10);
    const parts = testsMatch[1];
    const passedMatch = parts.match(/(\d+)\s+passed/);
    const failedMatch = parts.match(/(\d+)\s+failed/);
    const skippedMatch = parts.match(/(\d+)\s+skipped/);
    if (passedMatch) signal.test_passed = parseInt(passedMatch[1], 10);
    if (failedMatch) signal.test_failed = parseInt(failedMatch[1], 10);
    if (skippedMatch) signal.test_skipped = parseInt(skippedMatch[1], 10);
  }

  // Duration line: "Duration  467ms" or "Duration  3.21s"
  const durationMatch = output.match(/Duration\s+([\d.]+)(ms|s)/);
  if (durationMatch) {
    const value = parseFloat(durationMatch[1]);
    signal.duration_ms = durationMatch[2] === 's' ? Math.round(value * 1000) : Math.round(value);
  }

  // Retries: count "(retry x" patterns
  const retryMatches = output.match(/\(retry \d+\)/g);
  signal.retries = retryMatches?.length ?? 0;

  // Coverage: "All files  |  85.5  |" or "% Stmts  |  85.5"
  const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)/) ?? output.match(/% Stmts\s*\|\s*([\d.]+)/);
  if (coverageMatch) {
    signal.coverage_pct = parseFloat(coverageMatch[1]);
  }

  return signal;
}

/** Parse Jest summary output */
export function parseJestOutput(output: string): CISignal {
  const signal = emptyCISignal('jest');

  // Test Suites: "Test Suites: 2 passed, 1 failed, 3 total"
  const suitesMatch = output.match(/Test Suites:\s*(.+?)(\d+)\s+total/);
  if (suitesMatch) {
    signal.suites_total = parseInt(suitesMatch[2], 10);
    const parts = suitesMatch[1];
    const passedMatch = parts.match(/(\d+)\s+passed/);
    const failedMatch = parts.match(/(\d+)\s+failed/);
    if (passedMatch) signal.suites_passed = parseInt(passedMatch[1], 10);
    if (failedMatch) signal.suites_failed = parseInt(failedMatch[1], 10);
  }

  // Tests: "Tests:       14 passed, 1 failed, 15 total"
  const testsMatch = output.match(/Tests:\s*(.+?)(\d+)\s+total/);
  if (testsMatch) {
    signal.test_total = parseInt(testsMatch[2], 10);
    const parts = testsMatch[1];
    const passedMatch = parts.match(/(\d+)\s+passed/);
    const failedMatch = parts.match(/(\d+)\s+failed/);
    const skippedMatch = parts.match(/(\d+)\s+skipped/);
    if (passedMatch) signal.test_passed = parseInt(passedMatch[1], 10);
    if (failedMatch) signal.test_failed = parseInt(failedMatch[1], 10);
    if (skippedMatch) signal.test_skipped = parseInt(skippedMatch[1], 10);
  }

  // Time: "Time:        3.456 s" or "Time:        456 ms"
  const timeMatch = output.match(/Time:\s*([\d.]+)\s*(s|ms)/);
  if (timeMatch) {
    const value = parseFloat(timeMatch[1]);
    signal.duration_ms = timeMatch[2] === 's' ? Math.round(value * 1000) : Math.round(value);
  }

  // Retries: jest retry pattern
  const retryMatches = output.match(/● .+ › .+ \(attempt \d+\)/g);
  signal.retries = retryMatches?.length ?? 0;

  // Coverage: "All files  |  85.5  |"
  const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)/);
  if (coverageMatch) {
    signal.coverage_pct = parseFloat(coverageMatch[1]);
  }

  return signal;
}

/** Fallback parser for unknown runners — extracts what it can */
function parseGenericOutput(output: string): CISignal {
  const signal = emptyCISignal('unknown');

  // Try to find any "N passed" / "N failed" patterns
  const passedMatch = output.match(/(\d+)\s+(?:tests?\s+)?passed/i);
  const failedMatch = output.match(/(\d+)\s+(?:tests?\s+)?failed/i);
  const skippedMatch = output.match(/(\d+)\s+(?:tests?\s+)?skipped/i);

  if (passedMatch) signal.test_passed = parseInt(passedMatch[1], 10);
  if (failedMatch) signal.test_failed = parseInt(failedMatch[1], 10);
  if (skippedMatch) signal.test_skipped = parseInt(skippedMatch[1], 10);
  signal.test_total = signal.test_passed + signal.test_failed + signal.test_skipped;

  return signal;
}

function emptyCISignal(runner: CIRunner): CISignal {
  return {
    runner,
    test_total: 0,
    test_passed: 0,
    test_failed: 0,
    test_skipped: 0,
    suites_total: 0,
    suites_passed: 0,
    suites_failed: 0,
    retries: 0,
  };
}
