## Sprint 124 Review: Pre-Sprint Reality Checks

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (3/3) |
| GIR % | 100% (3/3) |
| Putts | 0 |
| Penalties | 0 |
| Hazard Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 3)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S124-1 | Short Iron | In the Hole | - | Routed existing roadmap drift validation into briefing, roadmap show, and sprint start. Sprint start now blocks already-scorecarded or shipped sprint selections unless forced. |
| S124-2 | Long Iron | Green | rough: stale feat/workflow-engine sibling worktree overlaps src/cli | Added sibling worktree reality collection, touched-path overlap checks, migration detection, worktree status/list, and best-effort sprint auto-claiming. |
| S124-3 | Wedge | Green | rough: regression caught porcelain trimming bug | Added CLI regressions for roadmap show, briefing, sprint start, and worktree status. The parser now preserves Git porcelain leading columns. |

### Hazards Discovered

The new worktree surface immediately found an existing `feat/workflow-engine` sibling worktree with overlapping `src/cli` files. That was useful confirmation of #452 rather than a blocker for this branch, but it should be cleaned up separately if the branch is stale.

The first worktree regression also caught a real parser bug: trimming the whole Git status output removed the leading porcelain status column, which corrupted paths. The fix trims trailing whitespace only and then slices the fixed-width status fields.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Git porcelain status output must preserve leading columns until after status parsing. | The shared git helper now uses trailing trim only, and the status parser keeps fixed-width columns intact. |
| Lessons | Pre-sprint checks are most useful when wired into passive and active surfaces. | Roadmap drift appears in briefing/show, while sprint start blocks already-complete/scorecarded sprint selections. |
| Lessons | Sibling worktree conflict reporting should be actionable without being noisy. | Ignored state/build paths are filtered, long lists are summarized, and hard blocking requires explicit `--touches` overlap. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Typecheck, focused Vitest coverage, build, full Vitest suite, roadmap validation, and whitespace checks passed. |
| workflow | healthy | `slope worktree status` exposes the sibling-worktree hazard class requested in #452. |
| concurrency | watch | The stale `feat/workflow-engine` sibling worktree still exists with overlapping `src/cli` changes. |

### Course Management Notes

- Created `src/cli/pre-sprint-reality.ts` for shared roadmap and sibling-worktree reality checks.
- Updated briefing, roadmap show, sprint start, worktree status/list, CLI help, and command registry discovery.
- Added regression tests for roadmap show drift output, briefing drift output, sprint start blocking an already-scorecarded sprint, and worktree status overlap/migration output.
- `pnpm typecheck` passed.
- Focused Vitest run passed: 4 files, 55 tests.
- `pnpm build` passed.
- `pnpm test` passed: 215 passed test files, 1 skipped test file, 3485 passed tests, and 23 skipped tests.
- `node dist/cli/index.js roadmap validate` passed with standing warnings plus the expected branch-local S124 complete-but-not-yet-shipped warning.
- `node dist/cli/index.js worktree status --touches=src/cli,docs/backlog` surfaced the `feat/workflow-engine` overlap.
- `node dist/cli/index.js map` refreshed ignored `CODEBASE.md` locally.
- `git diff --check` passed before the feature commit.

### 19th Hole

- **How did it feel?** Useful in exactly the way this sprint wanted: the tooling now tells the player about stale reality before they step onto the wrong tee.
- **Advice for next player?** Use `--touches` on sprint start when you know the planned files; that is the difference between a heads-up and a hard overlap block.
- **What surprised you?** The regression test found a real porcelain parsing bug immediately, which made the new worktree surface sharper before it shipped.
- **Excited about next?** The next sprint can trust briefing and sprint start to catch more of the drift that previously only appeared after a PR or release.
