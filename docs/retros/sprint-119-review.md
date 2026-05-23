## Sprint 119 Review: Skill Registry Follow-ups

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
| Hazard Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S119-1 | Wedge | In the Hole | - | validateScorecard now normalizes scorecard stats before reading miss_directions, so legacy or sparse scorecards report validation findings instead of throwing. |
| S119-2 | Wedge | In the Hole | - | Added explicit skills help handling for --help and -h, preserving usage output while returning a successful CLI exit. |
| S119-3 | Short Iron | In the Hole | - | skills scan now prunes common generated, dependency, cache, virtualenv, and worktree directories by default, uses lstat so symlinked directories are not followed, and still scans an explicitly requested root. |
| S119-4 | Short Iron | In the Hole | - | Briefing recommendations now bias skills and gaps recorded on the requested sprint scorecard, keeping historical context useful without letting recency override an explicit sprint request. |

### Hazards Discovered

No new hazards were hit during S119.

**Known hazards for future sprints:**
- Repo-wide validate --skills still exits nonzero on pre-existing historical S70 and S74-S83 GIR overflow scorecards.
- Skill scanners should default to pruning generated/dependency/worktree directories and avoid following symlinked directories.
- Briefing fixtures need skill ids and gap terms that do not accidentally overlap unrelated registered skill metadata.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Validators should normalize sparse historical data before derived checks. | validate --skills no longer crashes when miss_directions is omitted from a scorecard stats block. |
| Lessons | Broad filesystem scans need conservative default pruning with an explicit-root escape hatch. | skills scan avoids noisy dependency/generated/worktree trees by default while still honoring an explicitly requested scan root. |
| Lessons | Briefing recommendations should respect the sprint the user asked about, not just the most recent scorecards. | Requested sprint skill metadata and skill gaps now receive explicit recommendation weight and evidence. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused validation, skills, and briefing tests passed; full pnpm test, build, typecheck, CLI smoke, map check, roadmap validation, diff check, and npm pack dry run also passed. |
| issue_queue | healthy | Implemented the four new GitHub issues in one sprint and prepared PR closure references for #440, #441, #442, and #443. |

### Course Management Notes

- Created S119 from GitHub issues #440, #441, #442, and #443.
- pnpm vitest run tests/core/validation.test.ts tests/core/skills.test.ts tests/cli/skills.test.ts tests/core/briefing.test.ts tests/cli/validate-skills.test.ts passed: 145 tests.
- pnpm build passed.
- pnpm typecheck passed.
- pnpm test passed: 214 test files and 3478 tests.
- node dist/cli/index.js skills --help passed with exit code 0.
- node dist/cli/index.js briefing --sprint=119 --compact passed.
- node dist/cli/index.js validate --skills docs/retros/sprint-119.json passed with no errors or warnings.
- node dist/cli/index.js roadmap validate passed as structurally valid with standing roadmap warnings plus the expected branch-local S119 not-on-main warning.
- node dist/cli/index.js map --check passed: Overall CURRENT.
- git diff --check passed.
- npm pack --dry-run passed for @slope-dev/slope@1.56.1 with 1018 files.
- node dist/cli/index.js validate --skills against the full historical scorecard set still exits 1 because of pre-existing S70 and S74-S83 GIR overflow scorecards; S119 uses targeted scorecard and regression validation.

### 19th Hole

- **How did it feel?** Tidy and a little satisfying: each report mapped to a narrow product behavior, and the tests made the fixes feel well pinned down.
- **Advice for next player?** Keep skill-registry work covered at both core and CLI boundaries; these bugs mostly hide where old scorecards or broad repo roots meet user-facing commands.
- **What surprised you?** The broad validate command still exposes old GIR overflow scorecards even though modern scorecards are clean.
- **Excited about next?** The skill registry now behaves better in real repos: quieter scans, cleaner help, safer validation, and sprint-aware briefing.
