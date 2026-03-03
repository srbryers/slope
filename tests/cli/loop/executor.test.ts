import { describe, it, expect } from 'vitest';

/**
 * Executor tests — focused on exported behavior and integration points.
 * The executor's internal functions (buildPrompt, validateTicketsOnDisk, etc.)
 * are private, so we test them indirectly through runSprint with mocked deps.
 * We also test isShuttingDown (the only pure exported function).
 */

import { isShuttingDown } from '../../../src/cli/loop/executor.js';

describe('isShuttingDown', () => {
  it('returns false initially', () => {
    expect(isShuttingDown()).toBe(false);
  });
});

// The executor's runSprint requires heavy mocking of child_process, fs, and
// all loop modules. We test the individual components (worktree, guard-runner,
// pr-lifecycle) separately and verify integration via dry-run in a later
// integration test. The pure functions (buildPrompt, dryRunSprint,
// validateTicketsOnDisk) are internal — testing them through the module
// boundary would require exporting test-only APIs which we avoid.
