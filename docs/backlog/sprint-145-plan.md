# Sprint 145 Plan - Validation Signal Repair

## Purpose

Close #519/#520 by removing false-positive validation signals that make healthy
external repositories look stale or incorrectly shipped.

## Tickets

| Ticket | Title | Club | Verification |
| --- | --- | --- | --- |
| S145-1 | Make shipped-commit detection ignore sprint-range endpoints while preserving ticket refs (#519) | short_iron | `vitest tests/core/analyzers/git.test.ts` |
| S145-2 | Make map staleness source counts reuse generator file-discovery rules (#520) | short_iron | `vitest tests/cli/commands/map.test.ts` |
| S145-3 | Validate roadmap and map regressions, then close issue references | wedge | build, typecheck, full test suite, roadmap/map checks |

## Hazards

- Keep ticket commit detection (`S78-1`) intact while rejecting range endpoints (`S64-S80`, `S85-S90`).
- Do not let SLOPE-self map behavior drift while fixing non-SLOPE multi-root repos.
- Focus the sprint on validation-signal correctness; handoff-continuity work remains outside this repair.

## Done Criteria

- #519 and #520 have regression coverage.
- `slope roadmap validate` no longer reports false shipped commits for sprint ranges.
- A freshly generated map in a non-SLOPE multi-root repo reports current on `slope map --check`.
- S145 scorecard and review artifacts validate.
