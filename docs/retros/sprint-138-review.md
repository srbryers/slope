# Sprint 138 Review: Destructive Help Safety

## Outcome

S138 closes #501 and extends the fix beyond the original `slope sprint reset --help` incident. Help flags now short-circuit before stateful or destructive subcommand paths in the audited command families:

- `slope sprint reset --help` preserves sprint state.
- `slope session start --help` does not register a session.
- `slope session prune --help` does not prune stale sessions.
- `slope worktree start --help` and `slope worktree cleanup --all --help` do not run git worktree actions.
- `slope version bump --help` does not enter release automation.

## Review

Architect review: required, complete. The fix keeps the safety rule at command dispatch boundaries instead of pushing it into individual mutating helpers. That makes the contract simple: help is resolved before store access, git worktree operations, or release automation.

Code review: optional, complete. The touched handlers are narrow, tests assert both output and lack of side effects, and compiled CLI smoke verified the original reset state preservation path.

## Validation

- `corepack pnpm vitest run tests/cli/sprint-workflow.test.ts tests/cli/commands/session.test.ts tests/cli/commands/worktree.test.ts tests/cli/version.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `slope roadmap validate`
- Built CLI smoke for sprint reset, session start, worktree cleanup, and version bump nested help.

## Learning

Nested help is a state-safety boundary, not just a documentation affordance. Stateful command families should check `--help` before parsing action flags or invoking subcommand handlers.
