# Sprint 143.8 Plan - Decimal Sprint Currency Formatting

## Objective

Close #513 by formatting decimal sprint currency deltas without floating-point artifacts in `slope map --check`.

## Tickets

| Ticket | Title | Club | Complexity |
| --- | --- | --- | --- |
| S143.8-1 | Format decimal sprint currency deltas without floating-point noise (#513) | wedge | small |
| S143.8-2 | Add decimal sprint currency map-check regression (#513) | wedge | small |

## Hazards

- Decimal sprint ids expose JavaScript floating-point artifacts when subtracted directly.
- Keep this to output formatting; do not change sprint ordering semantics.

## Acceptance Criteria

- `slope map --check` formats a 143.6 vs 143 sprint currency delta as a clean decimal.
- Regression coverage includes a decimal current sprint compared with an integer map sprint.
