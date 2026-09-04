# S267.6 Independent Review Findings

Four passes, each run by an agent at opus tier with clean context, given the branch diff as untrusted data and told to verify claims against the repository rather than believe comments or commit messages.

| Pass | Scope | Blockers | Should-fix | Nits |
|---|---|---|---|---|
| Code review | Correctness, concurrency, regressions, test discrimination | 1 | 8 | 7 |
| Architect review | Ticket coverage, layering, scope, data model, migration | 2 | 7 | 6 |
| Code re-review | Verify each prior finding closed; find new | 0 | 3 | 8 |
| Architect re-review | Verify each prior finding closed; find new | 0 | 3 | 8 |

Every finding was applied. Counts overlap between passes: the same defect found by both reviewers is listed once below.

## Blockers

**Three surfaces still disagreed with a live claim.** The first cut converged `slope now`, `slope agent status` and compact `slope roadmap status` on completions and left them with three different claim policies. `now` skipped every claimed ticket, `agent status` preferred a claimed one and matched claims from any player, and roadmap status ignored claims entirely. With one claim open, `now` said start S1-2 while roadmap status said work S1-1. In a two-agent sprint, `agent status` pointed both agents at the same ticket.

Found by the architect pass, which reproduced it on a two-ticket sprint. The test written for that ticket compared `agent status` and `now` only after `ticket done` had released the claim, which is the single state where the two policies coincide.

Closed by `selectNextTicket` in `src/core/ticket-completion.ts`, one rule all three call.

**The repair path stopped working once sprint state advanced.** `ticket show` and `ticket repair` resolved the current sprint through sprint state rather than the ticket's own sprint. After a rollover, `show` reported a real completion as absent and `repair` refused it, advising `ticket done`, which needs a claim and would have filed the record under the wrong sprint.

Found by both passes independently. Evidence is audited after a sprint moves on, so the ticket's own scenario was the failing one.

Closed by reading through `getEventsByTicket`, which is indexed in both backends, and writing the correction to the sprint the completion was recorded against.

## Findings That Changed The Shipped Behaviour

- `--commit` outside a git work tree stored the value verbatim, so `#698` stayed fully reproducible there, printed one line above a warning saying no SHA had been attached.
- The ledger read swallowed failures into an empty map, the same failure mode the sprint had just removed from the write side. Then, after the first fix, `agent status` still swallowed a store-open failure, because `store.list` runs before the ledger read.
- `now --json` reported `tickets.completed: 0` as fact while `ledgerError` was set. The text renderer already said "unknown".
- `now --json` omitted `nextTicket` entirely when the sprint was exhausted, while `agent status` used null.
- `roadmap status`, `now`, `agent status` and the new `ticket show` all opened a store to answer a read-only question, creating `.slope/slope.db` and running a full schema migration in repos that never had one.
- The post-push guard inferred "all tickets done" from zero claims, which is the `#697` mistake in a guard the sprint had not opened. Its option list then still offered the closeout workflow when tickets remained, and it counted every ledger key rather than this sprint's roadmap tickets, so it could print "3/2 tickets recorded done".
- `repair` reattributed the completion to whoever ran it. `--notes=` could not clear notes. `repaired_by` was written and read by nothing.
- `ticket show --json` emitted `completed` only when the ticket was not done, so a consumer reading that field saw both cases as unfinished.
- `supersedes` let a record with no timestamp beat one that had it. Unreachable, since both backends declare the column NOT NULL.
- Two `process.exit(1)` paths skipped `store.close()`.
- The reader sat in `src/cli`, so MCP `execute` could not reach it. Moved to `src/core` and exported.
- Both new subcommands were missing from the CLI registry, and `ticket` is agent-audience, so an agent could not discover the repair path.

## Regression Caught By Re-Review

Printing the `Start:` command hint for in-flight work meant dropping the gate that suppressed it, and that gate was load-bearing. A pending review decision or a recorded waiver outranks the ticket, so the hint told the reader to do the wrong thing next. Caught by an existing `slope now` test.

## Limitation Stated Rather Than Solved

`selectNextTicket` decides "your own claim" by player name. Claims carry a `session_id` column that `slope claim` never populates, so name is the only discriminator available. Two agents on one machine with no explicit identity collide.

All three read surfaces accept `--actor` now, matching `claim` and `ticket done`, and `SLOPE_ACTOR` works. This is written into `docs/upgrading.md` and tracked as [#715](https://github.com/srbryers/slope/issues/715) rather than implied away.

## Test Discrimination

Both re-reviews verified that the new tests fail against a wrong implementation, by reverting each fix in turn and re-running. None is vacuous. The same check was run before the reviews: five tests fail when their specific fix is reverted, and only those.

## Deferred, With Issues Filed

- [#712](https://github.com/srbryers/slope/issues/712) five worktree and session tests fail on Windows on a clean main
- [#713](https://github.com/srbryers/slope/issues/713) ticket completion has no reopen path
- [#714](https://github.com/srbryers/slope/issues/714) `slope standup` renders every completion as "Decision made"
- [#715](https://github.com/srbryers/slope/issues/715) claims never record `session_id`
