## Sprint 227 Review: Review Output Selection and Side-Effect Safety

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 2 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (2/2) |
| GIR % | 100% (2/2) |
| Putts | 1 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 2)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S227-1 | Short Iron | In the Hole | — | Review discovers canonical scorecards centrally, permits implicit selection only when exactly one exists, supports --sprint, and fails with a concrete recovery command when history is ambiguous. |
| S227-2 | Wedge | Green | Rough: Removing latest-card guessing also required updating the built-in workflow, completion guidance, and agent recommendations so mature repositories retained an executable command.; Bunker: Independent architecture review found that the PostToolUse guard could reintroduce cross-sprint gate mutation and that three runtime guidance surfaces still emitted the obsolete bare command. Both findings were fixed and independently re-reviewed. | Default output is adjacent to the selected scorecard, status text is emitted on stderr, and historical review generation cannot complete a different active sprint's review gate. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The legacy implicit-latest behavior was embedded in both the command and its workflow consumers, so the contract change needed cross-surface validation. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S227-2 | Removing latest-card guessing also required updating the built-in workflow, completion guidance, and agent recommendations so mature repositories retained an executable command. |
| Bunker | S227-2 | Independent architecture review found that the PostToolUse guard could reintroduce cross-sprint gate mutation and that three runtime guidance surfaces still emitted the obsolete bare command. Both findings were fixed and independently re-reviewed. |

**Known hazards for future sprints:**
- Never select a write target by latest-file convention when more than one durable artifact exists.
- Status messages for stdout-capable commands belong on stderr.
- Historical artifact generation must not mutate the active sprint unless sprint identities match.
- When tightening a CLI contract, update all workflow-generated invocations in the same sprint.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | A write-producing command must not infer its target from a directory containing durable history. | Ambiguous review selection now fails closed and offers explicit path and sprint selectors. |
| Lessons | Artifact generation and lifecycle mutation are separate side effects with separate scope checks. | Historical review output stays historical and does not satisfy the current sprint's gate. |
| Lessons | Machine-readable stdout must not be contaminated by operational status messages. | Review markdown remains on stdout while write confirmation goes to stderr. |
| Lessons | A direct-command boundary fix is incomplete until hook-driven mutation paths and every generated invocation are reviewed independently. | The independent reviewer caught and verified repairs for the PostToolUse gate path and remaining runtime consumers. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused review, workflow, agent, and completion suites passed: 138 tests across six files. |
| testing | healthy | The complete Vitest suite passed after the focused contract tests. |
| build | healthy | Typecheck and build passed, including packages/pi-extension. |
| slope | healthy | Roadmap validation passed and review requirements were persisted before closeout. |

### Course Management Notes

- Focused and full validation passed; the branch is pushed but no merge is implied.
- The recommended independent architecture review requested changes, verified the follow-up, and approved the end-to-end historical/current sprint boundary.

### 19th Hole

- **How did it feel?** A small CLI ambiguity exposed a broader rule: durable historical artifacts need explicit identity at every write boundary.
- **Advice for next player?** When making selection stricter, search every generated command and workflow step that depended on the old default.
- **What surprised you?** The output-path bug and the gate-mutation bug shared the same missing selected-sprint identity.
- **Excited about next?** The roadmap focus API can apply the same explicit-identity rule to bounded planning context.

