# Sprint 143.98 Review: npm Bin Metadata Release Cleanliness

## Outcome

S143.98 closes #517 by removing npm's publish-time auto-correction warning for SLOPE CLI bin metadata.

- Normalized root `package.json` bin paths from `./dist/...` to `dist/...`.
- Added a package metadata regression for the `slope` and `mcp-slope-tools` bin targets.
- Confirmed npm publish dry-run no longer emits the auto-correction warning.

## Review

Architect review: required, complete. The package still exposes the same two CLI bins and still points at the same built files; only npm's source metadata normalization was made explicit.

Code review: optional, complete. The regression reads the root package metadata and asserts both exact bin targets and no leading `./` path prefix.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/cli/package-metadata.test.ts tests/cli/version.test.ts`
- `corepack pnpm typecheck`
- `npm.cmd publish --dry-run --access public`
- `npm.cmd pack --dry-run --json`
- `node dist/cli/index.js version`
- `node dist/cli/index.js map --check`
- `node dist/cli/index.js roadmap validate`

## Learning

Publish dry-run warnings are part of the release gate. An exit code of 0 is not enough when npm says it corrected package metadata that source control does not yet represent.
