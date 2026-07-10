## Sprint 230 Review: Replan-Aware Briefing Hazard Provenance

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 6 |
| Label | Double Bogey |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 2 |
| Penalties | 0 |
| Hazard Penalties | 2 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S230-1 | Long Iron | Green | Rough: The first real SLOPE smoke followed the full transitive dependency chain and admitted 296 hazards. Defaults were narrowed to active, direct-dependency, and prior same-phase evidence, with transitive history available only by explicit keyword. | Derived source sprint, source phase, target sprint, target phase, relationship, and active/historical relevance without mutating durable scorecards or the public raw hazard index. |
| S230-2 | Short Iron | Green | Bunker: Independent review found that phase-wide text and any single overlapping token could validate stale sibling work, while broad copular matching could erase ordinary risk states. Matching now uses only the target sprint row, strong overlap or exact phrase evidence, and explicit assignment forms. | High-confidence route clauses are compared to the current sprint assignment; unmatched clauses are removed while ambiguous state, negative, vulnerability, and dependency-gating language is preserved. |
| S230-3 | Short Iron | Green | Bunker: Adversarial review found clause suppression could remove valid prefix/suffix risk or carry across sentence boundaries. Clause parsing now preserves durable semicolon, colon, dash, prefix, suffix, Because, and Then evidence around stale routing text. | Briefing lines label active, direct/transitive dependency history, prior phase history, and unrelated history; suppression is counted without echoing stale prose. Canonical 43.5 identity is consistent across rendering and skills. |
| S230-4 | Wedge | In the Hole | — | Added exact Fathoms CLI coverage plus unit matrices for mixed clauses, false positives, low-information assignments, future/transitive history, role isolation, skill sanitation, display caps, and encoded IDs. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | major | Legacy scorecards contain unstructured prose, so the solution had to improve current routing safety without pretending to infer semantics or rewriting historical evidence. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S230-1 | The first real SLOPE smoke followed the full transitive dependency chain and admitted 296 hazards. Defaults were narrowed to active, direct-dependency, and prior same-phase evidence, with transitive history available only by explicit keyword. |
| Bunker | S230-2 | Independent review found that phase-wide text and any single overlapping token could validate stale sibling work, while broad copular matching could erase ordinary risk states. Matching now uses only the target sprint row, strong overlap or exact phrase evidence, and explicit assignment forms. |
| Bunker | S230-3 | Adversarial review found clause suppression could remove valid prefix/suffix risk or carry across sentence boundaries. Clause parsing now preserves durable semicolon, colon, dash, prefix, suffix, Because, and Then evidence around stale routing text. |

**Known hazards for future sprints:**
- Treat phase prose as provenance only; compare assignment premises with the selected sprint row.
- Explicit role defaults must not behave like explicit user requests for historical expansion.
- Reset suppression at sentence boundaries and preserve durable clauses surrounding stale prose.
- Use roadmap-aware equality, labels, and ordering together for legacy inserted sprint IDs.
- Smoke-test bounded projections against real accumulated history, not only small fixtures.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Phase metadata is provenance, not truth about one sprint's current assignment. | Route validation uses target-row theme, type, note, outcome, and tickets only. |
| Lessons | Automatic de-staling must be conservative because false positives erase operational risk. | Only explicit assignment forms are classified; ordinary state, negation, vulnerability, and gate language survives. |
| Lessons | Context bounds must be tested on accumulated project history. | The real SLOPE smoke reduced default candidates from 296 to 18 before the display cap. |
| Lessons | Logical sprint identity is a cross-consumer contract. | Strategic context, next-sprint selection, hazard ordering, requested scorecards, and skill evidence all resolve 435/43.5 consistently. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Independent architecture verification passed 180 focused tests; adversarial verification passed 114 focused tests. |
| testing | healthy | The complete repository suite passed: 3,790 tests. |
| build | healthy | Production build and TypeScript typecheck passed, including packages/pi-extension. |
| review | healthy | Both independent lanes requested changes across multiple rounds and approved the conservative final classifier. |

### Course Management Notes

- All implementation and review-repair commits are pushed; no PR merge is implied.
- Independent architecture and adversarial reviewers approved the final implementation with tracked evidence.
- The lexical matcher is intentionally conservative; unknown paraphrases remain visible rather than risking silent loss of valid hazards.

### 19th Hole

- **How did it feel?** The hard part was not finding stale prose; it was proving we would not erase valid dependency risk while removing it.
- **Advice for next player?** Keep future provenance structured at write time so later briefings need less lexical inference.
- **What surprised you?** Role emphasis and transitive dependencies each reopened large amounts of history through otherwise reasonable defaults.
- **Excited about next?** S231 can use the same explicit identity and durable-event principles for auditable sprint rollover.

