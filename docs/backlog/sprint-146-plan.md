# Sprint 146 Plan - Roadmap Hygiene and Decimal Artifact Reality Checks

## Purpose

Remove stale roadmap signals after the recovery train and fix the validator issue
that kept completed inserted sprints looking unshipped.

## Tickets

| Ticket | Title | Club | Verification |
| --- | --- | --- | --- |
| S146-1 | Mark obsolete S128/S129 roadmap entries terminal and Phase 41/43 complete | wedge | `slope roadmap status` no longer shows Phase 41 pending/blocked work |
| S146-2 | Recognize decimal sprint scorecard and review artifacts as shipped commits (#522) | short_iron | `vitest tests/core/analyzers/git.test.ts` |
| S146-3 | Restore explicit next sprint target and validate roadmap freshness | wedge | `slope roadmap validate`, `slope roadmap status`, `slope map --check` |

## Hazards

- Do not mark S128/S129 complete without scorecards; use `superseded` because the issues were closed through later recovery work.
- Decimal sprint artifact detection should preserve integer behavior and should not revive bare decimal subject parsing as shipped work.
- Keep S147 as planning context only; do not start implementation in this hygiene sprint.

## Done Criteria

- Phase 41 is terminal and no longer shows pending/blocked work.
- Roadmap status points at a concrete next planned S147 after S146 completes.
- #522 has regression coverage and closes on merge.
- S146 scorecard and review artifacts validate.
