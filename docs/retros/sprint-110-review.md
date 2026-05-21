## Sprint 110 Review: v1.55.14 Release Cycle Probe

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 2 |
| Score | 4 |
| Label | Bogey |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 1 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S110-1 | Wedge | Green | Rough: npm registry publication still depends on npm-side trusted publisher/package authorization. | Bumped package.json and the bundled Codex plugin manifest to 1.55.14, validated typecheck, build, and the full test suite locally, created GitHub release v1.55.14, and watched the publish workflow. GitHub Actions passed install/build/test/typecheck and signed npm provenance, then npm rejected publish with the same E404 permission/package authorization error. |

### Hazards Discovered

Known hazards for future sprints:

- Creating a GitHub release is not enough; npm-side trusted publisher authorization must accept the publish.
- The publish workflow can pass build/test/typecheck and provenance signing but still fail at the final npm PUT with E404.
- npm auto-corrected bin entries during publish, warning that bin script entries were removed; local npm pack did not reproduce that warning, so investigate before the next publish attempt.
- actions/setup-node@v4 ignored package-manager-cache, warning that the workflow input is not valid.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Release cycle probes need both local validation and live registry verification. | Validated the package bump locally, then verified the GitHub release workflow still fails at npm publish with E404 after provenance signing. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Validated pnpm run typecheck, pnpm run build, pnpm test, and git diff --check before creating the release; GitHub Actions repeated install, build, test, and typecheck successfully. |

### Course Management Notes

- Package version bumped from 1.55.13 to 1.55.14.
- Codex plugin template version bumped from 1.55.13 to 1.55.14.
- Before release, npm view @slope-dev/slope version still reported 1.55.11.
- Fast-forwarded main to 3075b3f for the 1.55.14 release bump.
- Created GitHub release v1.55.14, which triggered Publish to npm run 26259794247.
- Publish run passed install, build, test, typecheck, and npm 11.5.1 setup.
- npm publish signed provenance and published to the transparency log at logIndex 1596380075, then failed with E404 for @slope-dev/slope@1.55.14.
- After the failed release, npm view @slope-dev/slope version still reported 1.55.11.
- Local validation passed with 211 test files and 3433 tests.

### 19th Hole

- **How did it feel?** A tiny repo change with a very real external dependency: the release machinery can be clean while npm remains the deciding green.
- **Advice for next player?** Always verify npm view after a GitHub release; a successful release event and provenance signature are not proof that npm accepted the publish.
- **What surprised you?** The workflow reached npm far enough to sign provenance, which makes the remaining failure very specifically package authorization or trusted-publisher access.
- **Excited about next?** Once npm-side authorization is corrected, rerunning the release or dispatching the backfill workflow should have a much cleaner path.
