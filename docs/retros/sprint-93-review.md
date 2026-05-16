# Sprint 93 Review: Codex Hook Recovery

## SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 2 |
| Score | 5 |
| Label | Bogey |
| Fairway % | 100% (5/5) |
| GIR % | 80% (4/5) |
| Putts | 0 |
| Penalties | 0 |

## Shot-by-Shot

| Ticket | Club | Result | Notes |
|---|---|---|---|
| S93-1 | Short Iron | Green | Recovered Codex hook shape and user-level install path. |
| S93-2 | Short Iron | Green | Fixed recovery failures: no `__batch` dependency, EnterWorktree pass-through, dev-repo dispatcher fallback. |
| S93-3 | Wedge | In the Hole | Corrected Codex install count reporting to show `30 of 31` and mark PreCompact unsupported. |
| S93-4 | Short Iron | Green | Resolved Codex `apply_patch` and MCP search matchers from tool categories. |
| S93-5 | Wedge | Fairway | Verified global hooks after restart and checked Fathoms for duplicate local Codex hooks. |

## Review Findings

- Code review found a real gap: Codex edit guards still used raw `Edit|Write` matchers. Fixed by resolving matchers through the Codex adapter's tool map.
- Follow-up verification found a second matcher issue in combined MCP search patterns. Fixed by expanding Codex search matchers before category resolution.
- Architecturally, global user-level Codex hooks are the right runtime path until plugin hooks are reliable. Project-local `.codex` hooks should be removed where present to avoid duplicate firing.

## Verification

- `pnpm vitest run tests/core/adapters/codex.test.ts tests/cli/commands/hook-codex.test.ts`
- `pnpm run build`
- `python3 -m json.tool ~/.codex/hooks.json`
- `bash -n ~/.codex/hooks/slope-guard.sh`
- Global hook smoke tests through `~/.codex/hooks/slope-guard.sh`
- Confirmed `.slope/guard-metrics.jsonl` receives fresh entries after Codex restart.
- Confirmed Fathoms has no project-local `.codex` hooks.

## Release Notes

- Patch release needed so repos with project-local `@slope-dev/slope` binaries receive the runtime fixes.
- Fathoms currently resolves `@slope-dev/slope@1.55.3`; update after the new package release.
