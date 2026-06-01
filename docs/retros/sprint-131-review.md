## Sprint 131 Review: Guard Recovery Patch Release

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
| S131-1 | Wedge | Green | Rough: Release validation caught the S130 scorecard referencing an external GitHub plugin skill that is not in the repo skill registry; the scorecard metadata was corrected before publishing. | Used scripts/version-bump.mjs to move package.json and the bundled Codex plugin manifest from 1.57.1 to 1.57.2, then fixed the S130 skills_used metadata so validate --skills passed. |
| S131-2 | Short Iron | In the Hole | — | Merged PR #473, published GitHub release v1.57.2, watched the trusted-publisher npm workflow pass, verified npm latest is 1.57.2, and smoke-tested the installed package. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| workflow | minor | The release branch included a small scorecard metadata correction because the merged S130 closeout had passed normal validation but failed skill-aware release validation. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S131-1 | Release validation caught the S130 scorecard referencing an external GitHub plugin skill that is not in the repo skill registry; the scorecard metadata was corrected before publishing. |

**Known hazards for future sprints:**
- Scorecard skills_used currently validates against the repo skill registry, not every plugin skill available in the Codex runtime.
- Release scorecards should wait for registry verification before claiming publish success.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | External plugin skill names should not be recorded in scorecard skills_used unless the repo skill registry can validate them. | S131 removed the invalid github:yeet skill reference from S130 and preserved GitHub usage in narrative notes instead. |
| Lessons | Release closeout should wait for npm metadata and installed-package verification. | S131 completed only after npm latest returned 1.57.2 and npm exec ran the published slope binary successfully. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Build, typecheck, full pnpm test, SLOPE validation, roadmap validation, map check, whitespace check, npm pack dry run, PR CI, and release workflow tests passed. |
| release | healthy | GitHub release v1.57.2 and npm trusted publishing completed successfully; npm latest now resolves to 1.57.2. |

### Course Management Notes

- PR #472 merged on 2026-05-31 at commit 20bc62a2b020370e0192216755c848c7072db774 and closed #470 and #471.
- Before release, npm latest reported 1.57.1.
- Bumped @slope-dev/slope and templates/codex/plugins/slope/.codex-plugin/plugin.json from 1.57.1 to 1.57.2.
- Committed the version bump as be6ca53: chore(S131-1): bump release version to 1.57.2.
- node dist/cli/index.js validate --skills initially failed because S130 referenced github:yeet in skills_used.
- Corrected docs/retros/sprint-130.json and committed the fix as 2dbcc92: docs(S131-2): fix S130 skill validation.
- pnpm run build passed locally.
- pnpm exec tsc --noEmit passed locally.
- pnpm run typecheck passed locally.
- pnpm test passed locally: 219 test files passed, 1 skipped test file, 3532 passed tests, and 25 skipped tests.
- node dist/cli/index.js validate --skills passed after the S130 metadata correction.
- node dist/cli/index.js roadmap validate passed with standing roadmap warnings only.
- node dist/cli/index.js map --check passed: Overall CURRENT.
- node dist/cli/index.js version returned @slope-dev/slope v1.57.2.
- git diff --check passed.
- npm pack --dry-run passed for @slope-dev/slope@1.57.2 with 1030 files, package size 941.5 kB, and unpacked size 4.4 MB.
- PR #473 merged on 2026-05-31 at commit 20b7aea281923702cd2447fac981c9dc21d512da.
- GitHub release v1.57.2 published on 2026-05-31: https://github.com/srbryers/slope/releases/tag/v1.57.2.
- Publish to npm workflow run 26712031923 passed in 2m40s.
- npm view @slope-dev/slope version returned 1.57.2 and the latest dist-tag points to 1.57.2.
- npm view @slope-dev/slope@1.57.2 recorded publish time 2026-05-31T12:03:31.901Z, integrity sha512-1/bx7v+IMfhub2MNkApodvwIPWM+ZhC01cu0jKN/rvN99yVJrlVn8wCJDffmxo+jCfJ//7EjnOVDC61Mxjg8FQ==, and shasum 876411d0440f65139d1b5724884907a111a74c64.
- npm exec --yes --package @slope-dev/slope@1.57.2 -- slope version returned @slope-dev/slope v1.57.2.

### 19th Hole

- **How did it feel?** Mostly clean: the release machinery worked, and the only adjustment was a useful skill-validation catch from the previous sprint scorecard.
- **Advice for next player?** Keep validate --skills in the release gate, and keep scorecard skills_used limited to skills present in .slope/skills.json.
- **What surprised you?** The external GitHub plugin skill reference was valid in the Codex session but not in SLOPE's repo-local skill registry.
- **Excited about next?** The guard recovery and closeout fixes are now available from npm, so the next sprint can move back to planned roadmap work.
