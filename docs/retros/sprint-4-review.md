## Sprint 4 Review: Code Mode MCP Refactor

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S4-1 | long_iron | in_the_hole | rough: core missing @types/node — required adding devDep | Clean copy; CLI re-exports preserve API. Added @types/node to core. |
| S4-2 | short_iron | in_the_hole | — | 33-entry SLOPE_REGISTRY + SLOPE_TYPES constant; search tool with query/module filtering |
| S4-3 | driver | in_the_hole | rough: mcp-tools resolved published core v0.3.3 instead of workspace — switched to workspace:* protocol | node:vm sandbox with full core API, path-scoped fs, 30s timeout, console capture |
| S4-4 | short_iron | in_the_hole | — | Server now exposes exactly 2 tools; 16 new tests all pass; README rewritten for code-mode pattern |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| wind | minor | cross_package refactor (CLI → core) |
| altitude | minor | new_area: node:vm sandbox |
| wind | minor | external_dep: workspace protocol resolution |

### Hazards Discovered (Bunker Locations)

| Type | Ticket | Description |
|---|---|---|
| rough | S4-1 | core missing @types/node — required adding devDep |
| rough | S4-3 | mcp-tools resolved published core v0.3.3 instead of workspace — switched to workspace:* protocol |

### Course Management Notes

- Code-mode MCP pattern: 2 tools (search + execute) replace N individual tools
- Path-scope all fs helpers with safePath() — resolve then check startsWith(cwd)
