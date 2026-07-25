
## Sprint 248 Review: CLI Argument and Reference Correctness

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 5 |
| Label | Bogey |
| Fairway % | 100% (3/3) |
| GIR % | 100% (3/3) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 1 |

### Shot-by-Shot (Tickets Delivered: 3)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S248-1 | Short Iron | Green | -- | No production change needed. Verified on main: slope review --help prints usage and --sprint=241 renders Sprint 241, not the highest-numbered scorecard. Filed against v1.58.4 and fixed since. |
| S248-2 | Wedge | Green | Rough: Two rounds of heredoc escaping mangled newline escapes into real newlines inside test string literals, producing unterminated-string parse failures. Switched to escape-free construction and to writing scripts as files rather than heredocs. | Distinct-key pass added after the header and table checks, so well-formed plans are untouched. Counted as a set so dependency back-references cannot inflate the total; sprint ranges like S64-S80 still count 0. |
| S248-3 | Long Iron | Green | Rough: [self review] Fix-intent classification treated merge and revert subjects as fix intent: "Merge pull request #613 from ..." contributed the PR number as a closable issue, and a revert contributed the issue it un-fixed. Both would have produced wrong Closes lines. Fixed by skipping merge/revert subjects; pinned by two tests. | git log now uses a record separator so intent is judged per commit: feat, fix, perf, refactor and untyped squash subjects contribute refs, while docs, chore, test and style do not. The PR body is no longer swept, since a bare issue reference there is not a fix declaration; explicit Closes lines are still honoured via existingAutoCloseRefs. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S248-2 | Two rounds of heredoc escaping mangled newline escapes into real newlines inside test string literals, producing unterminated-string parse failures. Switched to escape-free construction and to writing scripts as files rather than heredocs. |
| Rough | S248-3 | [self review] Fix-intent classification treated merge and revert subjects as fix intent: "Merge pull request #613 from ..." contributed the PR number as a closable issue, and a revert contributed the issue it un-fixed. Both would have produced wrong Closes lines. Fixed by skipping merge/revert subjects; pinned by two tests. |

**Known hazards for future sprints:**
- src/cli/commands/pr.ts extractFixIntentIssueRefs: merge and revert subjects must be excluded before conventional-commit typing is considered.

### Course Management Notes

- Two of three issues in this sprint were already fixed on main. Verifying first and adding the missing regression case is cheaper than re-fixing, and prevents an S245-style wasted sprint.

