## Sprint 146.1 Review: Roadmap Hygiene Patch Release

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 2 |
| Score | 5 |
| Label | Par |
| Fairway % | 100% (5/5) |
| GIR % | 100% (5/5) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S146.1-1 | Short Iron | In the Hole | — | Updated slope version bump so it stages both package.json and templates/codex/plugins/slope/.codex-plugin/plugin.json after scripts/version-bump.mjs updates them, with regression coverage. |
| S146.1-2 | Short Iron | In the Hole | — | Made roadmap status resolve the current sprint from explicit active state and earliest non-terminal roadmap work, including decimal sprint ids, so inserted release sprints do not get skipped. |
| S146.1-3 | Wedge | In the Hole | — | Ran scripts/version-bump.mjs for 1.58.1 and verified node dist/cli/index.js version reports @slope-dev/slope v1.58.1. |
| S146.1-4 | Short Iron | Green | Rough: The first full release validation exposed that in-repo temp fixtures inherited the active release branch and sprint state, causing guard tests to fail only during a live sprint. | Moved guard test fixtures to OS temp directories and made sprint-completion branch inference decimal-aware, then reran the focused guard suites and full validation successfully. |
| S146.1-5 | Wedge | In the Hole | — | Validated release readiness locally with build, typecheck, full test suite, version smoke, roadmap/docs/map checks, and review findings clean. npm publish remains the post-merge GitHub Release workflow step. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| rough | minor | The release readiness gate found one SLOPE-local issue (#526) before PR creation; it was fixed and folded into the release sprint. |
| Pin Position | minor | Publishing is intentionally triggered by GitHub Release after the version bump PR passes CI and merges; no manual npm publish is expected. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S146.1-4 | The first full release validation exposed that in-repo temp fixtures inherited the active release branch and sprint state, causing guard tests to fail only during a live sprint. |

**Known hazards for future sprints:**
- A version bump wrapper can silently under-stage files if the script it delegates to changes additional manifests.
- Roadmap current-sprint logic must prefer explicitly active inserted sprints before later planned sprint ids.
- Guard regression fixtures should live outside the active repository when branch name or sprint state changes behavior.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Release bump commands need to stage every file updated by the underlying bump script. | slope version bump now stages the bundled plugin manifest alongside package.json when both are present. |
| Lessons | Inserted decimal sprints must be first-class throughout roadmap status, branch inference, scorecards, and shipped-artifact checks. | Roadmap status and sprint-completion branch inference now understand S146.1-style release sprints. |
| Lessons | Guard tests should not create fixture repositories inside the active repository when branch or sprint state affects behavior. | The guard suites now use OS temp fixture roots so local active sprint state cannot leak into regression tests. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `corepack pnpm vitest run tests/cli/version.test.ts tests/cli/roadmap.test.ts` passed: 34 tests. |
| testing | healthy | `corepack pnpm vitest run tests/cli/guards/sprint-completion.test.ts tests/cli/guards/workflow-step-gate.test.ts` passed: 50 tests. |
| testing | healthy | `corepack pnpm build`, `corepack pnpm typecheck`, and `corepack pnpm test` passed; full suite reported 232 test files passed, 1 skipped, 3639 tests passed, and 25 skipped. |
| docs | healthy | `node dist/cli/index.js roadmap validate`, `roadmap status`, `docs generate`, `docs check`, and `map --check` passed during release readiness validation. |
| release | healthy | `node dist/cli/index.js version` reports @slope-dev/slope v1.58.1; npm registry still reports 1.58.0 until the GitHub Release publish workflow runs after merge. |

### Course Management Notes

- Created GitHub issue #524 for release bump staging drift.
- Created GitHub issue #525 for stale roadmap current-sprint selection with inserted active sprints.
- Created GitHub issue #526 for guard tests inheriting parent repo branch and active sprint state.
- Release commits: 415bc4e, 6def39b, 1128c3e, and 224df13.
- Review recommendation: architect required, code optional; manual architect/code review found no findings.
- The release PR should include `Closes #524`, `Closes #525`, and `Closes #526`.
- After merge, create GitHub Release `v1.58.1`, watch the publish workflow, and verify npm reports @slope-dev/slope 1.58.1.

### 19th Hole

- **How did it feel?** A small release round with useful pressure: the release gate did exactly what it should and flushed out one local SLOPE issue before the package left the clubhouse.
- **Advice for next player?** When cutting a patch release, verify the generated package and plugin versions, then let GitHub Release drive the npm publish path after CI is green.
- **What surprised you?** The full suite failure was not a release bug; it was a fixture isolation issue exposed by running tests from an active decimal sprint branch.
- **Excited about next?** S147 can now start from a clean roadmap and a fresh patch release instead of carrying release hygiene debt.

