## Sprint 118 Review: Guard Hardening Release

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
| S118-1 | Wedge | In the Hole | - | Used scripts/version-bump.mjs to move package.json and the bundled Codex plugin manifest from 1.56.0 to 1.56.1, then confirmed the built CLI reported @slope-dev/slope v1.56.1. |
| S118-2 | Short Iron | In the Hole | - | Merged PR #444, published GitHub release v1.56.1, watched the trusted-publisher npm workflow pass, verified npm latest is 1.56.1, and smoke-tested the installed package. |

### Hazards Discovered

No new hazards were hit during S118.

**Known hazards for future sprints:**
- Release scorecards should wait for registry verification before claiming publish success.
- Patch release PRs should avoid mixing unrelated cleanup once the code change has already shipped to main.
- Trusted publishing still needs an npm metadata check and installed-package smoke test after the GitHub workflow passes.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Patch releases should stay narrow when the underlying feature work is already merged. | S118 shipped only the roadmap release plan and version bump before tagging v1.56.1. |
| Lessons | Trusted publishing needs a registry-side verification loop, not just a successful GitHub release. | The closeout waited for the Publish to npm workflow, npm latest metadata, and installed CLI smoke test before marking the sprint complete. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Build, typecheck, focused guard tests, full pnpm test, npm pack dry run, CI, and release workflow tests passed. |
| release | healthy | GitHub release v1.56.1 and npm trusted publishing completed successfully; npm latest now resolves to 1.56.1. |

### Course Management Notes

- Added S118 to the roadmap as the guard hardening release sprint.
- Bumped @slope-dev/slope and templates/codex/plugins/slope/.codex-plugin/plugin.json from 1.56.0 to 1.56.1.
- pnpm build passed locally.
- pnpm typecheck passed locally.
- pnpm vitest run tests/cli/guards/worktree-check.test.ts tests/cli/guards/stop-check.test.ts passed: 38 tests.
- pnpm test passed locally: 214 test files and 3472 tests.
- npm pack --dry-run passed for @slope-dev/slope@1.56.1 with 1018 files.
- node dist/cli/index.js validate --skills passed before release.
- node dist/cli/index.js map --check passed before release: Overall CURRENT.
- node dist/cli/index.js roadmap validate passed as structurally valid with only standing roadmap warnings plus expected branch-local S118 warnings before closeout reaches main.
- PR #444 merged on 2026-05-23 at commit 2c100019ad777ea2c20427aec525a1c6be81b6f4.
- GitHub release v1.56.1 published on 2026-05-23 at 18:39:00Z.
- Publish to npm workflow run 26340502869 passed in 3m7s.
- npm view @slope-dev/slope version returned 1.56.1 and the latest dist-tag points to 1.56.1.
- npm exec --yes --package @slope-dev/slope@1.56.1 -- slope version returned @slope-dev/slope v1.56.1.

### 19th Hole

- **How did it feel?** Smooth and contained: the trusted publisher setup did exactly what we needed once the GitHub release landed.
- **Advice for next player?** Keep release PRs thin, merge them before tagging, and verify npm with both metadata and an installed CLI smoke test.
- **What surprised you?** Nothing had to be retriggered this time; the release workflow moved cleanly from build through publish.
- **Excited about next?** The S117 guard hardening is now available from the public package instead of only from main.
