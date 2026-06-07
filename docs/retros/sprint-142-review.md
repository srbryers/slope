# Sprint 142 Review: Codebase Map Guard Non-TS Safety

## Outcome

S142 closes #505 by making the codebase-map recovery path safe for curated non-TypeScript repositories and harness worktrees.

- `slope map` now preserves existing downstream non-SLOPE-shaped `CODEBASE.md` content by refreshing metadata or marker-delimited generated sections.
- `slope map --force` remains the explicit replacement path.
- Source counting now recognizes Python, C#, JS, Java, Go, Rust, Ruby, PHP, Swift, Kotlin, and C/C++ sources, while skipping generated, dependency, runtime, and `.slope` directories.
- `slope map --check` and `exploreGuard` now use ancestry-path git distance so sibling worktree bases do not inflate staleness into false write blocks.
- Regressions cover curated zero-source maps, Python/Unity-shaped source trees, sibling-branch `map --check`, and explore-guard ancestry-path staleness.

## Review

Architect review: required, complete. The guard no longer has a dead-end recovery path: the command it recommends can clear staleness without overwriting curated maps. The ancestry-path model keeps ordinary ancestor staleness intact while preventing sibling worktree SHAs from becoming large false blocking counts.

Code review: optional, complete. Existing downstream generated maps refresh only marked sections, curated maps get metadata-only refresh, and `--force` is the only default overwrite path. The source walker skips `.slope` and common generated/runtime folders so linked worktrees and build products do not pollute counts.

## Validation

- `corepack pnpm vitest run tests/cli/commands/map.test.ts tests/cli/guards/explore.test.ts`
- `corepack pnpm vitest run tests/cli/commands/commit-ready.test.ts tests/cli/guards.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `slope roadmap validate`

## Learning

Recovery commands are part of guard design. If a guard blocks and tells the user to run a command, that command must be safe, non-destructive by default, and able to update the exact state the guard uses to decide.
