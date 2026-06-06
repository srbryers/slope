# Sprint 143.5 Plan - Commit-Ready Map Freshness Alignment

<!-- Generated manually during S143 closeout after #510 was discovered. Regenerate when roadmap or hazards change. -->

**Par:** 3  |  **Slope:** 2  |  **Type:** guard hardening

## Objective

Commit-Ready Map Freshness Alignment

## Tickets

| Key | Title | Club | Complexity | Depends on |
|---|---|---|---|---|
| S143.5-1 | Align commit-ready CODEBASE freshness with map --check semantics (#510) | short_iron | standard | - |
| S143.5-2 | Add historically tracked ignored CODEBASE regression for commit-ready (#510) | wedge | small | S143.5-1 |

## Dependencies

- S143 (complete)

## Recommended Order

1. S143.5-1
2. S143.5-2

## Required Gates

Before marking the sprint complete:
- tests
- code_review
- architect_review
- scorecard
- review_md

## Required Checks Before Commit

- `pnpm typecheck` (or project-equivalent)
- focused commit-ready/map regression tests
- `slope roadmap validate`
- `slope commit-ready`

## Hazards

- `CODEBASE.md` may be ignored/untracked in the current checkout while still having historical git entries.
- `slope map --check` and `slope commit-ready` currently use different freshness models.
- A recovery command suggested by a guard must clear the warning it recommends.
- Do not parallelize SLOPE state-writing commands during closeout.

## Acceptance Criteria

Each ticket lands with:
- `slope commit-ready` no longer warns stale when `slope map --check` reports CURRENT
- ignored/untracked maps are handled explicitly
- historically tracked but currently ignored `CODEBASE.md` regression coverage
- scorecard validated

## Suggested Commit Boundaries

One implementation/test commit, then one closeout artifact commit.
