# Sprint 140 Review: Session Collision Guard Recovery

## Outcome

S140 closes #502 by keeping the session-collision guard focused on local working-tree safety while allowing recovery and remote PR operations to proceed.

- Filters stale returned sessions by heartbeat age during collision detection.
- Allows single-segment `gh pr view/checks/status/list/merge` before opening the session store.
- Allows safe git status/log/diff/show/rev-parse/fetch/ls-remote plus narrow branch and remote read forms.
- Keeps working-tree-mutating commands such as `git checkout -b`, `git branch -D`, and `git remote set-url` blocked during collisions.
- Adds stale-session recovery guidance for `slope session prune`.

## Review

Architect review: required, complete. The guard now separates local isolation risk from remote/read-only coordination. The collision check still protects editing and worktree-mutating shell commands, while stale sessions and PR completion no longer force manual intervention.

Security review: required, complete. The first allowlist was too broad for mixed read/write git subcommands. The follow-up correction constrains `git branch` and `git remote` to exact read-safe forms and adds regressions for branch deletion and remote config mutation.

Code review: optional, complete. The implementation stays inside `worktree-check`, reuses the existing shell tokenizer, and preserves the single-segment rule so command chaining still falls through to the normal collision guard.

## Validation

- `corepack pnpm vitest run tests/cli/guards/worktree-check.test.ts tests/cli/guards/worktree-check-integration.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `slope roadmap validate`

## Learning

Guard bypasses are security-sensitive even when the target issue is workflow friction. Exact command-shape tests are cheap insurance when a subcommand can mutate local refs, config, or worktrees.
