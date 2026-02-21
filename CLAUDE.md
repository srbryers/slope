# SLOPE Monorepo

Sprint Lifecycle & Operational Performance Engine — golf-metaphor sprint scoring.

## Monorepo Structure
- `packages/core` — scoring engine, types, config, loader (v0.4.0)
- `packages/cli` — CLI tool (init, card, validate, review, briefing, plan)
- `packages/mcp-tools` — code-mode MCP server (search + execute)

## Commands
- `pnpm -r build` — build all packages
- `pnpm -r test` — run all tests (core: 275, cli: 22, mcp-tools: 16)
- `pnpm -r typecheck` — type check all packages

## MCP Tools
The SLOPE MCP server is configured in `.mcp.json` (local build).
- `search({})` — discover all API functions
- `execute({ code: "return computeHandicapCard(loadScorecards())" })`

Requires `pnpm -r build` before first use.

## Sprint Workflow
This repo uses SLOPE to score its own sprints:
- Scorecards: `docs/retros/sprint-N.json`
- Plans: `docs/backlog/sprint-N-plan.md`
- Post-Hole: validate scorecard, generate review, update common-issues

## Conventions
- `workspace:*` protocol for intra-monorepo deps
- Conventional commits (feat/fix/chore)
- Always run full build + test + typecheck before committing
- Core package needs `@types/node` for `node:` module imports

## Key Files
- `.slope/config.json` — SLOPE configuration
- `.slope/common-issues.json` — recurring patterns and gotchas
- `docs/backlog/README.md` — sprint plan index
