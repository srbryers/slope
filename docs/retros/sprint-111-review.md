## Sprint 111 Review: Trusted Publisher Release Rerun

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 1 |
| Score | 2 |
| Label | Birdie |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S111-1 | Wedge | In the Hole | - | Reran the failed v1.55.14 Publish to npm workflow after the npm trusted publisher was configured for `srbryers/slope` and `.github/workflows/publish.yml`. The rerun passed install, build, test, typecheck, trusted publishing setup, and npm publish. |

### Outcome

- Publish workflow attempt 2 succeeded: https://github.com/srbryers/slope/actions/runs/26259794247/attempts/2
- npm now reports `@slope-dev/slope` latest as `1.55.14`.
- npm metadata for `1.55.14` includes both CLI bins: `slope` and `mcp-slope-tools`.
- GitHub issue #406 was closed as fixed.

### Hazards Discovered

Known hazards for future sprints:

- The workflow still emits non-blocking warnings about `actions/setup-node` `package-manager-cache` and Node.js 20 action deprecation.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Trusted publisher fixes can be verified by rerunning the failed release workflow instead of cutting a new version. | The second attempt for run 26259794247 succeeded and npm latest advanced from 1.55.11 to 1.55.14. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| release | healthy | GitHub Actions passed install, build, test, typecheck, trusted publishing setup, and publish on the rerun. |
| registry | healthy | `npm view @slope-dev/slope version --registry https://registry.npmjs.org` reports `1.55.14`. |

### Course Management Notes

- Reran Publish to npm run 26259794247 after npm trusted publisher configuration was added.
- Attempt 2 succeeded: https://github.com/srbryers/slope/actions/runs/26259794247/attempts/2
- npm latest advanced to `1.55.14`.
- Closed GitHub issue #406 as fixed.

### 19th Hole

- **How did it feel?** A clean recovery: the exact same release machinery succeeded once npm trusted the workflow.
- **Advice for next player?** When npm E404 appears after provenance signing, check package trusted publisher settings before touching repo code.
- **What surprised you?** Rerunning the failed release attempt was enough; no new version bump or release tag was required.
- **Excited about next?** The normal release path is unblocked again.
