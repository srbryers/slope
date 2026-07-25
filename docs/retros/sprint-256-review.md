
## Sprint 256 Review: Cleanups

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (3/3) |
| GIR % | 100% (3/3) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 3)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S256-1 | Putter | In the Hole | -- | .codex is slope-init generated output, the exact sibling of the already-ignored .slope. It had shown as untracked on every git status all session and was nearly committed during the Phase 56 merge. One line. |
| S256-2 | Short Iron | Green | -- | isWithinClaimedArea and claimOverlapsPath were two copies that both needed the identical #651 whole-repo fix. Extracted claim-area.ts; both delegate. Behaviour preserved (35 claim-required tests pass), with a small consistency gain (backslash target normalization). New module has its own 18-test suite. |
| S256-3 | Wedge | Green | Rough: The audit's premise (10 ask/deny guards to review) was wrong: only claim-required ever emitted ask, and #650 fixed it. That fix also left a dead decision: 'ask' branch, which the invariant test would have failed on until removed. Verifying the premise before writing code saved building a downgrade for guards that were correct deny gates. | Source-level test asserts no guard emits decision: 'ask'. The remaining deny guards return to the agent, not the operator, and are legitimate safety gates. Removed the now-unreachable ask branch from implementationWritePolicyResult, replacing it with an advisory fallback rather than deleting it. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S256-3 | The audit's premise (10 ask/deny guards to review) was wrong: only claim-required ever emitted ask, and #650 fixed it. That fix also left a dead decision: 'ask' branch, which the invariant test would have failed on until removed. Verifying the premise before writing code saved building a downgrade for guards that were correct deny gates. |

### Course Management Notes

- The 'audit the 10 guards' ask turned out to need no downgrade — verifying the premise (which guards actually emit ask vs deny) converted a speculative refactor into a one-line invariant test plus a dead-code removal.
- A guard firing on its own author (shell-write earlier; the advisory claim-required message this sprint) is the mechanism working — the signal reaches the agent, not the operator.

