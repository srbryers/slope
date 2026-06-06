# Open Issue Triage - 2026-06-06

## Scope

Reviewed open GitHub issues in `srbryers/slope` on 2026-06-06. All currently open issues are either already addressed by PR #508 or mapped into upcoming roadmap sprints.

## Triage Table

| Issue | Disposition | Sprint | Rationale |
|---|---|---|---|
| #509 - Windows full test suite fails on path separator and executable-bit assumptions | Addressed, pending PR merge | S137.5 complete | PR #508 now includes `Closes #509`; Windows full suite passes locally after S137.5. |
| #501 - `slope sprint reset --help` executes destructive reset | Next up | S138 | Highest trust/safety issue and smallest blast radius; fix before deeper guard recovery. |
| #499 - worktree-check should advise entering an existing worktree | Upcoming | S139 | Worktree guidance and guard recovery allowlists are foundational for later session-collision fixes. |
| #502 - session-collision guard blocks remote-only commands and stale sessions | Upcoming | S140 | Builds on S139 recovery guidance; focuses collision liveness, remote-only command scope, and stale-session clear paths. |
| #503 - SLOPE state drifts from git/PR reality | Upcoming | S141 | Larger workflow-state resync work; depends on safer session-collision behavior from S140. |
| #505 - codebase-map staleness guard deadlocks non-TypeScript repos | Upcoming | S142 | Guard-specific safety issue that can run after S140 and in parallel with deeper workflow resync work. |
| #507 - in-flight sprint state is not portable across machines | Upcoming | S143 | Depends on S141 state-resync primitives; adds cross-machine sprint resume without syncing local DBs or locks. |

## Sprint Order

1. S138 - Destructive Help Safety (#501)
2. S139 - Existing Worktree Entry Guidance (#499)
3. S140 - Session Collision Guard Recovery (#502)
4. S141 - Workflow State Resync (#503)
5. S142 - Codebase Map Guard Non-TS Safety (#505)
6. S143 - Portable Sprint Resume (#507)
7. S144 - Guard Recovery and State Portability Release

## Dependency Notes

- S142 only depends on S140, so it can proceed once the guard-recovery foundation is in place even if S141 is still in progress.
- S143 should wait for S141 because sprint resume needs the same branch/git/roadmap reconciliation ideas.
- S144 should wait for both S142 and S143, then publish the combined recovery train.

## Open/Close Notes

- #509 should remain open until PR #508 merges; the PR body has the auto-close reference.
- No additional open issues were found during this pass.
