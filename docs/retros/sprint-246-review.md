
## Sprint 246 Review: Session and Worktree Isolation

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 5 |
| Score | 6 |
| Label | Bogey |
| Fairway % | 100% (5/5) |
| GIR % | 100% (5/5) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 1 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S246-1 | Driver | Green | Bunker: First implementation ran the worktree lookup eagerly after the git-common-dir check, adding two git subprocess calls to every guard invocation (a hot path on Edit/Write/Bash) and shifting the programmed execFileSync mock sequences of five existing tests. Restructured to check lazily on the would-deny path only, reusing the worktree list the guidance formatter already computes. | Trusts where work actually lands. An edit landing in the primary checkout still denies, so the #499 EnterWorktree guidance is preserved; pinned by a new both-directions integration test pair. |
| S246-2 | Driver | Green | -- | New src/cli/session-scope.ts resolves the primary checkout via --git-common-dir. Nine session CLI call sites plus worktree reconciliation share it, so the printed remediation can clear what the guard reads. The guard primary-checkout branch already had cwd equal to primary, so no redundant git call was added there. |
| S246-3 | Long Iron | Green | Rough: Changed the register call ide from the hardcoded claude-code to resolveIde(input) as a drive-by improvement, breaking an existing assertion. Reverted to keep the diff focused; the ide detection inconsistency between register and reconcile remains a separate concern. | Registration moved to the pass path and skipped when a record already exists. Verified registerSession does not auto-assign swarm_id, so reordering cannot break swarm-member exclusion. |
| S246-4 | Wedge | In the Hole | Bunker: The stated cause in the issue (guard classifies any .ts write as implementation regardless of path) was wrong: findImplementationWritePath already scoped to the repo. Instrumenting the real functions showed the defect was upstream in resolveEffectiveHookCwd, which derives cwd from the tool target path; canonicalHookCwd fell back to the raw path, so an out-of-repo write made the scratchpad the workspace root. Fixing it there fixes every guard at once and needs no temp-dir denylist. | Also guarded the Codex workdir memo on both write and read: one out-of-repo call previously pinned the whole session, and caches from older versions kept doing so after the fix. |
| S246-5 | Short Iron | Green | Rough: Adding a session-scope import to sprint-state.ts broke the atomic-write concurrency test, which compiles a hand-listed subset of CLI modules into a temp dir for child processes. New transitive dependencies must be added to that list. | updateSprintPhaseForSprintAcrossWorktrees applies the conditional update to every checkout; worktrees holding a different sprint are reported unmatched and untouched. The caller also discarded matched/changed and printed reconciled unconditionally, which is why a closeout that reconciled nothing still reported success. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| undefined | undefined | undefined |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S246-1 | First implementation ran the worktree lookup eagerly after the git-common-dir check, adding two git subprocess calls to every guard invocation (a hot path on Edit/Write/Bash) and shifting the programmed execFileSync mock sequences of five existing tests. Restructured to check lazily on the would-deny path only, reusing the worktree list the guidance formatter already computes. |
| Rough | S246-3 | Changed the register call ide from the hardcoded claude-code to resolveIde(input) as a drive-by improvement, breaking an existing assertion. Reverted to keep the diff focused; the ide detection inconsistency between register and reconcile remains a separate concern. |
| Bunker | S246-4 | The stated cause in the issue (guard classifies any .ts write as implementation regardless of path) was wrong: findImplementationWritePath already scoped to the repo. Instrumenting the real functions showed the defect was upstream in resolveEffectiveHookCwd, which derives cwd from the tool target path; canonicalHookCwd fell back to the raw path, so an out-of-repo write made the scratchpad the workspace root. Fixing it there fixes every guard at once and needs no temp-dir denylist. |
| Rough | S246-5 | Adding a session-scope import to sprint-state.ts broke the atomic-write concurrency test, which compiles a hand-listed subset of CLI modules into a temp dir for child processes. New transitive dependencies must be added to that list. |

### Course Management Notes

- Verify an issue reproduces against current main before fixing it. The #625 stated cause was wrong and two other issues in this batch were already fixed.
- claim-required returns ask even in adhoc mode, which the session briefing describes as sprint-workflow guards silenced. Demanding a claim in a mode that means not running sprint workflow is contradictory and trains agents to ignore the guard.

