# SLOPE Monorepo

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Monorepo Structure
- `packages/core` — scoring engine, types, config, metaphor engine, roles, standup protocol, CI signal parser, store interface, loader (v1.5.0)
- `packages/tokens` — shared design tokens (colors, typography, spacing, CSS generation) (v1.5.0)
- `packages/store-sqlite` — SQLite storage adapter (v1.5.0)
- `packages/cli` — CLI tool (init, card, validate, review, report, briefing, plan, session, standup, escalate, hook, guard, extract, distill, map, dashboard, plugin, flows, initiative) (v1.5.0)
- `packages/mcp-tools` — code-mode MCP server (search + execute + session/claim tools) (v1.5.0)

## Commands
- `pnpm build` — build
- `pnpm test` — run all tests (106 files, 1985 tests; PG store skipped without env var)
- `pnpm typecheck` — type check
- `pnpm test:pg` — run PostgreSQL store tests (requires local PG, see below)

## PostgreSQL Store Tests
The `store-pg` tests require a running PostgreSQL instance. They skip automatically when `SLOPE_TEST_PG_URL` is unset.

**Local (Docker):**
```sh
docker run -d --name slope-pg -e POSTGRES_PASSWORD=slope -e POSTGRES_DB=slope_test -p 5432:5432 postgres:16
pnpm test:pg
```

**CI:** GitHub Actions runs a `postgres:16` service container and sets `SLOPE_TEST_PG_URL` automatically — PG store tests always run in CI.

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

## Initiative Orchestration
Multi-sprint initiatives with structured review gates. Built on top of existing `slope review` system.
- Core: `src/core/initiative.ts` — types, specialist selection, state machine, review checklists
- CLI: `slope initiative create|status|next|advance|review|checklist`
- State: `.slope/initiative.json` (mkdir-based locking via `.slope/.initiative.lock`)
- Phases: `pending → planning → plan_review → executing → scoring → pr_review → complete`
- Review gates: plan gate (architect + auto-selected specialist), PR gate (architect + code)
- Specialist selection: keyword-based (`selectSpecialists()`) — backend, ml-engineer, database, frontend, ux-designer

## Self-Development Loop
Autonomous sprint execution via the `slope loop` CLI command. The loop orchestrates multi-sprint execution with tiered model selection (local Qwen 32B + MiniMax M2.5 API escalation), backlog regeneration, and result tracking.

### slope loop Subcommands

**Execution:**
- `slope loop run [--sprint=ID] [--dry-run]` — Execute a single sprint with tiered model selection (local → escalate on fail)
- `slope loop continuous [--max=N] [--pause=S] [--dry-run]` — Run sprints in a loop, regenerating backlog when exhausted (default: 10 sprints)
- `slope loop parallel [--dry-run]` — Run multiple sprints in parallel using git worktrees with module overlap detection

**Status & Configuration:**
- `slope loop status [--sprint=ID]` — Show current loop state, completed sprints, and next sprint in queue
- `slope loop config [--show] [--set k=v]` — Display or update loop configuration (model tiers, timeouts, escalation rules)
- `slope loop results [--sprint=ID] [--json]` — View sprint results and execution details

**Analysis & Reporting:**
- `slope loop analyze [--regenerate]` — Mine scorecard data and regenerate backlog (runs automatically in continuous mode)
- `slope loop models [--analyze] [--show]` — Show model selection analytics and success rates per tier
- `slope loop guide [--check] [--synthesize]` — Validate agent guide (SKILL.md) word count and content

**Maintenance:**
- `slope loop clean [--results] [--logs] [--worktrees] [--all]` — Clean up loop artifacts (results, logs, git worktrees)

### Model Tier Rules (Loop Context)
- **Putter/Wedge** → local Qwen 32B (fast, free)
- **Short Iron** → local Qwen 32B (default), escalate to M2.5 on failure
- **Long Iron/Driver** → MiniMax M2.5 API (architect-level planning)
- **Multi-file tickets** → always M2.5 regardless of club
- **Local model failure** → auto-escalate to M2.5 before marking as miss

### Loop Infrastructure (Reference)
- `slope-loop/analyze-scorecards.ts` — mines scorecard data → `analysis.json` + `backlog.json`
- `slope-loop/model-selector.ts` — data-driven model tier recommendations → `model-config.json`
- `slope-loop/dashboard.ts` — static HTML dashboard (handicap, model rates, costs, convergence)
- `slope-loop/slope-loop-guide/SKILL.md` — agent guide skill for sprint execution (auto-injected via Aider `--read` flag)

### Guard Hooks in Loop Context
Guard hooks are auto-injected into every automated sprint via Aider's `--read` flag (see SKILL.md). The loop respects guard decisions:
- `branch-before-commit` — blocks commits to main/master
- `version-check` — blocks push when versions not bumped
- `stop-check` — checks for uncommitted/unpushed work before session end
- Other guards provide context nudges and warnings

### Legacy/Fallback (Shell Scripts)
The original shell script runners are deprecated but available as fallback:
- `slope-loop/run.sh` — single sprint runner (legacy)
- `slope-loop/continuous.sh` — loop runner with backlog auto-regeneration (legacy)
- `slope-loop/parallel.sh` — parallel runner with module overlap detection (legacy)

**Note:** Use `slope loop` CLI commands instead of shell scripts. Shell scripts are maintained for backward compatibility but are not the primary interface.

## Key Files
- `.slope/config.json` — SLOPE configuration (includes `metaphor` field)
- `.slope/slope.db` — SQLite store (sessions, claims, scorecards, common issues, events)
- `.slope/common-issues.json` — recurring patterns and gotchas (legacy, migrating to store)
- `.slope/flows.json` — user flow definitions (workflow → code path mappings)
- `.slope/hooks.json` — installed hook registry
- `docs/backlog/README.md` — sprint plan index
