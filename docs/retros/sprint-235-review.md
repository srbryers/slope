## Sprint 235 Review: Safe Roadmap Migration Planner

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 4 |
| Score | 6 |
| Label | Double Bogey |
| Fairway % | 50% (2/4) |
| GIR % | 50% (2/4) |
| Putts | 2 |
| Penalties | 0 |
| Hazard Penalties | 2 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S235-1 | Driver | Missed Right | Bunker: The first applicable contract did not prove that strict target sources could parse and compile without semantic drift. | The final plan is source-bound, target-schema-valid, and binds the exact expected compatibility projection digest. |
| S235-2 | Long Iron | Green | — | Ownership ambiguity fails closed, bounded legacy shapes are audited, nested fields are preserved, and non-core blocks are exported losslessly. |
| S235-3 | Long Iron | Missed Right | Rough: Initial phase and scorecard mapping consumption was incomplete, and absent before-values disappeared from serialized audit evidence. | All mappings are now consumed strictly with verified path-safe evidence, and absent values use a durable JSON sentinel. |
| S235-4 | Short Iron | Green | — | A 456-sprint regression proves bounded diagnostics, complete repair templates, stable ordering, and identical hashes across mapping insertion order. |

### Miss Pattern

| Direction | Count |
|---|---|
| Right (spec drift) | 2 |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | major | A migration plan must describe legacy repairs while also proving that the strict target representation will preserve the intended projection. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S235-1 | The first applicable contract did not prove that strict target sources could parse and compile without semantic drift. |
| Rough | S235-3 | Initial phase and scorecard mapping consumption was incomplete, and absent before-values disappeared from serialized audit evidence. |

**Known hazards for future sprints:**
- Do not declare a migration plan applicable until strict target parsing and cross-reference validation pass.
- Preserve authored compatibility aliases through the compiler boundary, not only in the planner object.
- Represent absent audit values explicitly; JSON drops undefined object properties.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Planner applicability must mean the consumer can render and validate the exact target, not merely that legacy analysis completed. | The planner validates the target schema and binds the expected compiled projection digest. |
| Lessons | Explicit mappings are an audit boundary and every supplied entry must be used or rejected. | Ownership, ticket, phase-kind, and scorecard mappings now fail closed when stale, unnecessary, unverified, or mismatched. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | One hundred seventeen focused planner, source-federation, and roadmap tests passed after review repair. |
| build | healthy | TypeScript typecheck passed with the final planner contract. |
| review | healthy | Independent review rejected five contract gaps; all were repaired and final re-review approved. |

### Course Management Notes

- Planner implementation and independent review evidence are pushed; the transactional apply sprint remains active and no PR merge or release is implied.

### 19th Hole

- **How did it feel?** Analysis was easy to make descriptive; making it an executable, fidelity-bound contract was the difficult part.
- **Advice for next player?** Treat applicable as a guarantee to the writer, and hash the exact compiled artifact the writer must produce.
- **What surprised you?** A parser that accepted id-only tickets still silently materialized a key during structural casting.
- **Excited about next?** The transaction layer can now consume a plan without guessing or discovering schema failures mid-write.

