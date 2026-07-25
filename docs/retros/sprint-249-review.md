
## Sprint 249 Review: Toolchain Pin and Guard Signal

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
| S249-1 | Putter | In the Hole | -- | packageManager pnpm@10.32.1 plus engines.pnpm >= 9. pnpm/action-setup reads the field, so CI and local converge instead of CI floating to latest. |
| S249-2 | Wedge | Green | -- | pull_request branches ['**']. Stacked PRs #639 and #640 ran no CI at all while #638 ran the full suite — the PRs where a regression is easiest to miss. |
| S249-3 | Short Iron | Green | Rough: Two existing tests asserted the old contract, one named "emits ask output ... on adhoc ... writes" — precisely what #643 reports as wrong. Updated to the intended behaviour rather than worked around, which is the right call but worth noting: a test name can encode a bug as a requirement. | Advisory context in adhoc instead of ask/deny, deduped once per session. Sprint sessions still gate with ask. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S249-3 | Two existing tests asserted the old contract, one named "emits ask output ... on adhoc ... writes" — precisely what #643 reports as wrong. Updated to the intended behaviour rather than worked around, which is the right call but worth noting: a test name can encode a bug as a requirement. |

### Course Management Notes

- A test name can encode a defect as a requirement. When a fix breaks a test whose name states the wrong behaviour, the test is the thing to change.

