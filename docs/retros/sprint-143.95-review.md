# Sprint 143.95 Review: Atomic Write Lock Contention Hardening

## Outcome

S143.95 closes #515 by hardening `withFileLockSync` against transient Windows lock-open errors.

- Windows `EPERM`/`EACCES` during lock open now retry through the existing bounded acquisition loop.
- Timeout diagnostics include the last acquisition error code instead of hiding persistent failures.
- Added a Windows-specific regression for transient `EPERM`.
- Repeated focused atomic-write runs and the full-suite rerun passed.

## Review

Architect review: required, complete. The lock semantics stay simple: exclusive create still owns the lock, contention still waits, stale locks still use the existing cleanup path, and all waiting remains bounded by the caller's timeout.

Code review: optional, complete. The new regression mocks only the lock-open boundary and verifies the callback, close, and lock cleanup behavior after a transient Windows error.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/cli/atomic-write.test.ts tests/cli/atomic-write-lock.test.ts`
- Five additional focused atomic-write stress reruns
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test` (first run exposed a non-repeatable auto-card blip; rerun passed)
- `node dist/cli/index.js map --check`

## Learning

Windows file-lock creation can fail as `EPERM` or `EACCES` under contention, not just `EEXIST`. Treat those as acquisition contention, but keep them in the existing timeout loop so persistent permission failures still surface.
