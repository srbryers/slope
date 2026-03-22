# Sprint 68 — The Fence: Workflow Engine Test Coverage

**Par:** 4 | **Slope:** 2 | **Type:** test

## Context

The workflow engine shipped in S67 (sprints 1-5) with 103 tests across 9 files. All source files have corresponding test files except the workflow-step-gate guard. The integration tests cover the happy path but lack edge case coverage for error recovery, corrupt state, and the CLI commands that tie everything together.

## Tickets

### T1 — Workflow gate guard dedicated tests (wedge)
- **File:** `tests/cli/guards/workflow-gate.test.ts` (new)
- **Source:** `src/cli/guards/workflow-gate.ts`
- Currently only referenced in `guards.test.ts` (registered in list) — no behavioral tests
- Test: gate blocks Edit/Write when workflow step is not `agent_work`
- Test: gate allows when step type is `agent_work`
- Test: gate allows when no active workflow execution
- Test: gate skips for non-Edit/Write tools

### T2 — Sprint CLI integration tests: run/status/resume/skip (short_iron)
- **File:** `tests/cli/sprint-workflow.test.ts` (new)
- **Source:** `src/cli/commands/workflow.ts` + sprint run integration
- Test `slope sprint run --workflow=sprint-standard` starts execution
- Test `slope sprint status` shows current step and progress
- Test `slope sprint resume` restarts a paused execution
- Test `slope sprint skip` skips current step with reason

### T3 — Built-in workflow E2E: autonomous + lightweight (short_iron)
- **File:** `tests/core/workflow-integration.test.ts` (extend existing)
- Currently only `sprint-standard` has an E2E test
- Add full E2E for `sprint-autonomous` (all phases, minimal gates)
- Add full E2E for `sprint-lightweight` (per_ticket → validate only)
- Verify variable interpolation and repeat_for work in each

### T4 — Engine edge cases + store failure conditions (long_iron)
- **File:** `tests/core/workflow-engine.test.ts` (extend) + `tests/core/workflow-store.test.ts` (new if needed)
- Error recovery: engine.fail() then resume from failed state
- Corrupt state: missing/malformed step results in store
- Race condition: concurrent complete() calls on same step (S67 hazard)
- Store: partial write recovery, completed_steps JSON integrity
- Stale cached state after mutations (S67 WorkflowAdapter hazard)

## Hazards to Watch

- **S67 rough:** SQLite recordStepResult race condition (read-modify-write not in transaction)
- **S67 rough:** WorkflowAdapter.status getter returns stale cached value after fail()
- **S67 rough:** started_at and completed_at always identical in step results
- **S67 bunker:** VALID_STEP_TYPES duplicated between workflow.ts and workflow-validator.ts
- **S24:** Vitest spy.mockRestore() clears mock.calls — read calls before restoring

## Review Tier

**Light** (1 round) — test-only sprint, familiar patterns, single package focus.
