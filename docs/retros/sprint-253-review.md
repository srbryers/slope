
## Sprint 253 Review: Diagnosability and Branch Workflow

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 2 |
| Score | 5 |
| Label | Par |
| Fairway % | 100% (5/5) |
| GIR % | 100% (5/5) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S253-1 | Short Iron | In the Hole | -- | A 40-term boolean chain became describeAuditShapeProblem returning the first specific problem, with array indices. Verified by breaking each field in a real audit. The original message named no field, which is why the real cause — an absent rather than malformed field — took a source read to find. |
| S253-2 | Wedge | Green | Rough: Backticks in a python -c string were command-substituted by bash, silently stripping every code span from the written rule. Second escaping incident this phase and third overall; the S248 scorecard already says to write scripts as files rather than inline. Rewrote from a file. | Recommends one phase branch with per-sprint commits, and states the three rules if stacking anyway: merge commit not squash, never --delete-branch a base with dependents, merge in order. Also records the per-branch scorecard and rollover-audit requirement. |
| S253-3 | Short Iron | Green | -- | pr-review emits the stack rules when --base is neither main nor master, so they are seen at creation rather than at merge. Landing Phase 55-56 as four stacked PRs cost three recoveries to exactly these. |
| S253-4 | Short Iron | Green | Bunker: Prompted by the operator asking whether the scope-drift guard was useful at all. A claim on '.' silenced nothing because both matchers built the prefix './', which no relative path starts with — so claiming the repo was impossible to express and every write was reported as drift. Two independent copies of the logic needed the same fix. | isWithinClaimedArea and claimOverlapsPath both handle root claims now, with tests; a narrow claim still scopes correctly. They should probably be one function. |
| S253-5 | Wedge | Green | -- | dedupGuardContext substituted a note about the budget itself for every guard on every fire, naming no file and no action, spending context to announce there was none left. Now returns empty; writeGuardOutput already treats empty context as no output. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S253-2 | Backticks in a python -c string were command-substituted by bash, silently stripping every code span from the written rule. Second escaping incident this phase and third overall; the S248 scorecard already says to write scripts as files rather than inline. Rewrote from a file. |
| Bunker | S253-4 | Prompted by the operator asking whether the scope-drift guard was useful at all. A claim on '.' silenced nothing because both matchers built the prefix './', which no relative path starts with — so claiming the repo was impossible to express and every write was reported as drift. Two independent copies of the logic needed the same fix. |

**Known hazards for future sprints:**
- Claim-area matching is duplicated in scope-drift and claim-required; changes must land in both.

### Course Management Notes

- scope-drift still has no value in a solo session — it exists for multi-agent claim coordination. Gating it on another live session or another actor's claim is left open on #651 as a design decision rather than patched.
- Answering 'is this guard useful?' honestly surfaced two real bugs. Worth doing for other advisory guards.

