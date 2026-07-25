
## Sprint 247 Review: Roadmap Projection Safety and Sprint Identity

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 5 |
| Score | 7 |
| Label | Double Bogey |
| Fairway % | 100% (5/5) |
| GIR % | 40% (2/5) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 2 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S247-1 | Driver | Missed Short | Bunker: The in-file _generated marker was implemented, then reverted. Making store.projection carry the marker broke seven roadmap-migration tests: the planner computes expected_projection_sha256 and the applier recomputes it, so both sides plus the archive comparison must agree on projection bytes. Threading a consistent label through migration digests risks receipt binding and rollback integrity, so it needs its own ticket. | Divergence protection shipped and is the substantive fix: findRoadmapProjectionDivergence blocks any write that would drop phases or sprints present only on disk, naming them, with --force to discard deliberately. Reproduced on this repo first: an injected phase vanished on slope validate with exit 0. |
| S247-2 | Long Iron | Missed Short | Bunker: Not delivered. Removing regeneration from validate would also remove the closeout source reconciliation this repo own workflow depends on. Instead the validate write was made safe and its exit code corrected. The surprise that a validate command mutates tracked files remains. | RoadmapSourceError.projectionContentLoss stops callers downgrading the refusal to a warning; validate reports once and exits 1 instead of printing a per-sprint note and exiting 0. |
| S247-3 | Short Iron | Green | -- | Focused evidence now names the canonical manifest, the owning bundle with its kind, and the projection as generated and read-only. An explicit --path still reports what was read; invalid federation falls back. |
| S247-4 | Driver | Missed Short | Rough: Canonical string sprint IDs (458.10 distinct from 458.1) not delivered: it is a representational change across roadmap compile, focus, archive, sprint state, scorecards and retro paths. Only the display mis-rendering was fixed. | Found during S246 pre-round, not from the issue: isEncodedInsertedSprintId treats any integer 200-999 ending in 5 as a legacy encoded half-sprint, so this repo own S245 rendered as S24.5. S243 built the evidence-based resolver and used it for ordering but never switched the display paths over. |
| S247-5 | Short Iron | Green | -- | No production change needed. Verified all three reported subjects already yield no refs on main via hasImplementationCommitType and isSprintRangeEndpoint; the range case was already pinned verbatim. Added the one uncovered case, the forward reference plan S134. |

### Miss Pattern

| Direction | Count |
|---|---|
| Short (under-scoped) | 3 |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S247-1 | The in-file _generated marker was implemented, then reverted. Making store.projection carry the marker broke seven roadmap-migration tests: the planner computes expected_projection_sha256 and the applier recomputes it, so both sides plus the archive comparison must agree on projection bytes. Threading a consistent label through migration digests risks receipt binding and rollback integrity, so it needs its own ticket. |
| Bunker | S247-2 | Not delivered. Removing regeneration from validate would also remove the closeout source reconciliation this repo own workflow depends on. Instead the validate write was made safe and its exit code corrected. The surprise that a validate command mutates tracked files remains. |
| Rough | S247-4 | Canonical string sprint IDs (458.10 distinct from 458.1) not delivered: it is a representational change across roadmap compile, focus, archive, sprint state, scorecards and retro paths. Only the display mis-rendering was fixed. |

**Known hazards for future sprints:**
- src/cli/roadmap-source-store.ts and src/core/roadmap-migration.ts both serialize the projection for digest comparison; planner and applier must agree byte for byte.

### Course Management Notes

- Three of five tickets landed partially, each with a documented reason rather than an overrun. The reported harm in every case is fixed; the deferred parts are representational or digest-sensitive work that deserves its own sprint.
- Reverting the marker after seeing seven migration failures was the right call over threading digests thin on remaining context.

