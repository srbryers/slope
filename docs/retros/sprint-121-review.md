## Sprint 121 Review: Skill Registry Patch Release

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
| S121-1 | Wedge | In the Hole | - | Used scripts/version-bump.mjs to move package.json and the bundled Codex plugin manifest from 1.56.1 to 1.56.2, then confirmed the built CLI reported @slope-dev/slope v1.56.2. |
| S121-2 | Short Iron | Green | rough: An initial local parallel build/test attempt exposed a transient dist export race; rerunning build and tests sequentially passed cleanly. | Merged PR #449, published GitHub release v1.56.2, watched the trusted-publisher npm workflow pass, verified npm latest is 1.56.2, and smoke-tested the installed package. |

### Hazards Discovered

One minor non-release-blocking rough was hit during S121: a local validation sequencing race while build and tests ran in parallel against generated dist output. Sequential build and test runs passed cleanly before release.

**Known hazards for future sprints:**
- Tests that execute dist/cli should not run while pnpm build is rewriting dist.
- Release scorecards should wait for registry verification before claiming publish success.
- Trusted publishing still needs an npm metadata check and installed-package smoke test after the GitHub workflow passes.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Do not run dist-producing builds in parallel with tests that shell into the generated CLI. | An initial local parallel build/test attempt exposed a transient dist export race; rerunning build and tests sequentially passed cleanly. |
| Lessons | Release closeout should stay split from the tag commit. | The version bump merged first, then the GitHub release and npm facts were recorded in this post-release closeout. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Build, typecheck, focused init-codex tests, full pnpm test, npm pack dry run, PR CI, and release workflow tests passed. |
| release | healthy | GitHub release v1.56.2 and npm trusted publishing completed successfully; npm latest now resolves to 1.56.2. |

### Course Management Notes

- Added S121 to the roadmap as the skill registry patch release sprint.
- Bumped @slope-dev/slope and templates/codex/plugins/slope/.codex-plugin/plugin.json from 1.56.1 to 1.56.2.
- pnpm build passed locally.
- pnpm typecheck passed locally.
- pnpm vitest run tests/cli/init-codex.test.ts passed locally: 9 tests.
- pnpm test passed locally after a sequential rebuild: 214 passed test files, 1 skipped test file, 3479 passed tests, and 23 skipped tests.
- npm pack --dry-run passed for @slope-dev/slope@1.56.2 with 1018 files, package size 917.2 kB, and unpacked size 4.3 MB.
- node dist/cli/index.js validate --skills passed before release.
- node dist/cli/index.js roadmap validate passed before release with standing warnings only plus the expected branch-local S121 warning.
- node dist/cli/index.js map --check passed before release: Overall CURRENT.
- node dist/cli/index.js version returned @slope-dev/slope v1.56.2.
- git diff --check passed before release.
- PR #449 merged on 2026-05-23 at commit 45d6ca8a81087ee03f69f52189091d04beb0e0b7.
- GitHub release v1.56.2 published on 2026-05-23 at 19:40:22Z.
- Publish to npm workflow run 26341764973 passed in 3m2s.
- npm view @slope-dev/slope version returned 1.56.2 and the latest dist-tag points to 1.56.2.
- npm exec --yes --package @slope-dev/slope@1.56.2 -- slope version returned @slope-dev/slope v1.56.2.

### 19th Hole

- **How did it feel?** Contained and disciplined: the release path stayed narrow, and trusted publishing completed without manual recovery.
- **Advice for next player?** Keep build and test sequential when tests use generated dist output, then verify npm with metadata and an installed CLI smoke test.
- **What surprised you?** The only bump was local validation sequencing; the GitHub and npm release path itself was smooth.
- **Excited about next?** The skill registry follow-ups and historical scorecard validation cleanup are now available from the public package.
