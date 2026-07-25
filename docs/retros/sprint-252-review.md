
## Sprint 252 Review: Sprint Identity Safety

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 4 |
| Score | 5 |
| Label | Par |
| Fairway % | 100% (5/5) |
| GIR % | 100% (5/5) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S252-1 | Long Iron | Green | Bunker: The planned approach was impossible: YAML collapses 458.10 to the number 458.1 before any validator sees the document, so the ambiguity is unrecoverable from the parsed value. describeSprintIdAmbiguity had to take a string, and authored sources needed a raw-text scan rather than an object check. A first attempt that inspected the parsed id would have silently done nothing. | Trailing zero is the discriminator: .10 aliases .1 and .0 aliases the whole sprint, while .11 and .01 round-trip. The message names what the id collapses to and suggests a renumbering. |
| S252-2 | Short Iron | Green | -- | Raw-YAML scan in parseRoadmapSourceDocument reporting the offending line. Inspects only the two positions a sprint id is written (a phase.sprints list item and an id: key), so par, slope and version decimals are untouched. This repo's 48 sources compile unchanged. |
| S252-3 | Wedge | Green | -- | Covers both enforcement points plus the case that only text can detect: describeSprintIdAmbiguity(String(458.10)) is correctly null, because by then the zero is already gone. |
| S252-4 | Driver | In the Hole | Water: Found while transitioning into this phase. Rollover audits hashed raw bytes, so on Windows with core.autocrlf any checkout renormalized tracked text and permanently invalidated every audit — proven by the recorded digest matching the git blob (LF, 4446 bytes) while the working tree hashed CRLF at 4547. Because sprint-completion requires lineage verification before PR creation, this blocked the entire lifecycle, and was the fourth distinct block on the same closeout path after #641 twice and #646. | hashTrackedContent normalizes CRLF to LF, matching what git stores; trackedContentMatches also accepts legacy raw-byte digests so existing audits keep verifying. |
| S252-5 | Wedge | Green | Rough: The product-side fix was attempted and reverted. Keying claim-required's advisory flag off the policy rather than the session mode stopped both prompt triggers but broke deny mode, returning no decision where it must block. loadConfig resolved the policy correctly, so the fault is at the guard/CLI output boundary. The suite has no test asserting deny blocks, which is why the regression was invisible — recorded on #650 so a retry starts with that test. | The operator was asked to approve host permission prompts three times because claim-required returns ask whenever sprint state is absent or non-implementing, and every remedy it prints is agent-actionable. Agent-side stop landed in sprint-checklist.md; the guard fix stays open. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S252-1 | The planned approach was impossible: YAML collapses 458.10 to the number 458.1 before any validator sees the document, so the ambiguity is unrecoverable from the parsed value. describeSprintIdAmbiguity had to take a string, and authored sources needed a raw-text scan rather than an object check. A first attempt that inspected the parsed id would have silently done nothing. |
| Water | S252-4 | Found while transitioning into this phase. Rollover audits hashed raw bytes, so on Windows with core.autocrlf any checkout renormalized tracked text and permanently invalidated every audit — proven by the recorded digest matching the git blob (LF, 4446 bytes) while the working tree hashed CRLF at 4547. Because sprint-completion requires lineage verification before PR creation, this blocked the entire lifecycle, and was the fourth distinct block on the same closeout path after #641 twice and #646. |
| Rough | S252-5 | The product-side fix was attempted and reverted. Keying claim-required's advisory flag off the policy rather than the session mode stopped both prompt triggers but broke deny mode, returning no decision where it must block. loadConfig resolved the policy correctly, so the fault is at the guard/CLI output boundary. The suite has no test asserting deny blocks, which is why the regression was invisible — recorded on #650 so a retry starts with that test. |

**Known hazards for future sprints:**
- Sprint id ambiguity is only visible in source text; any check that inspects a parsed number is a no-op.
- Rollover audits hash file contents — normalize line endings or Windows checkouts invalidate them.

### Course Management Notes

- The plan assumed the ambiguity could be validated after parsing. It could not. Checking the constraint before writing the ticket would have saved a wrong first approach.
- #635 stays open deliberately: this removes the silent-corruption path, but canonical string ids remain the durable fix.

