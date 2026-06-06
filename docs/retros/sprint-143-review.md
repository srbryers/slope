# Sprint 143 Review: Portable Sprint Resume

## Outcome

S143 closes #507 by adding a portable resume path for in-flight SLOPE sprints when `.slope/` runtime state is intentionally gitignored.

- `slope sprint resume --portable` reconstructs local sprint-state from tracked artifacts and current git context.
- `slope resume` provides a top-level portable resume alias.
- `slope sprint resume --write-pointer` writes `docs/backlog/.sprint-active.json` with sprint, phase, source branch, source commit, evidence, and claim pointers.
- Portable resume restores claim pointers only; local DBs, session locks, guard metrics, and baselines remain machine-local.
- Unsafe pointers print their evidence and refuse by default unless `--force` is explicit.
- `docs/backlog/sprint-resume.md` documents the cross-machine workflow and keeps common-issues ranking local-only by default.

## Review

Architect review: required, complete. The design keeps the boundary clean: tracked artifacts carry durable sprint intent, while runtime state remains local. The safety model checks branch, source commit ancestry, evidence presence, completed-roadmap conflicts, and existing local sprint-state before writing a fresh `.slope/sprint-state.json`.

Code review: optional, complete. The resume module uses structured JSON parsing, existing roadmap and scorecard helpers, `execFileSync` with argv arrays, and focused tests for pointer restore, branch mismatch refusal, pointer writing, branch inference, registry coverage, and top-level alias smoke behavior.

No S143 implementation findings were recorded. A process hazard was recorded after accidentally parallelizing gate writes during closeout; final gate state remained correct after sequential verification.

## Validation

- `corepack pnpm vitest run tests/cli/sprint-resume.test.ts tests/cli/sprint-workflow.test.ts tests/cli/sprint-inference.test.ts tests/cli/sprint-state.test.ts tests/cli/registry.test.ts tests/cli/init-summary.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `corepack pnpm test`
- `slope roadmap validate`
- `node dist/cli/index.js resume --dry-run` in a fresh temp repo

## Learning

Portable sprint recovery should restore durable intent, not foreign local runtime internals. The right artifact is a small tracked pointer with explicit evidence and refusal rules, not a synced `.slope/` directory.

Follow-up: `slope commit-ready` reported the map stale after `slope map --check` reported current. That contradiction should be raised and triaged as a SLOPE issue before the phase is considered clean.
