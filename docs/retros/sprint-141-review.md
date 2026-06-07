# Sprint 141 Review: Workflow State Resync

## Outcome

S141 closes #503 by reconciling stale workflow and sprint-state before guards enforce it.

- Adds `src/cli/workflow-resync.ts` for shared workflow staleness detection, branch sprint inference, workflow fast-forwarding, and sprint-state rebinding.
- Extends `slope sprint workflow cleanup --stale` with newer-running-sprint and age-based stale detection.
- Adds `slope sprint workflow resync` to pause stale executions and fast-forward branch-local executions when sprint commits already exist.
- Updates `workflow-step-gate` to reconcile workflow executions before blocking edits on non-agent-work steps.
- Updates `sprint-completion` to rebind stale sprint-state to the branch-inferred sprint before PR creation gate checks.

## Review

Architect review: required, complete. The shared helper keeps reconciliation logic out of individual guards, and separates explicit cleanup behavior from edit-time behavior. The key review adjustment was making newer-running-sprint detection configurable so `workflow-step-gate` does not pause a legitimate older-branch execution merely because a newer execution exists.

Code review: optional, complete. Git probing uses argv-based `execFileSync`, parse failures fail open, and tests cover stale S65/S66 drift, age-based stale execution detection, branch-commit workflow fast-forward, and PR-gate rebind behavior.

## Validation

- `corepack pnpm vitest run tests/cli/sprint-workflow.test.ts tests/cli/guards/workflow-step-gate.test.ts tests/cli/guards/sprint-completion.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `slope roadmap validate`

## Learning

State reconciliation needs to be context-sensitive. Cleanup commands can close stale records aggressively, but guards should reconcile only from evidence that is safe for the current branch and user action.
