## Sprint 145 Review: Validation Signal Repair

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
| S145-1 | Short Iron | In the Hole | — | Added a sprint-range endpoint guard around extractSprintReferences so S64-S80 and S85-S90 roadmap references no longer mark either endpoint shipped, while S78-1 style implementation tickets still count. |
| S145-2 | Short Iron | In the Hole | — | Extracted the map metadata file-count helper and reused it in runStalenessCheck, so non-SLOPE multi-root repos count src/, worker/, and other source roots the same way during generation and checking. |
| S145-3 | Wedge | In the Hole | — | Focused analyzer and map tests passed, build and typecheck passed, the full suite passed, and SLOPE roadmap/map/docs checks passed with only standing historical warnings. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| rough | minor | S145 had to distinguish implementation ticket references from roadmap range references without weakening legitimate shipped-commit detection. |
| Wind | minor | Map CLI tests execute the built dist command, so the focused regression needed a rebuild before the test run. |

### Hazards Discovered

**Known hazards for future sprints:**
- Sprint ID parsing should distinguish roadmap range references from shipped ticket references.
- Map staleness checks should reuse generator file-count helpers instead of independently choosing source roots.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Roadmap validation should treat sprint ranges as planning references, not evidence that a sprint shipped. | extractSprintReferences now skips S<n>-S<m> and S<n>-S<m> style range endpoints while preserving nonzero ticket refs. |
| Lessons | Map generation and staleness checks must share file discovery policy. | S145 extracted countMapMetadataFiles and uses it for both map metadata and map --check source drift. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `corepack pnpm vitest run tests/core/analyzers/git.test.ts` passed: 25 tests. |
| testing | healthy | `corepack pnpm vitest run tests/cli/commands/map.test.ts` passed: 12 tests. |
| testing | healthy | `corepack pnpm build` and `corepack pnpm typecheck` passed. |
| testing | healthy | `corepack pnpm test` passed: 232 test files passed, 1 skipped; 3634 tests passed, 25 skipped. |
| docs | healthy | `node dist/cli/index.js roadmap validate`, `node dist/cli/index.js map --check`, and `node dist/cli/index.js docs check` passed with only standing historical roadmap warnings. |

### Course Management Notes

- GitHub issues #519 and #520 were open after the v1.58.0 release closeout and were triaged into S145.
- Triage commit: f56d7a4.
- Shipped-commit parser fix commit: 894d61f.
- Map staleness parity fix commit: 12614a4.
- Review recommendation: architect required, code optional; no review findings were found in the scoped diff.
- The PR should include close references for #519 and #520 so the issues close on merge.

### 19th Hole

- **How did it feel?** Tidy and well-bounded: two real external-repo false positives, both fixed with small shared-logic changes.
- **Advice for next player?** When a validator compares current reality to generated metadata, make both sides call the same helper. When parsing sprint IDs, decide whether the surrounding token proves shipped work or just mentions planning context.
- **What surprised you?** The old recovery branch had a future S145 concept, but it was not present on main; this PR keeps the issue repair as the next mainline sprint.
- **Excited about next?** SLOPE validation signals should be less noisy for downstream repos with roadmap ranges and multi-root TypeScript layouts.

