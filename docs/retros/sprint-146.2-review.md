## Sprint 146.2 Review: Decimal Post-Merge Retro Support

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

### Shot-by-Shot (Tickets Delivered: 2)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S146.2-1 | Wedge | In the Hole | — | Replaced the post-merge retro sprint parser with the shared decimal sprint parser, relaxed the core retro sprint assertion to allow finite positive decimal ids, and added CLI/core regressions for S146.1-style post-merge retros. |
| S146.2-2 | Wedge | In the Hole | — | Ran scripts/version-bump.mjs 1.58.2 and verified the built CLI reports @slope-dev/slope v1.58.2 before preparing the follow-up release. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Pin Position | minor | S146.2 was inserted after the v1.58.1 release because the post-merge retro/memory gate itself exposed the decimal sprint gap. |

### Hazards Discovered

**Known hazards for future sprints:**
- Post-merge retro sprint parsing must stay aligned with roadmap, scorecard, validation, and branch-inference decimal sprint support.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Every post-hole and post-merge routine must share the same sprint-id parsing model as roadmap and scorecards. | `slope retro post-merge --sprint=146.1` now preserves decimal sprint ids in output paths, records, and durable memory text. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `corepack pnpm vitest run tests/cli/commands/retro.test.ts tests/core/retro.test.ts` passed: 12 tests. |
| testing | healthy | `corepack pnpm typecheck` and `corepack pnpm build` passed. |
| release | healthy | `node dist/cli/index.js retro post-merge --sprint=146.1 ... --dry-run --json` passed, and `node dist/cli/index.js version` reports @slope-dev/slope v1.58.2. |

### Course Management Notes

- Created GitHub issue #529 for the decimal post-merge retro failure.
- Implementation commit: 7695b6d.
- Version bump commit: 4427317.
- The PR should include `Closes #529`; after merge, create GitHub Release `v1.58.2` and verify npm latest updates.

### 19th Hole

- **How did it feel?** A tidy repair on the exact edge that release discipline touched: small code change, high trust value.
- **Advice for next player?** When adding decimal sprint support, grep for integer-only parser helpers in the adjacent lifecycle command, not just the main roadmap command.
- **What surprised you?** The retro core builder also enforced integer sprints, so the CLI parser fix alone would not have been enough.
- **Excited about next?** The S146.1 post-merge retro can now be captured with the real sprint id before S147 starts.

