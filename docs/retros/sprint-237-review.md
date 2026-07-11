## Sprint 237 Review: Open issue regression fixes

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 0 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (2/2) |
| GIR % | 100% (2/2) |
| Putts | 1 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 2)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S237-1 | Short Iron | Green | - | Stopped scorecard shots from overwriting, deleting, or retitling existing roadmap tickets; added regression coverage for multi-ticket scorecard shots. |
| S237-2 | Wedge | In the Hole | - | Changed terminal sprint status output to show all-gates-complete without presenting stale phase: planning as current lifecycle truth. |

### Course Management Notes

- Issue-only sprints need explicit ticket representation in the scorecard when local roadmap tickets are absent.
