# Sprint 143.6 Plan - Decimal Sprint Status Parsing

<!-- Generated manually during S143.5 closeout after #511 was discovered. Regenerate when roadmap or hazards change. -->

**Par:** 3  |  **Slope:** 1  |  **Type:** cli bugfix

## Objective

Decimal Sprint Status Parsing

## Tickets

| Key | Title | Club | Complexity | Depends on |
|---|---|---|---|---|
| S143.6-1 | Parse decimal sprint overrides in status command (#511) | wedge | small | - |
| S143.6-2 | Add decimal and invalid sprint status regressions (#511) | wedge | small | S143.6-1 |

## Dependencies

- S143.5 (complete)

## Recommended Order

1. S143.6-1
2. S143.6-2

## Required Gates

Before marking the sprint complete:
- tests
- code_review
- architect_review
- scorecard
- review_md

## Required Checks Before Commit

- `pnpm typecheck` (or project-equivalent)
- focused status command tests
- `slope roadmap validate`
- `slope commit-ready`

## Hazards

- `parseInt` silently truncates decimal sprint ids.
- Decimal sprint support is already used by roadmap, sprint-state, claims, and scorecards.
- Invalid `--sprint` input should fail clearly instead of resolving to partial numeric data.

## Acceptance Criteria

Each ticket lands with:
- `slope status --sprint=143.5` displays S143.5 claims
- invalid sprint flags fail clearly
- integer sprint status behavior remains unchanged
- scorecard validated

## Suggested Commit Boundaries

One implementation/test commit, then one closeout artifact commit.
