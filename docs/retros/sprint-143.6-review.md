# Sprint 143.6 Review: Decimal Sprint Status Parsing

## Outcome

S143.6 closes #511 by preserving decimal sprint ids in `slope status --sprint=N`.

- `status` now uses `parseSprintNumber` instead of `parseInt`.
- `--sprint=143.5` stays S143.5 instead of truncating to S143.
- Invalid sprint flags now print the shared sprint-id guidance.
- Invalid sprint flags are rejected before opening the SLOPE store.

## Review

Architect review: recommended, complete. This removes one more split in sprint-id semantics by routing status through the same parser as briefing, claim, sprint plan, and resume.

Code review: optional, complete. Focused regressions cover the discovered decimal bug and malformed sprint input. A small review polish moved sprint validation ahead of store opening so bad flags fail deterministically.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/cli/commands/status.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `node dist/cli/index.js status --sprint=143.6`
- `node dist/cli/index.js status --sprint=143.nope`
- `slope roadmap validate`

## Learning

Decimal sprint ids are now common enough that integer parsing is a hazard. SLOPE commands should treat sprint ids as a first-class project type and use `parseSprintNumber` for CLI inputs.

Follow-up: #512 was raised for the Windows stderr leak in `slope map --check` and `slope commit-ready --json`; it is triaged into S143.7 before S144.
