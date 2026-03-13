# SLOPE Project

This project uses the SLOPE framework for sprint tracking.

## Commands
- `slope card` — view handicap card
- `slope validate` — validate scorecards
- `slope review` — generate sprint review
- `slope briefing` — pre-round briefing

## MCP Tools
A SLOPE MCP server is configured in `opencode.json`. Two tools:
- `search` — discover API functions, types, constants
- `execute` — run JS with full SLOPE API in sandbox

## Sprint Workflow
- **Pre-Hole:** `slope briefing` for handicap, hazards, gotchas
- **Per-Shot:** classify each ticket with approach + result + hazards
- **Post-Hole:** `slope validate` scorecard, `slope review`, update common-issues

## Approach Complexity
- Driver: risky/new territory
- Long Iron: multi-package changes
- Short Iron: standard work
- Wedge: small tasks
- Putter: trivial changes

## Shot Results
- In the Hole: perfect execution
- Green: landed correctly
- Fairway: clean start, needs finishing
- Miss directions: over-scoped, under-scoped, wrong approach, drift

## Commit Discipline
- Commit after each file, feature, migration, or bug fix
- Push after each ticket and every 30 minutes
- Format: `<type>(<ticket>): <summary>` (feat/fix/refactor/docs/test/chore)

## Codebase Map

SLOPE maintains a codebase map at `CODEBASE.md` (~5k tokens). Read it before exploring.
- Run `slope map` to generate/update
- Run `slope map --check` to verify staleness
- Use `search({ module: 'map' })` via MCP for targeted queries

## Scorecards
Stored in docs/retros/sprint-N.json. See .slope/config.json for configuration.
