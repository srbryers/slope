# Sprint 143.9 Review: Node Exec Redirection Portability Audit

## Outcome

S143.9 closes #514 by removing Unix-only `/dev/null` stderr redirection from production Node-executed command paths.

- Added `src/core/process.ts` with shared quiet child-process stdio constants.
- Replaced `2>/dev/null` in CLI guards, worktree/version/guard commands, MCP testing worktree cleanup, map/flow staleness probes, and lightweight repo detection.
- Left generated POSIX shell templates in adapters/harness untouched.
- Added a production-source regression that fails if Node-executed source reintroduces `2>/dev/null` outside generated shell-template files.

## Review

Architect review: required, complete. The architecture change is deliberately tiny: one shared process constant plus targeted call-site updates, with no change to command success/failure semantics.

Code review: optional, complete. The main risk was over-broad replacement, so the diff preserves generated shell snippets and adds a source-level guardrail for the production Node paths.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/cli/portable-exec-redirection.test.ts tests/cli/guards/branch-before-commit.test.ts tests/cli/guards/worktree-merge.test.ts tests/cli/guards/worktree-self-remove.test.ts tests/cli/guards/worktree-reuse.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `node dist/cli/index.js guard branch-before-commit` with stderr captured
- `corepack pnpm test`
- `node dist/cli/index.js map --check`

## Learning

For Windows portability, shell syntax is the wrong place to suppress child-process output. Let Node own stderr routing through `stdio`; reserve POSIX redirection for generated POSIX scripts.
