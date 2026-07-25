
## Sprint 250 Review: Sprint Lifecycle and Claim Safety

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
| S250-1 | Long Iron | Green | -- | A terminal sprint with completion evidence is finished work being recorded, not restarted. completionEvidence was already a parameter of assessSprintRollover, so no new plumbing. |
| S250-2 | Short Iron | Green | Bunker: target_not_pending ignored force entirely while its sibling from_not_terminal honoured it, so the documented --force --reason escape hatch silently did nothing for this refusal. Two checks in the same function disagreeing about whether force applies is the kind of gap only dogfooding finds. | Refusal message now names the escape hatch instead of leaving the operator to guess. |
| S250-3 | Wedge | Green | -- | sprint-completion returned on the first missing artifact, costing a round trip per refusal. Lineage and scorecard are now collected together, and the lineage message says the audit must be on the branch being PR'd. |
| S250-4 | Short Iron | In the Hole | Water: `slope claim release --target=X` registered a claim rather than releasing one — a guessable command doing the exact opposite of what was asked, with no list command to notice and no CLI path to undo it. Four spurious claims were created this way during Phase 55 closeout and had to be deleted from the SQLite store by hand. | Unknown positionals now error with usage. Discarding unrecognised input while still mutating state is the anti-pattern. |
| S250-5 | Long Iron | Green | Rough: --all did nothing on first implementation: parseArgs only captures --key=value, so the bare flag was never seen. Caught by self review, not by types. | release delegates to the existing releaseCommand, which already handled --id and --target and was simply undiscoverable. list defaults to the current sprint to match what slope now counts. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S250-2 | target_not_pending ignored force entirely while its sibling from_not_terminal honoured it, so the documented --force --reason escape hatch silently did nothing for this refusal. Two checks in the same function disagreeing about whether force applies is the kind of gap only dogfooding finds. |
| Water | S250-4 | `slope claim release --target=X` registered a claim rather than releasing one — a guessable command doing the exact opposite of what was asked, with no list command to notice and no CLI path to undo it. Four spurious claims were created this way during Phase 55 closeout and had to be deleted from the SQLite store by hand. |
| Rough | S250-5 | --all did nothing on first implementation: parseArgs only captures --key=value, so the bare flag was never seen. Caught by self review, not by types. |

**Known hazards for future sprints:**
- src/cli/sprint-rollover.ts assessSprintRollover: each eligibility check decides independently whether --force applies; they must agree.

### Course Management Notes

- Every defect in this sprint came from running the tool on itself. None would have surfaced from reading the code.
- A command that discards unrecognised input and mutates anyway is worse than one that errors; it produces state the operator cannot see or undo.

