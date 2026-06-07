# Sprint 143.8 Review: Decimal Sprint Currency Formatting

## Outcome

S143.8 closes #513 by formatting decimal sprint currency output without JavaScript floating-point artifacts.

- `map.ts` now parses the current sprint through the shared roadmap sprint parser.
- Current sprint labels, map sprint labels, and currency deltas now use the shared sprint formatter.
- A spawned map-check regression covers the 143.6 vs 143 case and asserts the raw floating-point artifact is absent.
- Branch-built smoke checks confirmed `slope map --check` prints a clean decimal delta.

## Review

Architect review: recommended, complete. The fix keeps sprint ordering semantics untouched and limits the change to parsing/formatting at the user-visible output boundary.

Code review: optional, complete. The regression constructs the exact stale-map metadata shape and checks the CLI text that previously leaked `0.599999`.

No implementation findings were left open.

## Validation

- `corepack pnpm vitest run tests/cli/commands/map.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm prepare`
- `node dist/cli/index.js map --check`
- `corepack pnpm test`

## Learning

Decimal sprint ids are first-class roadmap ids, so CLI output should avoid direct floating-point printing whenever sprint ids are subtracted. The same validation pass exposed #515, a Windows atomic-write lock contention flake, which is now planned as S143.95.
