
## Sprint 258 Review: Canonical Sprint IDs

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 5 |
| Score | 6 |
| Label | Bogey |
| Fairway % | 100% (5/5) |
| GIR % | 100% (5/5) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 1 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S258-1 | Driver | Green | -- | src/core/sprint-id.ts: sprintIdKey (exact string, trailing zeros preserved), parseSprintId (base + insert + digits), compareSprintIdKeys (inserts by integer value, .9 before .10), sprintIdsEqual. Deliberately no legacy 435 => 43.5 decode (needs roadmap evidence). Fully unit-tested and committed as a safe foundation before any integration. |
| S258-2 | Driver | Green | Bunker: The scope was under-estimated at planning. I presented the roadmap+identity layer as bounded (add id_key to sprints), but #635's real scenario (458.1 … 458.9 coexisting with 458.10) required canonical threading through phase membership, compile uniqueness, the logical-collision check, validateRoadmap's duplicate and ticket-prefix checks, and dependencies — because all keyed on the numeric id. That is materially larger than the framing the operator chose the scope under, and closer to the full-migration size I had recommended against. | Dual representation: id/sprints stay numeric mirror; id_key/sprint_keys hold the canonical form, present only when string-authored. Every existing all-numeric roadmap is untouched (id_key absent, prior numeric path). RoadmapSprint.id_key and RoadmapPhase.sprint_keys added. |
| S258-3 | Long Iron | Green | Rough: The logical_sprint_collision check keyed on roadmapSprintOrderValue (a float), which would false-positive on 458.1 vs 458.10 (both float 458.1). Rerouted through roadmapSprintKey so distinct id_keys don't collide while a legacy 435 and explicit 43.5 still resolve to the same '43.5' key. A float-based identity check is exactly what #635 is about; it had to be replaced, not patched. | Federation uniqueness/membership and validateRoadmap identity checks now key by canonical string. Verified end to end: a phase with 458.1/458.9/458.10/458.11 parses, validates, and compiles with all four distinct in the projection. |
| S258-4 | Short Iron | Green | -- | The roadmap scorecards map is already string-keyed and validated as \d+(\.\d+)?, so 458.10 -> sprint-458.10.json is already preserved distinctly. Verified; no change needed at the roadmap layer. |
| S258-5 | Short Iron | Green | -- | An unquoted trailing-zero id is still rejected (a number cannot hold it), but the message now leads with the fix that works — quote it (id: "458.10") — then the renumber options. depends_on also accepts a canonical string reference. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S258-2 | The scope was under-estimated at planning. I presented the roadmap+identity layer as bounded (add id_key to sprints), but #635's real scenario (458.1 … 458.9 coexisting with 458.10) required canonical threading through phase membership, compile uniqueness, the logical-collision check, validateRoadmap's duplicate and ticket-prefix checks, and dependencies — because all keyed on the numeric id. That is materially larger than the framing the operator chose the scope under, and closer to the full-migration size I had recommended against. |
| Rough | S258-3 | The logical_sprint_collision check keyed on roadmapSprintOrderValue (a float), which would false-positive on 458.1 vs 458.10 (both float 458.1). Rerouted through roadmapSprintKey so distinct id_keys don't collide while a legacy 435 and explicit 43.5 still resolve to the same '43.5' key. A float-based identity check is exactly what #635 is about; it had to be replaced, not patched. |

**Known hazards for future sprints:**
- src/core/roadmap-sources.ts and src/core/roadmap.ts: sprint identity was keyed on the numeric id or the float order value in ~6 places (uniqueness, membership, collision, duplicate, ticket-prefix). Any float-based identity check cannot distinguish 458.10 from 458.1.
- Display labels (formatRoadmapSprintLabel) take a numeric id, so a string-id sprint still DISPLAYS as S458.1 — the label functions can't reach id_key without the sprint object. Threading that spans ~11 caller files; latent because no real roadmap uses string ids yet.

### Course Management Notes

- I under-scoped the estimate when the operator was choosing depth. When a change touches an identity that is structurally numeric, assume every numeric reference to that identity is in scope, not just the obvious field.
- Committing the core module as a standalone, fully-tested foundation before integration was the right call: it made the large integration verifiable in layers and kept a green baseline throughout.

