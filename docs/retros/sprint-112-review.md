## Sprint 112 Review: GitHub Actions Node 24 Warning Cleanup

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 3 |
| Slope | 1 |
| Score | 3 |
| Label | Par |
| Fairway % | 100% (1/1) |
| GIR % | 100% (1/1) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 1)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S112-1 | Wedge | Green | Rough: first full test run hit an existing git analyzer timing boundary. | Updated CI, publish, and docs-sync workflow actions from Node 20-era pins to Node 24-era major versions: `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, and `peter-evans/create-pull-request@v8`. Removed the stale `package-manager-cache` input from `publish.yml`. |

### Outcome

- `.github/workflows/ci.yml` now uses Node 24-era action majors.
- `.github/workflows/publish.yml` now uses Node 24-era action majors and no longer passes the invalid `package-manager-cache` input.
- `.github/workflows/sync-docs.yml` now uses Node 24-era action majors, including `peter-evans/create-pull-request@v8`.

### Hazards Discovered

Known hazards for future sprints:

- Some local tests have tight timing limits and can require a focused rerun before the full suite settles.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | Action runtime warnings are best fixed by upgrading action major versions rather than forcing runtime env vars. | Moved all local workflow JS action pins with available Node 24-era majors and removed the invalid setup-node input. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| workflow | healthy | No stale Node 20-era action pins or `package-manager-cache` input remain in `.github/workflows`. |
| testing | healthy | `pnpm run typecheck`, `pnpm run build`, `git diff --check`, targeted git analyzer test rerun, and second full `pnpm test` passed. |

### Course Management Notes

- `actions/checkout` moved from `v4` to `v6` in CI, publish, and docs sync.
- `actions/setup-node` moved from `v4` to `v6` in CI, publish, and docs sync.
- `pnpm/action-setup` moved from `v4` to `v6` in CI, publish, and docs sync.
- `peter-evans/create-pull-request` moved from `v7` to `v8` in docs sync.
- Removed `package-manager-cache` from `publish.yml`.
- First full `pnpm test` run failed on `tests/core/analyzers/git.test.ts` due a 5000ms timeout.
- `pnpm vitest run tests/core/analyzers/git.test.ts` passed on rerun.
- Second full `pnpm test` passed: 211 test files and 3433 tests.

### 19th Hole

- **How did it feel?** A tidy maintenance pass after the release repair: small YAML changes, big reduction in future CI noise.
- **Advice for next player?** When GitHub warns about action runtimes, check each action's current major before using runner env overrides.
- **What surprised you?** The only local turbulence was a pre-existing timeout-prone git analyzer test, not the workflow edit.
- **Excited about next?** The next release or CI run should be quieter and closer to the upcoming GitHub runner default.
