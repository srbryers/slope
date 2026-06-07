# Sprint 137.5 Review: Windows Test Suite Portability

## Outcome

S137.5 closed the #509 failure class. The Windows full suite now passes locally:

- `corepack pnpm test`: 228 test files passed, 1 skipped; 3596 tests passed, 25 skipped.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm prepare`: passed.
- `slope roadmap validate`: valid, with existing roadmap warnings.

## What Changed

- Normalized repo-path outputs to POSIX while keeping filesystem assertions native.
- Replaced path-containment string-prefix checks with resolved relative-path containment.
- Gated POSIX executable-bit assertions on non-Windows platforms.
- Replaced affected `2>/dev/null` git probes with child-process `stdio` options.
- Replaced shell `grep` fallback in MCP context search with a Node fixed-string scanner.
- Closed cached SQLite memory backends before Windows temp-directory cleanup.
- Reduced or widened Windows-sensitive timing fixtures.

## Learnings

- Treat repo paths and local filesystem paths as separate contracts.
- Test helpers should use `dirname`, `join`, `resolve`, and `isAbsolute`, never slash slicing.
- Dist-backed CLI tests need a fresh `corepack pnpm prepare`.
- Windows process spawn cost can turn large synthetic git fixtures into accidental timing tests.

## Follow-Up

The suite still prints legacy stderr noise from some negative git/temp-repo probes. That noise is non-blocking after S137.5, but it is a good cleanup candidate if Windows output readability becomes a priority.
