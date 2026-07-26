# S259 Code Review — Implementation Correctness (#660)

- **Reviewer:** self-review (implementation-correctness lane) — no subagents per standing constraint
- **Lane:** code (baseline)
- **Verdict:** pass

## Reviewed diff
`src/cli/roadmap-source-store.ts`, `src/cli/commands/validate.ts`, `src/cli/commands/roadmap.ts`, `src/core/roadmap.ts` + tests.

## Checks

1. **Guard placement & early return.** The pre-lock conflict guard runs before the `changed` computation and both the dry-run and locked write paths, so a conflicting sprint writes nothing in either mode. The dry-run path returns before acquiring the lock — no side effects. Correct.

2. **Idempotence.** `authoredStatus !== 'complete'` short-circuits the guard for an already-complete sprint, so re-reconciliation is a no-op reconcile, not a false conflict. Covered by the "already-complete" tests (both write and dry-run).

3. **TOCTOU re-check return shape.** The in-lock early return uses `as const` on the literal fields so the closure's inferred return type stays assignable to `CompleteRoadmapSourceSprintResult`. Typecheck clean confirms.

4. **`force` threading.** `force` is optional and defaults falsy; only `slope roadmap complete` sets it. `validate`'s call omits it, so the automatic path is always safe. No other caller of `completeRoadmapSourceSprint` passes force.

5. **validate reporting.** The `skipped === 'status_conflict'` branch `continue`s past the "reconciled -> complete" log, so a conflict never prints a misleading success line; `ok` is untouched so exit status is unaffected. Message includes the authored status and the exact override command.

6. **`isRoadmapSprintPending` predicate.** Now `!terminal && !deferred`. `isRoadmapSprintTerminal` unchanged, so `deferred` is not counted as terminal anywhere (rollover audit, migration classification, `slope now` terminal check all still see it as non-terminal). The two predicates are intentionally not complements — verified this is the desired asymmetry.

7. **Off-by-one / ordering.** No numeric-ordering changes; `findNextPlannedSprint` still sorts by `compareRoadmapSprintIds`. deferred is filtered out pre-sort, so a deferred sprint between two selectable ones does not perturb ordering.

## Test adequacy
- Deliberate statuses (6) each asserted to be preserved + reported, in both write and dry-run modes.
- In-flight statuses (4) each asserted to still promote.
- force override, already-complete no-op, validate-level reporting, findNextPlannedSprint skip, and all-deferred → null.

## Required fixes
None.
