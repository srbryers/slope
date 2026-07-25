
## Sprint 251 Review: Projection Marker and Read-Only Validate

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 5 |
| Score | 5 |
| Label | Bogey |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 1 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S251-1 | Driver | Green | Bunker: S247 attempted this by stamping the marker into store.projection and reverted after seven migration receipt tests failed. The fix was scoping, not cleverness: keep canonical bytes marker-free and confine the marker to write/read. Worth recording that the earlier revert was correct — retrying the same approach would have failed again. | withRoadmapProjectionMarker on write, stripRoadmapProjectionMarker on compare. All four projection-byte comparison sites still agree. |
| S251-2 | Driver | Green | Rough: A marker-insensitive unchanged check would have meant the marker never got added to an already-current projection. The write decision compares exact bytes; the drift check stays marker-insensitive. Two comparisons with deliberately different sensitivity. | The seven migration receipt tests pass unchanged. Verified idempotent: second compile reports unchanged, --check reports no drift. |
| S251-3 | Long Iron | Green | -- | slope validate --read-only performs no writes. Default deliberately unchanged: reconciliation marks the scorecard gate, registers scorecard indexes and regenerates the projection, and this repo's closeout depends on it. The surprise is escapable rather than removed. |
| S251-4 | Wedge | Green | -- | The warning named a symptom while a phase of planning work was being discarded. It now states that the projection is generated and projection-only sprints are dropped on the next compile. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S251-1 | S247 attempted this by stamping the marker into store.projection and reverted after seven migration receipt tests failed. The fix was scoping, not cleverness: keep canonical bytes marker-free and confine the marker to write/read. Worth recording that the earlier revert was correct — retrying the same approach would have failed again. |
| Rough | S251-2 | A marker-insensitive unchanged check would have meant the marker never got added to an already-current projection. The write decision compares exact bytes; the drift check stays marker-insensitive. Two comparisons with deliberately different sensitivity. |

**Known hazards for future sprints:**
- Projection bytes are compared in four places with different sensitivity requirements; changing the serialized shape touches all of them.

### Course Management Notes

- S247's revert was the right call, and re-attempting it identically would have failed identically. What changed was confining the marker to the write boundary rather than the canonical representation.

