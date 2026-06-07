## Sprint 143.99 Review: CodeQL Release Gate Hardening

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 1 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (3/3) |
| GIR % | 100% (3/3) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 3)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S143.99-1 | Wedge | Green | — | Replaced first-only scorecard pattern substitution with all-wildcard replacement in workflow resync and the sibling sprint-completion guard; added regressions for multi-wildcard scorecard patterns. |
| S143.99-2 | Short Iron | Green | — | Changed flow staleness and MCP testing worktree cleanup to use `execFileSync` argument arrays for git diff, worktree removal, branch deletion, and worktree pruning. |
| S143.99-3 | Wedge | In the Hole | — | Focused tests, build, typecheck, full suite, map, roadmap, and PR #508 checks passed after the fix; CodeQL aggregate now reports success at head eb4815174038ce14b0d4a569d38ef010f3799079. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The normal CI job passed before the aggregate GitHub Advanced Security CodeQL check failed, so release validation had to inspect both Actions jobs and external check-run annotations. |

### Hazards Discovered

**Known hazards for future sprints:**
- Aggregate security checks can fail independently of GitHub Actions job conclusions.
- First-only wildcard replacement in scorecard patterns is a portability bug when custom patterns contain more than one wildcard.
- Git commands that take branch names, refs, or paths should use `execFileSync` argument arrays instead of shell strings.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Release-gate status should include aggregate security checks, not only workflow job conclusions. | S143.99 inspected the CodeQL check-run annotations, fixed each changed-code alert, and waited for the PR checks to turn green. |
| Lessons | Git commands that consume runtime paths or refs should use argument arrays. | The changed code now avoids shell interpolation for the CodeQL-flagged git paths. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `corepack pnpm vitest run tests/cli/sprint-workflow.test.ts tests/cli/guards/sprint-completion.test.ts tests/core/flows.test.ts tests/mcp/index-src.test.ts` passed: 157 tests. |
| testing | healthy | `corepack pnpm build` passed. |
| testing | healthy | `corepack pnpm typecheck` passed. |
| testing | healthy | `corepack pnpm test` passed: 232 test files passed, 1 skipped; 3632 tests passed, 25 skipped. |
| release | healthy | PR #508 checks passed at eb4815174038ce14b0d4a569d38ef010f3799079: ci, CodeQL, Analyze (actions), Analyze (javascript-typescript), and GitGuardian. |
| docs | healthy | `node dist/cli/index.js map --check` and `node dist/cli/index.js roadmap validate` passed with only standing historical roadmap warnings. |

### Course Management Notes

- Issue #518 was raised from PR #508 CodeQL check-run 79963836673.
- Triage commit: a8eb3e4.
- Implementation commit: eb48151.
- Focused regression tests passed: 157 tests.
- corepack pnpm build passed.
- corepack pnpm typecheck passed.
- corepack pnpm test passed: 232 test files passed, 1 skipped; 3632 tests passed, 25 skipped.
- node dist/cli/index.js map --check reported current.
- node dist/cli/index.js roadmap validate passed with standing historical warnings only.
- PR #508 checks passed at eb4815174038ce14b0d4a569d38ef010f3799079: ci, CodeQL, Analyze (actions), Analyze (javascript-typescript), and GitGuardian.
- Issue #518 should close when PR #508 merges.

### 19th Hole

- **How did it feel?** A sharp little release-gate catch: the code was working, but CodeQL was right to demand safer command construction.
- **Advice for next player?** When a PR check line is an aggregate security check, fetch its annotations directly before assuming the underlying Actions jobs tell the whole story.
- **What surprised you?** The aggregate CodeQL check failed even though both named CodeQL workflow jobs were otherwise healthy.
- **Excited about next?** S144 can now use checks-passing release readiness without carrying a hidden CodeQL failure.

