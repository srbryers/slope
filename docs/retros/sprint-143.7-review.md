# Sprint 143.7 Review: Windows-Safe Map Staleness Checks

## Outcome

S143.7 closes #512 by removing Unix-only stderr redirection from the map staleness git path.

- `map.ts` now suppresses child stderr through `execSync` stdio options.
- `gitDistanceSinceMapSha` no longer appends `2>/dev/null`.
- A spawned CLI regression checks both `slope map --check` and `slope commit-ready --json`.
- Branch-built smoke checks confirmed both commands produce empty stderr for the fixed path.

## Review

Architect review: recommended, complete. This keeps the existing map staleness design and changes only the process boundary, replacing shell-specific suppression with child-process stdio suppression.

Code review: optional, complete. The regression uses the built CLI so stdout/stderr behavior is tested at the same surface where the bug appeared. It also verifies `commit-ready --json` remains valid JSON on stdout.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/cli/commands/map.test.ts tests/cli/commands/commit-ready.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `node dist/cli/index.js map --check` with stderr redirected to a file
- `node dist/cli/index.js commit-ready --json` with stderr redirected to a file
- `slope roadmap validate`

## Learning

The portable fix is to move stderr handling out of shell syntax and into Node child-process options. The same pattern appears elsewhere, so #514 is now triaged as a broader audit sprint.

Follow-ups: #513 covers floating-point noise in decimal sprint currency output; #514 covers remaining Node exec redirection portability.
