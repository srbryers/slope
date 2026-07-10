## Sprint 228 Review: Focused Roadmap Context Projection

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 5 |
| Label | Bogey |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 1 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S228-1 | Long Iron | Green | Rough: Independent reconnaissance disagreed on successor semantics and exposed the context-free encoded-ID ambiguity; authored phase order and roadmap-aware labels were made explicit before implementation. | Added a versioned read model with full selected sprint, summary neighbors, phase contract, direct dependencies, bounded hazards/evidence, limits, and omission counts. |
| S228-2 | Short Iron | Green | Bunker: Independent architecture/data reviews found terminal status flattening, missing performance hazards, encoded 435/43.5 completion/evidence mismatch, and evidence-cap eviction. The follow-up fixed all four and was independently approved. | The pure builder follows authored phase order, preserves terminal truth, computes readiness separately, maps legacy IDs with roadmap context, and projects only selected/dependency/recent scorecard hazards. |
| S228-3 | Short Iron | In the Hole | — | The CLI requires an explicit selector, supports decimal/encoded IDs and custom paths, keeps JSON stdout pure, scopes reality warnings to the selected sprint, and supplies canonical file evidence. |
| S228-4 | Wedge | Green | Rough: The first real SLOPE smoke exposed a 5 KB top-level roadmap description leaking historical narrative into otherwise bounded JSON; the projection now emits only the roadmap name. | Core/CLI/help/registry tests cover bounds, shuffled source order, direct dependencies, phase neighbors, JSON purity, invalid selectors, missing phases, custom paths, canonical S225, decimal IDs, and encoded S43.5 evidence. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | moderate | The contract had to remain compatible with 131-sprint SLOPE history, a 455-sprint external repro, explicit decimal IDs, and legacy encoded half-sprint IDs. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S228-1 | Independent reconnaissance disagreed on successor semantics and exposed the context-free encoded-ID ambiguity; authored phase order and roadmap-aware labels were made explicit before implementation. |
| Bunker | S228-2 | Independent architecture/data reviews found terminal status flattening, missing performance hazards, encoded 435/43.5 completion/evidence mismatch, and evidence-cap eviction. The follow-up fixed all four and was independently approved. |
| Rough | S228-4 | The first real SLOPE smoke exposed a 5 KB top-level roadmap description leaking historical narrative into otherwise bounded JSON; the projection now emits only the roadmap name. |

**Known hazards for future sprints:**
- Bounded projections must test byte size on a real accumulated-history repository, not only row counts in fixtures.
- Preserve authored terminal statuses and compute readiness as a separate field.
- Roadmap-aware sprint identity must normalize labels, equality, ordering, scorecard completion, and evidence paths together.
- Prioritize selected-sprint evidence before applying global evidence caps.
- Focused hazards should include only selected, direct-dependency, and bounded recent-phase scorecards.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Bound row counts do not guarantee bounded payloads when a retained field contains accumulated history. | Real-repository smoke checks now verify byte size and removed the global roadmap description from focused JSON. |
| Lessons | Completion/readiness is computed state; superseded/cancelled/skipped is durable authored truth. | Focus preserves authored terminal status while representing operational readiness separately. |
| Lessons | Legacy sprint-ID compatibility must cover labels, equality, ordering, scorecards, and evidence together. | Roadmap-aware identity equivalence now handles canonical S455 and encoded S43.5 end-to-end. |
| Lessons | Evidence caps need priority rules or ancillary history can evict the selected sprint's canonical design records. | Roadmap source and selected sprint issue/design/artifact evidence are prioritized before ancillary scorecards. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused compatibility suites passed, including 135 tests after independent-review repairs. |
| testing | healthy | The complete Vitest suite passed after the initial implementation; repaired boundaries were then independently revalidated with focused suites and probes. |
| build | healthy | Typecheck and build passed, including packages/pi-extension. |
| slope | healthy | Roadmap validation passed; required architecture and recommended data-contract reviews both approved after changes. |

### Course Management Notes

- The branch is pushed and all S228 implementation commits are recorded; no PR merge is implied.
- Both independent review lanes requested changes, then approved the repaired implementation with durable evidence files.

### 19th Hole

- **How did it feel?** The read model was straightforward; the hard part was defining what bounded, relevant, and compatible mean across fifteen months of roadmap history.
- **Advice for next player?** Compile modular sources into this same RoadmapDefinition and keep focus completely source-agnostic.
- **What surprised you?** A single description string defeated row-level bounds, and encoded sprint compatibility failed independently at three identity surfaces.
- **Excited about next?** S229 can federate authoring sources without changing any focus consumers.

