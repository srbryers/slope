# Sprint 143.5 Review: Commit-Ready Map Freshness Alignment

## Outcome

S143.5 closes #510 by aligning `slope commit-ready` with `slope map --check` for `CODEBASE.md` freshness.

- `commit-ready` now uses `runStalenessCheck` instead of separate git last-touch history.
- Current ignored/untracked maps no longer warn stale just because `CODEBASE.md` has old tracked history.
- `commit-ready` warns only when map-check semantics return a stale result.
- A regression covers a historically tracked, later ignored, locally regenerated `CODEBASE.md`.

## Review

Architect review: recommended, complete. This removes a split-brain freshness model. The guard-adjacent command now shares the same computation as the recovery command it recommends, so `slope map` can clear the warning path it is asked to fix.

Code review: optional, complete. The new regression recreates the discovered failure: old CODEBASE history exists, the current file is ignored/untracked, and regenerated frontmatter points at current `HEAD`. The implementation keeps missing-map behavior unchanged and fails open to existence-only if staleness analysis cannot run.

No implementation findings were recorded. The test was tightened after an initial full-suite timeout caused by too many fixture commits.

## Validation

- `corepack pnpm vitest run tests/cli/commands/commit-ready.test.ts tests/cli/commands/map.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `slope roadmap validate`
- `node dist/cli/index.js commit-ready`
- `node dist/cli/index.js map --check`

## Learning

Recovery guidance is only useful if the recommended command can change the exact state being checked. For shared concepts like map freshness, one computation beats two nearly equivalent heuristics.

Follow-up: `slope status --sprint=143.5` appears to parse the decimal sprint as S143. That should be raised and triaged before the phase is considered fully clean.
