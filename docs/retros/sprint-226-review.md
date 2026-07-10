## Sprint 226 Review: Workflow Runtime and MCP Scorecard Contract

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 1 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S226-1 | Short Iron | Green | Rough: Current v1.60 code already auto-filled required tickets from a roadmap after #480; the remaining contract gap was precise failure guidance when no default exists. | Built-in sprint-standard coverage now proves roadmap ticket defaults are deterministic, and missing defaults explain the accepted list/JSON/count forms instead of surfacing a bare required-variable error. |
| S226-2 | Short Iron | Green | Rough: A compound validation/commit shell continued after the new zero-count test failed because the assertion expected the error one engine transition too late; an immediate follow-up corrected the test and reran it green. | The engine expands tickets=N into N canonical sprint ticket iterations, rejects zero and excessive counts, and continues through every pre-shot/implementation/post-shot cycle before post-hole. |
| S226-3 | Short Iron | In the Hole | — | buildScorecard now performs runtime validation and canonicalizes the early MCP ticket alias plus string hazards into ticket_key and structured HazardHit records before computing stats or returning JSON. |
| S226-4 | Short Iron | In the Hole | — | Builder score defaults now start from par and add recorded misses/hazard/manual penalties, with an explicit judged score override. Seven clean tickets on par 5 remain par instead of mechanically scoring seven. MCP registry types and examples document the contract. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The issue reports were filed against v1.58.4, so each repro was compared with the v1.60 branch before changing current contracts. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S226-1 | Current v1.60 code already auto-filled required tickets from a roadmap after #480; the remaining contract gap was precise failure guidance when no default exists. |
| Rough | S226-2 | A compound validation/commit shell continued after the new zero-count test failed because the assertion expected the error one engine transition too late; an immediate follow-up corrected the test and reran it green. |

**Known hazards for future sprints:**
- Workflow repeat inputs need runtime cardinality normalization before state-machine advancement.
- MCP execute bypasses TypeScript, so exported builders must validate and normalize raw JavaScript objects.
- Scorecard base score should be par, not ticket count, because par already represents sprint size.
- Do not combine validation and commit commands in a shell sequence that can continue after a failed test.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | A repeated-variable schema needs one canonical representation plus explicit CLI shorthands; accepting a scalar without interpretation turns a count into one item. | tickets accepts list, JSON array, or positive count with deterministic iteration identity. |
| Lessons | Static TypeScript input types do not protect MCP execute JavaScript calls. | buildScorecard validates and normalizes its runtime boundary before computing or serializing. |
| Lessons | Par already encodes ticket-count complexity, so using shot count as base score double-counts sprint size. | Score defaults are quality-relative-to-par and large clean sprints no longer appear as automatic misses. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused workflow suites passed: 91 tests across four files; builder/MCP/review/validation suites passed: 178 tests across five files. |
| testing | healthy | Full Vitest passed: 238 files and 3766 tests, with 25 store-pg tests skipped by configuration. |
| build | healthy | Typecheck and build passed, including packages/pi-extension. |
| slope | healthy | Roadmap validation and review recommendation passed; S226 requires architect review and records the disposition explicitly at closeout. |

### Course Management Notes

- Focused and full validation passed after the immediate zero-count assertion repair.
- S226 is stacked behind S224/S223; no PR merge is implied.
- The required architect review cannot be delegated under the current tool policy without an explicit user request, so closeout uses the separately visible waiver path introduced in S224.

### 19th Hole

- **How did it feel?** The two reports shared the same root cause: a typed declarative contract was not enforced at the runtime boundary agents actually use.
- **Advice for next player?** For MCP and workflow inputs, test the exact untyped payload an agent sends, not only the TypeScript-friendly happy path.
- **What surprised you?** The roadmap defaulting half of #581 was already repaired, but the numeric count still silently collapsed to one loop item.
- **Excited about next?** Review output safety can now consume canonical scorecards, and the later roadmap work can reuse the same compile/validate boundary pattern.

