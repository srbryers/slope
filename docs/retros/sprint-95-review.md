
## Sprint 95 Review: Inserted Sprint Recovery — make next/status respect sub-sprints

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S95-1 | Short Iron | Green | Rough: The initial encoded-id rule was too broad and would have displayed future canonical three-digit sprints ending in a non-zero digit as inserted sub-sprints. | Added roadmap helpers for encoded half-sprint ids, natural decimal ids, human labels, and ordering. Architect review narrowed encoded integer support to half-sprints ending in 5 so S101 and S203 remain canonical. |
| S95-2 | Short Iron | In the Hole | — | Added shared sprint inference and wired next, status, briefing, agent status, and claim defaults to pending roadmap context before scorecard+1 fallback. |
| S95-3 | Short Iron | Green | — | Claim-required now includes an inferred sprint hint when implementation edits happen without active sprint state, preferring pending roadmap context and falling back to branch or commit references. |
| S95-4 | Wedge | In the Hole | — | Added core, loader, next, agent, guard, and ticket-done tests plus getting-started docs for decimal labels and encoded half-sprint ids. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| rough | moderate | A pending inserted roadmap sprint can be older than the latest scorecard, so scorecard+1 was the wrong fallback for no-state recovery. |
| Pin Position | minor | The roadmap currently needs encoded integer ids for state/store compatibility, but user-facing labels still need to read as S43.5. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S95-1 | The initial encoded-id rule was too broad and would have displayed future canonical three-digit sprints ending in a non-zero digit as inserted sub-sprints. |

**Known hazards for future sprints:**
- Encoded inserted ids must stay narrow; broad three-digit decoding mislabels future canonical sprints.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Inserted sprint support needs both ordering tests and user-facing command tests. | Added regression coverage for roadmap validation, scorecard filename loading, next/status inference, guard hints, and ticket completion. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| review | healthy | SLOPE PR review flow was run after PR creation and again after the amended fix. |

### Course Management Notes

- Use natural decimal roadmap ids when possible; use encoded half-sprint integer ids like 435 when integer storage compatibility is required.
- Start encoded inserted sprints with the roadmap id, for example slope sprint start --number=435 --phase=implementing.
- Full local suite passed after the implementation and after the architect-review fix: 200 test files, 3355 tests.

### 19th Hole

- **How did it feel?** A compact recovery sprint with one real architectural edge: keeping encoded inserted ids useful without corrupting future three-digit canonical sprint labels.
- **Advice for next player?** When adding new sprint-number semantics, test canonical boundary values as well as the special case. S100, S101, and S203 are just as important as S43.5.
- **What surprised you?** The no-state inference needed to avoid older incomplete canonical roadmap entries while still recovering inserted sub-sprints that sort before the latest scorecard.
- **Excited about next?** Release this so agents recovering in repos with inserted work get the right sprint context from the roadmap instead of silently drifting to scorecard+1.

