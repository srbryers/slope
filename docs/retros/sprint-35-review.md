
## Sprint 35 Review: The Equipment Room

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (4/4) |
| GIR % | 75% (3/4) |
| Putts | 3 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S35-1 | Wedge | In the Hole | — | Created harness-research.md with compatibility matrix, hook config schemas for Cursor/Windsurf/OpenCode, tool name mappings, guard execution flow Mermaid diagram, and adapter authoring guide. 7 sections covering 6 harnesses. |
| S35-2 | Short Iron | In the Hole | — | Added ADAPTER_PRIORITY constant for deterministic detection (claude-code > cursor > windsurf > generic). CursorAdapter with JSON stdin/stdout protocol, .cursor/hooks.json config gen, Cursor-specific tool names, dispatcher script. 28 tests (24 adapter + 4 priority). |
| S35-3 | Short Iron | Green | Rough: Dispatcher grep pattern initially used literal JSON format — wouldn't match prettified output with spaces around colons. Fixed in review.; Rough: 2>/dev/null on slope guard stderr swallowed errors silently. Fixed to use SLOPE_GUARD_LOG env var. | WindsurfAdapter with JSON formatting, exit-code dispatcher script (exit 0=allow, exit 2=block), .windsurf/hooks.json config gen, guards manifest. Documented no-context-injection limitation. 25 tests. Two review findings caught and fixed. |
| S35-4 | Wedge | In the Hole | — | Updated CODEBASE.md via slope map. Compatibility matrix and authoring guide were already in the research doc from S35-1. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Rough | S35-3 | Dispatcher grep pattern initially used literal JSON format — wouldn't match prettified output with spaces around colons. Fixed in review. |
| Rough | S35-3 | 2>/dev/null on slope guard stderr swallowed errors silently. Fixed to use SLOPE_GUARD_LOG env var. |

**Known hazards for future sprints:**
- Windsurf dispatcher grep must handle prettified JSON — use [[:space:]]* not literal format
- Windsurf can't inject context — guards that rely on additionalContext are allow-only on Windsurf
- Stale parallel detection systems: if you add a new harness, update resolveHarnessId/getHooksDir in hook.ts too, not just the adapter
- HOOK_EVENT_MAP filtering silently drops unsupported events (PreCompact, Stop on Windsurf) — test for exclusion explicitly

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | Full build + test after every ticket and after review fixes. 1668 tests passing at completion, 0 failing. |
| Diet | healthy | 7 commits: 4 feature + 3 review fix commits. All pushed before merge. |
| Supplements | healthy | 83 new tests across 3 test files (cursor adapter: 26, windsurf adapter: 26, harness: 31 including 5 integration + 2 registration completeness). 1668 total, up from 1637. |
| Recovery | healthy | Review process caught stale Provider type in hook.ts (HIGH) and fragile grep pattern in Windsurf dispatcher (HIGH). Both fixed before merge. Review pays for itself. |

### Course Management Notes

- 4 tickets, par 4, score 4 — par. 3 in_the_hole, 1 green (Windsurf had 2 rough hazards caught in review).
- Slope 3 — external API research done in pre-sprint, new adapter classes following established patterns.
- 1352 lines added, 34 removed across 10 files. 3 new source files, 2 new test files, 1 new doc.
- Both-tier review (code + architect) caught 12 findings total, all addressed before merge.

### 19th Hole

- **How did it feel?** Smooth sprint building on the S34 adapter framework. CursorAdapter was clean — same JSON protocol, just different tool names and config format. WindsurfAdapter was trickier due to the exit-code translation layer, which is where both HIGH review findings came from.
- **Advice for next player?** The Windsurf dispatcher uses shell grep to parse JSON — test with both compact and prettified output. Use [[:space:]]* for optional whitespace. Always check slope guard exit code before parsing output. Set SLOPE_GUARD_LOG=/tmp/slope-guard.log for debugging.
- **What surprised you?** The stale Provider type in hook.ts was a real bug — Windsurf users running lifecycle hooks (slope hook add session-start) would have had their hooks installed to .claude/hooks/ instead of .windsurf/hooks/. Architect review caught it.
- **Excited about next?** The adapter framework now covers Claude Code, Cursor, and Windsurf with a documented authoring guide. Any new harness with hook support is just a new adapter file.

