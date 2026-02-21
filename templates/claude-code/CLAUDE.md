# SLOPE Project

This project uses the SLOPE framework for sprint tracking.

## Commands
- `slope card` — view handicap card
- `slope validate` — validate scorecards
- `slope review` — generate sprint review
- `slope briefing` — pre-round briefing

## MCP Tools
A SLOPE MCP server is configured in `.mcp.json`. Two tools:
- `search` — discover API functions, types, constants
- `execute` — run JS with full SLOPE API in sandbox

## Sprint Workflow
- **Pre-Round:** `slope briefing` for handicap, hazards, gotchas
- **Per-Shot:** classify each ticket with club + result + hazards
- **Post-Hole:** `slope validate` scorecard, `slope review`, update common-issues

See .claude/rules/ for detailed checklists.

## Scorecards
Stored in docs/retros/sprint-N.json. See .slope/config.json for configuration.
