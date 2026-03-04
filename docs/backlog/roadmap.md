# SLOPE Roadmap

> 55 scorecards filed (S1-S58, with gaps). 10 numbered phases + 3 internal sprint groups.
> Last updated: 2026-03-04 (v1.17.0)

## Phase Summary

| # | Phase | Sprints | Status | Key Deliverable |
|---|-------|---------|--------|-----------------|
| 0 | Foundation | S1-S6 | **Complete** | Core scoring engine, SQLite store, CLI, MCP tools |
| 1 | Course Strategy & Reach | S7-S10 | **Complete** | Roadmap tooling, metaphor engine, cross-platform, signal intelligence |
| 2 | Telemetry & Guidance | S11-S13 | **Complete** | Session telemetry, agent guidance hooks, HTML reports |
| 3 | Multi-Agent Orchestration | S14-S15 | **Complete** | Roles, standup protocol, swarm sessions, team scoring |
| — | Vision Refresh | S16 | **Complete** | Phase 4 roadmap planning |
| 4 | Extensibility & Dashboard | S17-S20 | **Complete** | Plugin system, PR signals, local dashboard, multi-developer |
| — | Internal Tooling | S21-S26 | **Complete** | Guards, maps, scoring improvements, flow tracking |
| — | Go-to-Market | S27-S29 | **Complete** | Design tokens, marketing site, publishing |
| 5 | Smart Onboarding | S30-S33 | **Complete** | Repo analyzers, generators, GitHub integration, recommendations |
| 6 | Harness-Agnostic Guards | S34-S36 | **Complete** | Adapter interface, Claude/Cursor/Windsurf/Cline adapters |
| 7 | Hardening & Adoption | S37-S40 | **Complete** | PG store GA, adapter enrichment, onboarding docs |
| 8 | Metaphor Studio | S41-S42 | **Complete** | Visual metaphor builder, interactive onboarding interview |
| 9 | Self-Development Loop | S43-S58 | **Complete** | Autonomous sprint execution, `slope loop` CLI |
| 10 | Loop Quality | — | **Active** | Prompt engineering, context budgets, parallelism |

---

## Completed Phases (S1-S58)

### Phase 0: Foundation (S1-S6)
Core scoring engine with pluggable metaphors, SQLite store, CLI tooling (init, card, validate, review, report, briefing, plan, session), MCP server with search + execute.

### Phase 1: Course Strategy & Reach (S7-S10)
- **S7 — The Yardage Book:** Roadmap format, validation, review, briefing integration
- **S8 — The Rosetta Stone:** Metaphor engine (golf, tennis, baseball, gaming, D&D, matrix)
- **S9 — Cross-Platform:** Cursor + OpenCode support, metaphor-aware templates
- **S10 — Signal Intelligence:** Events table, CI signal parser, improved shot classification

### Phase 2: Telemetry & Guidance (S11-S13)
- **S11 — The Transcript:** Session hooks, event-to-common-issues pipeline
- **S12 — The Caddy:** Agent guidance hooks (explore, hazard, commit-nudge, scope-drift)
- **S13 — The Clubhouse:** Static HTML reports, documentation, launch prep

### Phase 3: Multi-Agent Orchestration (S14-S15)
- **S14 — The Foursome:** Role definitions, communication protocol, swarm sessions
- **S15 — The Leaderboard:** Team scoring, escalation rules, CaddyStack integration surface

### Phase 4: Extensibility & Dashboard (S17-S20)
- **S17 — The Plugin System:** Pluggable metaphor loaders, custom guard plugins
- **S18 — PR Signals:** PR-as-scorecard, review-based shot classification
- **S19 — The Dashboard:** Local HTML dashboard with trends, heatmaps, timelines
- **S20 — Multi-Developer:** Per-player handicaps, shared hazards, team leaderboard

### Internal Tooling (S21-S26)
Guards, codebase maps, scoring refinements, flow tracking, review state management.

### Go-to-Market (S27-S29)
Design tokens package, marketing site, npm publishing.

### Phase 5: Smart Onboarding (S30-S33)
- **S30 — The Surveyor:** Repo analyzers (stack, structure, git, testing), vision document
- **S31 — The Course Designer:** Complexity estimator, config/sprint/common-issues generators
- **S32 — The Scout:** GitHub analyzers, roadmap generator from milestones
- **S33 — The Caddy's Notebook:** Vision drift detection, sprint recommendations

### Phase 6: Harness-Agnostic Guards (S34-S36)
- **S34 — The Universal Caddy:** HarnessAdapter interface, Claude Code + generic adapters
- **S35 — The Equipment Room:** Cursor, Windsurf, Cline adapter research + implementation
- **S36 — The Clubhouse Bridge:** CaddyStack harness integration

### Phase 7: Hardening & Adoption (S37-S40)
- **S37 — The Adapter Interface:** Enriched adapter with supportedEvents + hooksConfigPath
- **S38 — The Vault:** PostgreSQL store GA, migrations, health checks, backup/restore
- **S39 — The Open Field:** Cline + Continue adapters
- **S40 — The Welcome Mat:** Enhanced onboarding, getting-started guide, tutorials

### Phase 8: Metaphor Studio (S41-S42)
- **S41 — The Metaphor Studio:** Visual metaphor builder
- **S42 — The Caddy Interview:** Interactive onboarding interview

### Phase 9: Self-Development Loop (S43-S58)
Autonomous sprint execution system — originally shell scripts, rewritten as TypeScript `slope loop` CLI (v1.16.0-v1.17.0).

- **S43-S47:** Loop foundation — shell scripts for run/continuous/parallel, model selection, analyze pipeline
- **S48-S53:** TypeScript rewrite — `slope loop` CLI with config, backlog, executor, guards, PR lifecycle
- **S54-S58:** Hardening — structured prompts, substantiveness guard, test file filtering, stale ref pruning

**Delivered:**
- `slope loop run` — single sprint execution with worktree isolation
- `slope loop continuous` — multi-sprint loop with backlog auto-regeneration
- `slope loop parallel` — dual-sprint execution with module overlap detection
- `slope loop analyze` — scorecard mining → backlog generation
- Model routing — club-based local/API model selection with data-driven overrides
- Guard system — typecheck + test + substantiveness guards with auto-revert
- PR lifecycle — creation, structural review (5 checks), auto-merge (5 gates)
- Structured prompts — GSD-style target files, checkbox acceptance criteria, model-specific approach
- Substantiveness guard — detects and reverts comment-only/whitespace-only changes
- Actionable ticket descriptions — explicit action instructions in generated backlog

**Stats:** Last sprint: S58. Current handicap: 0.4 (declining). 100% club success rates.

---

## Phase 10: Loop Quality (Active)

Inspired by [Cursor's Scaling Agents](https://cursor.com/blog/scaling-agents) and [GSD](https://github.com/gsd-build/get-shit-done).

### Completed (v1.17.0)
- **Structured prompts** — GSD-style specificity: target files, checkbox acceptance criteria, verification commands, model-specific approach
- **Substantiveness guard** — Detects and reverts comment-only/whitespace-only changes before running typecheck/tests
- **Actionable ticket descriptions** — Backlog generation includes explicit action instructions and requires substantive code changes
- **Test file filter** — `extractFileRefs()` excludes `.test.ts`/`.spec.ts` from hotspot source files

### Next: Medium-Effort, High-Value

#### Roadmap-driven backlog generation
The scorecard-driven analyze pipeline produces diminishing returns once hazard hotspots are resolved (all files pruned, 100% success rates). Add a roadmap-driven backlog source that generates tickets from this roadmap when scorecard data is exhausted.

**Files:** `slope-loop/analyze-scorecards.ts`, `src/cli/loop/backlog.ts`

#### Context budget per ticket
Inject a "you have N tokens, focus on the core change" instruction into the Aider prompt based on club/model. Local models need tighter budgets than API models.

**Files:** `src/cli/loop/executor.ts` (buildPrompt)

#### Planner/executor separation
Instead of one Aider call per ticket, do two: (1) `slope prep` generates a concrete plan with exact files/functions/changes, (2) Aider executes the plan. We already have `slope prep` but it's optional and often fails on missing index.

**Files:** `src/cli/loop/executor.ts` (processTicket), `src/core/prep.ts`

#### Analysis paralysis timeout
If Aider produces no file changes within the first 50% of the timeout, kill early and escalate rather than waiting for the full timeout. Saves 15+ minutes per stuck ticket.

**Files:** `src/cli/loop/executor.ts` (runAider)

### Later: Longer-Term

#### Context monitoring hook
GSD's approach: a PostToolUse hook tracks remaining context and injects warnings at 35%/25% thresholds. Could adapt for our guard system to warn agents about context pressure during Aider execution.

**Files:** new `src/cli/guards/context-monitor.ts`, hook registration

#### Wave-based parallelism
Replace binary overlap detection (overlap → sequential fallback) with dependency graphs across tickets. Tickets with no shared modules run in parallel waves, maximizing throughput.

**Files:** `src/cli/loop/parallel.ts`

#### Planner/worker hierarchy (Cursor pattern)
Separate planning from execution into distinct agent roles with different models. Planner generates detailed task specs, workers execute them. Different models may excel at each role.

**Files:** new architecture — would require significant refactor of executor.ts

---

## Architecture Reference

### Key Files
| Area | Files |
|------|-------|
| Loop CLI | `src/cli/loop/` (executor, guards, backlog, config, worktree, PR lifecycle) |
| Loop Scripts | `slope-loop/` (analyze-scorecards, model-selector, dashboard) |
| Core | `src/core/` (scoring, metaphors, flows, initiative, roles, signals) |
| CLI | `src/cli/` (38 commands) |
| Guards | 17 built-in guards + adapter framework |
| MCP | `packages/mcp-tools/` (search + execute + session/claim tools) |
| Store | `packages/store-sqlite/`, `packages/store-pg/` |

### Machine-Readable Roadmap
`docs/backlog/roadmap.json` — Consumed by `slope roadmap validate|review|status|show`. Covers S1-S47 (phases 0-9); Phase 10 and S48+ not yet added.
