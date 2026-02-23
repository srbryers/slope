# SLOPE Monorepo

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Monorepo Structure
- `packages/core` — scoring engine, types, config, metaphor engine, roles, standup protocol, CI signal parser, store interface, loader (v1.5.0)
- `packages/store-sqlite` — SQLite storage adapter (v1.5.0)
- `packages/cli` — CLI tool (init, card, validate, review, report, briefing, plan, session, standup, escalate, hook, guard, extract, distill, map, dashboard, plugin, flows) (v1.5.0)
- `packages/mcp-tools` — code-mode MCP server (search + execute + session/claim tools) (v1.5.0)

## Commands
- `pnpm -r build` — build all packages
- `pnpm -r test` — run all tests (core: 780, store-sqlite: 36, cli: 190, mcp-tools: 65)
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

## Metaphor System
SLOPE uses a pluggable metaphor engine for display output. Internal types remain golf-derived; metaphors are display-only.
- Config: `"metaphor": "golf"` in `.slope/config.json` (default: golf)
- Available: golf, tennis, baseball, gaming, dnd, matrix
- CLI: `--metaphor=<id>` flag on card, review, briefing commands
- Init: `slope init --metaphor=gaming` sets metaphor in config
- Core: `packages/core/src/metaphor.ts` (registry + types), `packages/core/src/metaphors/` (definitions)
- Fallback chain: CLI flag → config.metaphor → golf default

## Flow Tracking
SLOPE maps user-facing workflows (OAuth, checkout, onboarding) to code paths for agent navigation.
- Config: `"flowsPath": ".slope/flows.json"` in `.slope/config.json` (default)
- CLI: `slope flows init` (create template), `slope flows list` (show all), `slope flows check` (validate + staleness)
- MCP: `search({ module: 'flows' })` returns all flows, `search({ module: 'flows', query: 'oauth' })` filters by id/title/tags
- Core: `packages/core/src/flows.ts` (types + validation), exported from `packages/core/src/index.ts`
- Guard: `stale-flows` warns when editing files belonging to a stale flow definition

## Key Files
- `.slope/config.json` — SLOPE configuration (includes `metaphor` field)
- `.slope/slope.db` — SQLite store (sessions, claims, scorecards, common issues, events)
- `.slope/common-issues.json` — recurring patterns and gotchas (legacy, migrating to store)
- `.slope/flows.json` — user flow definitions (workflow → code path mappings)
- `.slope/hooks.json` — installed hook registry
- `docs/backlog/README.md` — sprint plan index
