## Sprint 122 Review: Hook CWD Guard Correctness

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 1 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (2/2) |
| GIR % | 100% (2/2) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 2)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S122-1 | Short Iron | In the Hole | - | Moved guardCommand config/plugin loading, baseline recording, suppression, metrics, and handler execution to use the normalized hook input cwd, falling back to process.cwd() only when stdin has no usable cwd. |
| S122-2 | Wedge | In the Hole | - | Added branch-before-commit and dispatcher tests proving the guard checks branch/config/metrics in the hook payload cwd instead of the launcher cwd. |

### Hazards Discovered

No new hazards were hit during S122.

**Known hazards for future sprints:**
- Guard command dispatch must read HookInput before loading repo-local guard config in worktree-aware harnesses.
- Guard handlers that receive cwd should use loadConfig(cwd) when reading guidance settings.
- Regression tests for hook cwd bugs should verify both emitted guard output and metrics location.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Hook dispatchers should resolve the runtime workspace from hook payloads before loading repo-local configuration. | S122 normalizes HookInput up front, then uses that cwd for config, plugins, metrics, suppression, and guard handlers. |
| Lessons | Guard handlers that receive cwd should pass it through to config loading instead of relying on process.cwd(). | Branch, nudge, compaction, transcript, and subagent guards now load configuration from the effective guard cwd. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused guard tests, typecheck, build, full pnpm test, scorecard validation, roadmap validation, map check, and whitespace checks passed. |
| workflow | healthy | The fix is tied to GitHub issue #447 and includes a Codex worktree regression test. |

### Course Management Notes

- Planned Phase 37 and Sprint 122 for GitHub issue #447.
- Changed src/cli/commands/guard.ts so guard execution reads stdin before loading config and uses HookInput.cwd when present.
- Changed guard handlers with internal loadConfig() calls to pass the effective cwd.
- Added unit coverage for branch-before-commit checking branch state and config from the effective cwd.
- Added dispatcher coverage proving branch-before-commit allows a feature-branch hook cwd even when the launcher cwd is on main.
- pnpm vitest run tests/cli/guards/branch-before-commit.test.ts tests/cli/commands/guard.test.ts passed: 30 tests.
- pnpm typecheck passed.
- pnpm build passed.
- pnpm test passed: 214 passed test files, 1 skipped test file, 3481 passed tests, and 23 skipped tests.
- node dist/cli/index.js validate --skills passed before closeout.
- node dist/cli/index.js roadmap validate passed before closeout with standing warnings only plus the expected branch-local S122 warning.
- node dist/cli/index.js map --check passed: Overall CURRENT.
- git diff --check passed.
- slope review recommend suggested architect review and optional code review; self-review found no blocking issues.

### 19th Hole

- **How did it feel?** Small but satisfying: the bug lived in one early cwd choice, and the fix made the whole guard path more honest.
- **Advice for next player?** When a hook payload includes cwd, normalize it before any repo-local config or plugin work begins.
- **What surprised you?** Several guard handlers already accepted cwd but still loaded config from process.cwd(), so the central fix needed a small follow-through pass.
- **Excited about next?** Codex worktree commits should no longer get blocked by the branch state of the launcher checkout.
