# Sprint 139 Review: Existing Worktree Entry Guidance

## Outcome

S139 closes #499 by teaching `worktree-check` to prefer entering an existing worktree before suggesting a new one.

- Parses branch names from `git worktree list --porcelain`.
- Matches existing worktrees by conflicting/current branch or edited file path.
- Adds denial guidance for `EnterWorktree` with a non-Claude `cd` + relaunch fallback.
- Keeps the existing session reconciliation path that updates role, branch, and worktree path after entry.
- Allows safe recovery commands with `2>&1` stderr redirection.

## Review

Architect review: required, complete. The recovery model now follows the right priority: reuse existing worktree, otherwise create an isolated SLOPE worktree, otherwise clear stale sessions. This reduces duplicate worktrees and preserves the prior reconciliation path.

Code review: optional, complete. The change stays inside `worktree-check`, adds focused parser helpers, and covers both new guidance and redirect parsing. Existing chained and piped-command denial tests still pass.

## Validation

- `corepack pnpm vitest run tests/cli/guards/worktree-check.test.ts tests/cli/guards/worktree-check-integration.test.ts tests/cli/guards/worktree-reuse.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `slope roadmap validate`

## Learning

Guard recovery text is part of the product contract. If SLOPE already has a safe recovery mechanism, the guard should point directly at it instead of nudging agents toward duplicate setup.
