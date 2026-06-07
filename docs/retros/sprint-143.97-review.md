# Sprint 143.97 Review: Git Analyzer Cadence Fixture Stability

## Outcome

S143.97 closes #516 by making the git analyzer daily-cadence regression less sensitive to Windows full-suite load.

- Raised #516 after S144 release validation timed out in `tests/core/analyzers/git.test.ts`.
- Preserved the 65-commit daily-cadence signal.
- Replaced slow worktree/index commits with `git commit-tree` plus `git update-ref`.
- Focused, paired stress, typecheck, and full-suite validation passed.

## Review

Architect review: required, complete. The fixture still exercises `analyzeGit` against a real git repository and real commit history, but builds that history through git plumbing instead of repeatedly mutating the index.

Code review: optional, complete. The helper uses `execFileSync` argument arrays for the new git plumbing calls and keeps the existing test assertions unchanged.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/core/analyzers/git.test.ts`
- `corepack pnpm vitest run tests/core/analyzers/git.test.ts tests/mcp/index-src.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `node dist/cli/index.js map --check`
- `node dist/cli/index.js roadmap validate`

## Learning

Focused green is not always enough for release-gate confidence when a regression fixture spends several seconds creating local git history. Keep the behavioral signal, but use cheap git primitives for synthetic history.
