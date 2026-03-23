# Sprint 69 Plan — The Patch Kit (S68 Carryover Fixes)

**Par:** 3 (3 tickets)
**Slope:** 2 (cross-cutting: core types, store, guard system, CLI)
**Theme:** Fix carryover bugs and coverage gaps from S68 review findings

## Tickets

### T1: Fix `slope review amend` crash — `hole_stats` → `stats` normalization
**Club:** short_iron
**Files:** `src/core/loader.ts`, `src/cli/commands/review-state.ts`, `tests/cli/review-amend.test.ts`

**Problem:** `amendScorecardWithFindings` reads `scorecard.stats.putts` (line 178 of `review.ts`), but raw scorecard JSON uses `hole_stats` not `stats`. The CLI `amendCommand` does `JSON.parse(...) as GolfScorecard` (line 389 of `review-state.ts`) without normalization, so `scorecard.stats` is `undefined` → crash.

`loadScorecards` in `loader.ts` has the same issue — `...raw` spread preserves `hole_stats` key.

**Approach:**
- Add a `normalizeScorecard(raw: unknown): GolfScorecard` function in `loader.ts` that maps `hole_stats` → `stats` (and `sprint` → `sprint_number` which it already does inline)
- Use it in both `loadScorecards` and `amendCommand`
- Add tests for the normalization (round-trip: raw JSON → normalize → access `.stats.putts`)
- Add a regression test for `amendScorecardWithFindings` with a raw JSON scorecard

**Hazard watch:** `GolfScorecard` has many optional fields — normalization must preserve them all.

### T2: Implement `workflow-step-gate` guard
**Club:** short_iron
**Files:** `src/cli/guards/workflow-step-gate.ts` (new), `src/core/guard.ts`, `tests/cli/guards/workflow-step-gate.test.ts` (new)

**Problem:** `workflow-step-gate` is registered in `GUARD_DEFINITIONS` (line 244 of `guard.ts`) with description "Check if current workflow step allows agent_work before editing" — but no implementation function exists. The guard should block Edit/Write when the current workflow step type is not `agent_work`.

**Approach:**
- Create `src/cli/guards/workflow-step-gate.ts` implementing the guard function
- Guard logic: load active workflow execution from store → check current step type → block if not `agent_work`, allow if `agent_work` or no active execution
- Register the implementation in the guard runner (check how other guards like `workflow-gate` wire up)
- Tests: block when step is `command`/`validation`, allow when `agent_work`, allow when no active execution, allow when no workflow running

**Hazard watch:** S67 finding — `VALID_STEP_TYPES` was duplicated between `workflow.ts` and `workflow-validator.ts`. Use the exported `VALID_STEP_TYPES` from `workflow.ts`.

### T3: Add S67 race condition regression test
**Club:** wedge
**Files:** `tests/store/index.test.ts`

**Problem:** S67 found that `recordStepResult` had a race condition — read-modify-write on `completed_steps` JSON wasn't wrapped in a transaction. The fix (transaction wrapping) landed in S67 but has no regression test proving concurrent calls are safe.

**Approach:**
- Add a test that calls `recordStepResult` concurrently (Promise.all with 2-3 calls for different steps on the same execution)
- Assert: all step results recorded, `completed_steps` JSON array has all entries, no duplicates, no missing entries
- This proves the transaction prevents the lost-update anomaly

**Hazard watch:** SQLite serializes transactions anyway — but the test still proves the code path is correct and prevents regression if someone removes the transaction wrapper.

## Review Tier

**Light** (1 round) — 3 tickets, familiar patterns, all bug fixes / coverage gaps.

## Dependencies

- T1 is independent
- T2 is independent
- T3 is independent
- All three can be worked in any order
