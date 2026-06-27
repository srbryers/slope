## Sprint 218 Review: Store and Project Bootstrap Portability

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S218-1 | Short Iron | In the Hole | — | SQLite store setup now verifies WAL with a real write and falls back to TRUNCATE when WAL is unsupported, while SLOPE_JOURNAL_MODE can explicitly select supported journal modes. |
| S218-2 | Wedge | In the Hole | — | SQLite open/setup failures now surface a SlopeStoreError with the resolved store path, original I/O detail, and WSL2/network filesystem recovery guidance. |
| S218-3 | Short Iron | In the Hole | — | init, interview, and start now require a git work tree unless --allow-no-git/--no-git is explicit, and ticket completion no longer emits raw git fatal output outside repositories. |
| S218-4 | Wedge | In the Hole | — | The unmaterialized custom metaphor sentinel is no longer offered as an interview option, is rejected if submitted manually, and is defensively skipped by answer transformation. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The sprint crossed store portability, bootstrap preflight behavior, and interview metaphor validation, so verification needed both focused regressions and full CLI/core sweeps. |

### Hazards Discovered

**Known hazards for future sprints:**
- SQLite WAL can appear accepted by PRAGMA while still failing on the first write on DrvFs, 9p, or network filesystems.
- No-git projects need an explicit degraded mode because roadmap and ticket completion rely on commit-backed evidence.
- Metaphor selector sentinels should never share the same storage path as registered metaphor ids.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | SQLite journal setup needs an operational probe, not only a PRAGMA round trip. | The store writes and deletes a probe row after selecting WAL, then falls back to TRUNCATE when the write fails. |
| Lessons | Bootstrap commands that depend on commit evidence need an explicit git preflight. | init, interview, and start now fail with SLOPE-owned recovery text unless degraded no-git mode is explicitly requested. |
| Lessons | Selector sentinel values must be materialized before config persistence or rejected before writes. | The custom metaphor placeholder is rejected centrally and cannot reach .slope/config.json as a saved metaphor id. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | `./node_modules/.bin/vitest.cmd run tests/store tests/cli/store.test.ts` passed: 4 files passed, 1 skipped, 88 passed tests and 25 skipped PG tests. |
| Diet | healthy | `./node_modules/.bin/vitest.cmd run tests/cli` passed: 126 files, 1455 tests. |
| Recovery | healthy | `./node_modules/.bin/vitest.cmd run tests/core` passed: 95 files, 1954 tests. |
| Supplements | healthy | `./node_modules/.bin/tsc.cmd --noEmit` and `./node_modules/.bin/tsc.cmd` passed. `pnpm run build` remains blocked in this environment by pnpm ignored-build approval, so the local compiler binary was used for verification. |
| Stretching | healthy | `node dist/cli/index.js review recommend` required architect review and suggested optional code review; scoped code and architecture review found no findings. |

### Course Management Notes

- GitHub issues #553, #558, and #557 are addressed by commits 2d5acb4, 5131f01, 281055a, and bbd3f54.
- The sprint intentionally leaves unrelated dirty hook and slope-loop files untouched.
- Roadmap validation will still warn that S216-S218 are not on main until this branch is merged.

### 19th Hole

- **How did it feel?** The sprint was straightforward once each issue was treated as a portability contract rather than a one-off failure.
- **Advice for next player?** When onboarding or bootstrap state can degrade, make the degraded mode explicit and keep the happy path tied to durable evidence.
- **What surprised you?** The custom metaphor sentinel had multiple permissive paths: step options, answer validation, input validation, and answer transformation all needed the same rule.
- **Excited about next?** S219 can build on cleaner bootstrap assumptions while review provenance work gets its own focused sprint.
