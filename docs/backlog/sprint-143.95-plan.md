# Sprint 143.95 Plan - Atomic Write Lock Contention Hardening

## Objective

Close #515 by hardening `withFileLockSync` and its concurrent regression against transient Windows EPERM lock-open contention under full-suite load.

## Tickets

| Ticket | Title | Club | Complexity |
| --- | --- | --- | --- |
| S143.95-1 | Reproduce or characterize Windows EPERM lock-open contention (#515) | short_iron | standard |
| S143.95-2 | Harden withFileLockSync lock acquisition for transient EPERM (#515) | short_iron | standard |
| S143.95-3 | Stabilize atomic-write concurrency regression under full-suite load (#515) | wedge | small |

## Hazards

- Focused atomic-write tests can pass while full-suite contention exposes transient Windows EPERM.
- Do not paper over real lock failures; retry only known transient acquisition states.
- Keep the lock semantics simple and auditable.

## Acceptance Criteria

- The Windows lock acquisition path handles transient EPERM during concurrent lock attempts.
- The atomic-write concurrency test passes reliably under full-suite conditions.
- Regression coverage represents the Windows lock-open contention class without adding flake.
