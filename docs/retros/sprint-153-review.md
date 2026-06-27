## Sprint 153 Review: Semver Recommendation Evidence Hardening

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 2 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (3/3) |
| GIR % | 100% (3/3) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 3)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S153-1 | Short Iron | In the Hole | - | Added SLOPE release-evidence collection for unreleased changelog entries by reading sprint references, commit subjects, changed scorecard paths, completed roadmap metadata, and scorecards. |
| S153-2 | Wedge | In the Hole | - | `slope version recommend` now reports the conventional-commit tier, any durable SLOPE release evidence used, and when evidence raises the recommendation above the commit-subject tier. |
| S153-3 | Short Iron | In the Hole | - | Added git-backed regression coverage for hidden feature-level scorecard evidence, planned roadmap work that must not promote, and completed roadmap metadata without a scorecard. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | minor | The v1.59.0 release cycle exposed that squash-merged feature work can lose conventional-commit signals even when SLOPE roadmap and scorecard evidence is durable. |
| Rough | minor | The release smoke initially over-included old unreleased changes until local tags were fetched, reinforcing that version validation should begin with fresh tags. |

### Hazards Discovered

**Known hazards for future sprints:**
- Squash commit subjects can hide feature-level work from semver recommendation.
- Planned roadmap entries must not count as shipped release evidence.
- Stale local tags can make version recommendation smokes over-include older release trains.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Durable SLOPE evidence should raise semver only when work is actually shipped. | The classifier ignores planned roadmap entries unless the sprint is complete or a scorecard exists, and plain bugfix/test/release/planning metadata remains patch-level. |
| Lessons | Release recommendation tests need both undercall prevention and over-promotion guardrails. | Regression coverage now includes shipped feature evidence, planned feature evidence with no shipment, and completed roadmap metadata without a scorecard. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | `pnpm test tests/cli/version.test.ts tests/cli/commands/version.test.ts` passed: 2 files, 11 tests. |
| testing | healthy | `pnpm typecheck` passed. |
| testing | healthy | `pnpm build` passed. |
| testing | healthy | `pnpm test` passed: 235 files, 3677 tests, 25 skipped. |
| validation | healthy | `git fetch origin --tags` followed by `node dist/cli/index.js version recommend` reported the current unreleased S153 work as patch-level before closeout artifacts, confirming no stale-tag overcount. |
| validation | healthy | `node dist/cli/index.js validate docs/retros/sprint-153.json` passed with no errors or warnings. |

### Course Management Notes

- No code-review or architect-review findings were recorded for S153.
- S153 remains a bugfix + release workflow sprint, so its own closeout evidence should not promote unrelated feature-level release guidance.
- The PR should close GitHub issue #550 after CI passes and the branch is merged.

### 19th Hole

- **How did it feel?** A small but satisfying release-tooling repair: the command can now see the sprint evidence that humans were already using during release judgment.
- **Advice for next player?** Fetch tags before release recommendation smokes, then compare conventional-commit output against scorecard and roadmap evidence before picking a semver level.
- **What surprised you?** The important part was not just finding feature words; it was refusing to count planned roadmap work as shipped evidence.
- **Excited about next?** The issue-driven recovery train can now move into roadmap/status integrity with release recommendation no longer blind to shipped SLOPE context.
