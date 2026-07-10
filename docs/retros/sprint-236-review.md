## Sprint 236 Review: Transactional Roadmap Migration Apply

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
| S236-1 | Driver | Green | — | Apply replans under the federation lock, writes an exact backup and integrity-bound journal, commits the manifest last, and automatically restores exact original bytes after failures or crashes. |
| S236-2 | Long Iron | Green | — | Strict YAML bundles, manifest, compatibility projection, non-core export, audit, and receipt are rendered and validated in memory before any transaction write. |
| S236-3 | Long Iron | Missed Right | Rough: The first receipt bound every discovered scorecard, including unrelated history, and initial discovery inherited minSprint filtering. | Historical discovery now ignores minSprint, explicit mappings validate exact evidence, and durable receipt binding includes only scorecards referenced by generated sources. |
| S236-4 | Short Iron | Missed Right | Bunker: Raw durable text hashes broke idempotency after a clean Windows CRLF recheckout even though Git-visible content was unchanged. | Durable text hashes now normalize CRLF only, while transaction safety hashes stay raw; regression coverage spans CRLF recheckout, 456-sprint planning, TOCTOU, recovery, idempotency, and hand-authored refusal. |

### Miss Pattern

| Direction | Count |
|---|---|
| Right (spec drift) | 2 |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | major | A multi-file migration needs distinct contracts for durable checkout-stable evidence and exact in-flight rollback bytes. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S236-3 | The first receipt bound every discovered scorecard, including unrelated history, and initial discovery inherited minSprint filtering. |
| Bunker | S236-4 | Raw durable text hashes broke idempotency after a clean Windows CRLF recheckout even though Git-visible content was unchanged. |

**Known hazards for future sprints:**
- Do not bind migration idempotency to unrelated repository evidence.
- Use checkout-normalized hashes only for durable generated text; keep recovery and concurrency checks byte-exact.
- Commit the manifest last because it switches roadmap authority.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Bind receipts only to evidence that contributes to the generated authority switch. | Unrelated scorecard changes no longer invalidate a completed migration. |
| Lessons | Durable generated-text integrity and transaction rollback integrity require different byte contracts. | Receipts use declared CRLF-normalized text hashes; journals, backups, and TOCTOU checks remain raw-byte exact. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | The complete repository suite passed after final migration hardening; independent focused validation passed 106 tests. |
| build | healthy | Production build and TypeScript typecheck passed. |
| review | healthy | Independent review found two final trust gaps; both were repaired and the final re-review approved. |

### Course Management Notes

- All implementation, review repair, and validation commits are pushed; no PR merge or release is implied.
- Failed or interrupted applies recover automatically from the durable private journal and backup; no user-facing rollback command is included.

### 19th Hole

- **How did it feel?** The transaction mechanics were manageable; separating exact recovery bytes from checkout-stable durable evidence was the subtle part.
- **Advice for next player?** Define which inputs actually authorize the output, then bind only those inputs with the byte contract appropriate to their lifecycle.
- **What surprised you?** A successful migration could look hand-authored after nothing more than Git checking its text files out as CRLF.
- **Excited about next?** Large single-file projects can now get an actionable dry run and a fail-closed modular migration without a project-specific transform.

