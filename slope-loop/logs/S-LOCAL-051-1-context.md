## docs/tutorial-first-sprint.md (score: 0.574)
```
| `hazard_penalties`    | number | Hazards that added to score      |
| `miss_directions`     | object | `{ long, short, left, right }`   |

### Condition Types

| Type         | Meaning                            |
|--------------|------------------------------------|
| `wind`       | External service issues            |
| `rain`       | Team/process disruptions           |
| `firm`       | Tight deadlines                    |
| `soft`       | Relaxed timeline                   |

### Special Play Types

| Type          | Meaning                              |
|---------------|--------------------------------------|
| `mulligan`    | Approach scrapped, restarted         |
| `gimme`       | Trivial fix accepted without process |
| `provisional` | Parallel approach tried              |

```

## docs/backlog/roadmap.md (score: 0.556)
```
- **Explore guard** (`slope guard explore`): fires before explore/search tool calls
  - Checks for codebase index presence (`.slope/index.json`, `CODEBASE.md`, or configurable paths)
  - When index exists: injects hint ("Codebase index available at X — check it before deep exploration")
  - When no index: passes through silently
  - Configurable index paths in `.slope/config.json` under `"guidance.indexPaths"`
- **Hazard warning** (`slope guard hazard`): fires before file write/edit tool calls
  - Extracts target file path from tool input
  - Looks up the file's area in common issues and recent events (from S10/S11)
  - When hazards exist: injects context ("Known issue in this area: <description>. Last seen in S10.")
  - Respects recency window (configurable, default last 5 sprints)
- Both hooks are non-blocking — guidance, not enforcement
- Tests: index detection, hazard lookup by file path, hint injection, passthrough when clean

##### S12-3: Discipline hooks — commit nudge + scope drift
- **Club:** short_iron | **Complexity:** standard
- **Commit discipline nudge** (`slope guard commit-nudge`): fires periodically or on PostToolUse
  - Checks `git log` for time since last commit
  - When >15 minutes since last commit and there are uncommitted changes: nudges "~15 minutes since last commit — consider committing current progress"
  - When >30 minutes since last push: nudges about push cadence
  - Thresholds configurable in `.slope/config.json` under `"guidance.commitInterval"` and `"guidance.pushInterval"`
- **Scope drift detection** (`slope guard scope-drift`): fires before file write/edit
  - Reads current ticket's claimed scope from the claims table (files/areas)
  - When the agent modifies a file outside claimed scope: warns "This file is outside the scope of the current ticket (<ticket-key>). Intentional?"
  - Requires an active session with a ticket claim to function; silent otherwise
- Tests: time-since-commit calculation, scope matching against claims, configurable thresholds

##### S12-4: Session hooks — compaction checkpoint + next-work
- **Club:** short_iron | **Complexity:** standard
- **Context compaction checkpoint** (`slope guard compaction`): fires when the agent compresses context (Claude Code's `Notification` hook or similar signal)
  - Auto-extracts structured events from the session up to the compaction point
  - Writes events to SQLite via `insertEvent()` — a natural extraction checkpoint
  - Summarizes what was captured: "Extracted 3 events (2 failures, 1 decision) before compaction"
  - Uses the event types and pipeline from S10/S11
- **Next-work suggestions** (`slope guard next-work`): fires on session end or ticket completion
  - Reads current sprint plan and claims table
  - Surfaces: next unclaimed ticket, newly unblocked tickets, unresolved hazards from this session
  - Also available standalone: `slope next --sprint=N` (enhances existing `slope next`)
- Tests: event extraction on compaction trigger, next-work plan parsing, claim status lookup

#### Execution Order

```
S12-1 → S12-2
S12-1 → S12-3
S12-1 → S12-4
```

S12-1 (framework) must land first — defines the guard contract and hook generation. S12-2 (PreToolUse guards), S12-3 (discipline hooks), and S12-4 (session hooks) are all independently parallel after S12-1.

**Fallback plan:** If the S12-1 research spike reveals that Claude Code's PreToolUse/PostToolUse API does not support the assumed contract (tool name matching, JSON response injection), degrade to periodic polling: commit-nudge checks git log on an interval via session hooks, scope-drift checks on PostToolUse instead of PreToolUse, explore guard becomes a briefing hint rather than a real-time intercept. The guard framework remains; the trigger mechanism adapts.

---

### Sprint 13 — The Clubhouse

**Par:** 4 | **Slope:** 2 (`moderate: HTML/SVG chart generation from scratch, no existing visualization infrastructure`) | **Type:** polish + launch

**Theme:** Static HTML reports, documentation polish, and launch preparation. The goal is a complete, documented, multi-platform package ready for community adoption. S13 is the join point where both parallel tracks (presentation: S8→S9, signals/guidance: S10→S11→S12) converge before Phase 3.

#### Tickets

##### S13-1: Static HTML report generation
- **Club:** short_iron | **Complexity:** standard
- `slope report --html` generates a self-contained HTML file with:
  - Handicap trend chart (last N sprints)
  - Dispersion visualization (miss patterns)
  - Area performance breakdown
  - Nutrition trends
- Uses embedded SVG/Canvas — no external dependencies, no server
- Output file: `.slope/reports/report-<date>.html`
- Tests: HTML generation, data embedding, file output

##### S13-2: Report metaphor awareness
- **Club:** wedge | **Complexity:** small
- HTML reports use configured metaphor terms throughout (requires metaphor engine from S8 — transitive via S9 dependency)
- Chart labels, section headings, and terminology adapt to the active metaphor
- Tests: report with golf metaphor vs gaming metaphor produces different labels

##### S13-3: Documentation + README overhaul
- **Club:** short_iron | **Complexity:** standard
- Update root README with:
  - Multi-platform setup (Claude Code, Cursor, OpenCode)
  - Metaphor showcase (examples in 2-3 metaphors)
  - Quick start guide for each platform
  - Feature matrix showing what works where
- Update each package README with current API surface
- Ensure all CLI commands have `--help` text that matches docs

##### S13-4: Launch checklist + version bump
- **Club:** wedge | **Complexity:** small
- Pre-launch checklist:
  - All tests pass across all packages
  - All platforms tested (Claude Code, Cursor, OpenCode)
  - `slope init` works for each platform with each metaphor
  - npm packages published and installable
  - README, vision doc, and roadmap are current
- Version bump to v1.1.0 (metaphors + platforms) or v2.0.0 (if breaking changes were needed)
- Tag release, update changelog

#### Execution Order

```
S13-1 → S13-2 ─┐
                ├→ S13-4
S13-3 ──────────┘
```

S13-1 (HTML reports) before S13-2 (metaphor awareness for reports). S13-3 (docs) is independent. S13-4 (launch) is the final gate after everything else.

---

## Phase 3 — Multi-Agent Orchestration

With Phases 1-2 complete, SLOPE is a full single-agent methodology framework. Phase 3 extends SLOPE to own multi-agent orchestration primitives — the roles, communication protocol, and team scoring that currently live in Caddystack. After Phase 3, Caddystack becomes a pure UI/mobile layer that consumes SLOPE's orchestration API.

### Sprint 14 — The Foursome

**Par:** 4 | **Slope:** 2 (`moderate: new type system, DB schema additions, cross-session coordination`) | **Type:** architecture + feature

**Theme:** Multi-agent primitives — role definitions, a standardized communication protocol, and swarm session management. One sprint, multiple agents, each following the SLOPE methodology with role-appropriate context.

#### Tickets

##### S14-1: Role definition types + registry
- **Club:** short_iron | **Complexity:** standard
- Create `packages/core/src/roles.ts` with `RoleDefinition` interface
  - Fields: `id`, `name`, `description`, `focusAreas` (file patterns this role owns), `clubPreferences` (default club selections by task type), `briefingFilter` (which briefing sections to emphasize)
  - Built-in roles: `backend`, `frontend`, `architect`, `devops`, `generalist` (default)
- Create `packages/core/src/roles/` directory with one file per built-in role
- Export `getRole(id: string): RoleDefinition`, `listRoles(): RoleDefinition[]`
- Custom roles via `.slope/roles/` directory (JSON files matching the interface)
- **Naming collision:** `SlopeSession.role` already exists as `'primary' | 'secondary' | 'observer'` (session priority). The new agent specialization concept must use a different field name — `agent_role` on the session type and `--agent-role` CLI flag. `slope session start --agent-role=backend`
- `agent_role` column added to sessions table via ALTER TABLE migration (uses the versioned migration framework from S10-1) — same pattern as `swarm_id` in S14-4
- `roles` table in SQLite store for persistence and querying (also via migration framework)
- Tests: role registry lookup, custom role loading, session-agent_role association

##### S14-2: Role-based context injection
- **Club:** short_iron | **Complexity:** standard
- `slope briefing` adapts output based on the active session's role:
  - Backend role: emphasizes API hazards, DB patterns, test coverage
  - Frontend role: emphasizes component patterns, accessibility, bundle size
  - Architect role: emphasizes cross-package dependencies, API surface, tech debt
- Role's `focusAreas` filter which common issues and hazards appear in the briefing
- Role's `clubPreferences` inform `slope plan` club recommendations
- Guidance hooks (S12) use role context — hazard warnings are more relevant to the role's focus areas
- Tests: briefing output differs by role, hazard filtering by focus area, club recommendation adaptation

##### S14-3: Communication protocol — standup format
- **Club:** short_iron | **Complexity:** standard
- Define a standardized structured format for agent status reports:
  - Fields: `sessionId`, `agent_role`, `ticketKey`, `status` (working/blocked/complete), `progress` (summary), `blockers` (list), `decisions` (list), `handoffs` (files/areas another agent needs to know about)
- `slope standup` CLI command: generates a standup report from the current session's events and claims
- `slope standup --ingest` reads another agent's standup and surfaces relevant handoffs/blockers in the next briefing
- Standup reports stored in the events table as `type: 'standup'`
- Format is platform-agnostic — works across Claude Code, Cursor, OpenCode
- Tests: standup generation from session data, ingestion and handoff detection, round-trip serialization

##### S14-4: Swarm session management
- **Club:** short_iron | **Complexity:** standard
- Extend session management for multi-agent sprints:
  - `slope session start --swarm=<swarm-id>` groups multiple agent sessions under one sprint
  - `slope session list --swarm=<swarm-id>` shows all agents in the swarm with status, agent_role, current ticket
  - Claim conflicts within a swarm auto-escalate (logged as events, surfaced in standups)
- `swarm_id` column added to sessions table via ALTER TABLE migration (uses the versioned migration framework from S10-1). Nullable — solo sessions omit it.
- `slope status --swarm` shows swarm-level overview: agents active, tickets in progress, blockers, recent handoffs
- Heartbeat monitoring extended: if an agent in the swarm goes stale, other agents are notified via their next briefing
- Tests: swarm session grouping, cross-agent claim conflict detection, stale agent notification

#### Execution Order

```
S14-1 → S14-2 ─┐
                ├→ S14-4
S14-1 → S14-3 ─┘
```

S14-1 (roles) must land first — sessions need role association. S14-2 (context injection) and S14-3 (communication) can run in parallel. S14-4 (swarm management) needs roles for swarm member identification and benefits from the communication format.

---

### Sprint 15 — The Leaderboard

**Par:** 4 | **Slope:** 2 (`moderate: aggregation logic, escalation rules, integration surface`) | **Type:** feature + integration

**Theme:** Team-level scoring, escalation rules, and the integration surface that makes Caddystack a thin UI client. After this sprint, SLOPE owns the complete methodology — from individual shot scoring to multi-agent swarm coordination.

#### Tickets

##### S15-1: Multi-agent scorecard aggregation
- **Club:** short_iron | **Complexity:** standard
- Per-agent scoring within a sprint: each agent in a swarm produces shot records tied to their session/role
- `slope auto-card --swarm=<swarm-id>` generates a combined scorecard with per-agent breakdowns
- Scorecard gains optional `agents` field: array of `{ agent_role, sessionId, shots[], score }` per agent
- Aggregate metrics: swarm par, total penalties, coordination overhead (time spent on handoffs/conflicts)
- Backward compatible — solo scorecards (no `agents` field) work exactly as today
- Tests: multi-agent scorecard generation, per-agent breakdown, aggregate metric computation

##### S15-2: Escalation rules
- **Club:** short_iron | **Complexity:** standard
- Define escalation triggers in `.slope/config.json` under `"orchestration.escalation"`:
```

## templates/cursor/rules/slope-commit-discipline.mdc (score: 0.556)
```
---
description: Commit and push discipline for SLOPE-managed sprints
globs:
alwaysApply: true
---

# Commit Discipline

**Commit early, commit often.** The last push is the recovery point.

## Commit triggers:

Commit immediately after ANY of these:
1. Each new file — route, migration, config, component, test
2. Each endpoint or feature implemented
3. Each migration — commit separately
4. Each bug fix — no matter how small
5. Before switching context to a different area
6. Before risky operations — large refactor, dependency upgrade
7. Time check — if ~15 minutes since last commit, commit what works
8. Session end — never leave uncommitted changes (use `wip:` prefix if incomplete)

## Push triggers:

Push immediately after ANY of these:
1. After each completed ticket (Post-Shot Routine)
2. Every 30 minutes
3. Before switching tickets
4. Session end — never leave unpushed commits

## Commit message format:

```
<type>(<ticket>): <short summary in imperative mood>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `wip`

```

## docs/getting-started.md (score: 0.555)
```
slope session start                     # Start a tracked session
slope claim --target=S5-1              # Claim a ticket
slope status                            # View sprint status and conflicts
slope release --target=<ticket>          # Release a claim when done
slope session end                       # End the session
```

### After a Sprint

```bash
slope validate docs/retros/sprint-5.json  # Validate scorecard
slope review docs/retros/sprint-5.json    # Generate sprint review
slope distill                             # Promote patterns to common issues
slope card                                # View updated handicap card
slope report --html                       # Generate HTML performance report
```

## Filing a Scorecard

Scorecards are JSON files in `docs/retros/`. Here's a minimal example:

```json
{
  "sprint_number": 5,
  "theme": "User Authentication",
  "par": 4,
  "slope": 1,
  "score": 4,
  "score_label": "par",
  "date": "2026-02-28",
  "shots": [
    {
      "ticket_key": "S5-1",
      "title": "Add login endpoint",
      "club": "short_iron",
      "result": "green",
      "hazards": []
    },
    {
      "ticket_key": "S5-2",
      "title": "OAuth integration",
      "club": "long_iron",
      "result": "green",
      "hazards": [{ "type": "bunker", "description": "OAuth provider docs outdated" }]
    },
    {
      "ticket_key": "S5-3",
      "title": "Session management",
      "club": "short_iron",
      "result": "in_the_hole",
      "hazards": []
    }
  ],
  "conditions": [],
  "special_plays": [],
  "stats": {
    "fairways_hit": 3,
    "fairways_total": 3,
    "greens_in_regulation": 3,
    "greens_total": 3,
    "putts": 0,
    "penalties": 0,
    "hazards_hit": 1,
    "hazard_penalties": 0,
    "miss_directions": { "long": 0, "short": 0, "left": 0, "right": 0 }
  },
  "yardage_book_updates": [],
  "bunker_locations": ["OAuth provider documentation was incorrect"],
  "course_management_notes": ["OAuth took longer than expected but landed clean"]
}
```

Validate with:

```bash
slope validate docs/retros/sprint-5.json
```

## Guard Hooks

SLOPE can guide AI agents in real-time via guard hooks. Guards inject contextual hints — they never block actions (except `stop-check` which warns about uncommitted work).

```bash
# Install all guards
slope hook add --level=full

# List installed hooks
slope hook list

# Enable/disable specific guards
slope guard enable hazard
slope guard disable scope-drift
```

Key guards:
- **explore** — suggests checking the codebase map before deep exploration
- **hazard** — warns about known issues in files being edited
- **commit-nudge** — nudges to commit after prolonged editing
- **scope-drift** — warns when editing outside claimed scope
- **stop-check** — checks for uncommitted work before session end

## Metaphors

SLOPE ships with 7 built-in metaphors. The scoring math is identical — only the display terminology changes.

| Metaphor       | Sprint     | Ticket    | Perfect     | On Target |
|----------------|------------|-----------|-------------|-----------|
| **Golf** (default) | Sprint | Shot      | Hole-in-One | Par       |
| **Tennis**     | Set        | Point     | Ace         | Deuce     |
| **Baseball**   | Inning     | At-Bat    | Home Run    | Single    |
| **Gaming**     | Level      | Quest     | S-Rank      | B-Rank    |
| **D&D**        | Quest      | Encounter | Natural 20  | DC Met    |
| **Matrix**     | Simulation | Anomaly   | The One     | Stable    |
| **Agile**      | Sprint     | Story     | Shipped     | Accepted  |

Switch metaphors:

```bash
# Per-command
slope card --metaphor=gaming
slope review --metaphor=tennis

# Permanent (in config)
# Set "metaphor": "gaming" in .slope/config.json

# During init
slope init --metaphor=gaming
```

## Troubleshooting

### "command not found: slope"

SLOPE isn't in your PATH. Either:
- Install globally: `npm install -g @slope-dev/slope`
- Use npx: `npx slope card`

### "No platform detected"

Run `slope init` with an explicit flag:
```bash
slope init --claude-code   # or --cursor, --windsurf, --cline, --opencode
```

### MCP server not loading

- **Claude Code:** Restart Claude Code after init. Check `.mcp.json` exists.
- **Cursor:** Check `.cursor/mcp.json` exists. Restart Cursor.
- **Cline:** MCP must be added manually via Cline settings in VS Code.
- **OpenCode:** Check `opencode.json` has a `mcp.slope` entry.

### "No scorecards found"

SLOPE looks for scorecards in `docs/retros/sprint-*.json` by default. Check:
- The directory exists: `ls docs/retros/`
- Files match the pattern: `sprint-1.json`, `sprint-2.json`, etc.
- Config points to the right location: check `scorecardDir` in `.slope/config.json`

### Validation errors

Run `slope validate <path>` for detailed error messages. Common issues:
- Missing required fields (`sprint_number`, `par`, `score`, `shots`)
- Shot `result` not a valid enum value
- `score_label` doesn't match computed score vs par

## Next Steps

- [Tutorial: Your First Sprint](tutorial-first-sprint.md) — end-to-end walkthrough
- [Framework Reference](framework.md) — full scoring system details
- [Dashboard Guide](guides/dashboard.md) — live performance dashboard
- [Multi-Developer Guide](guides/multi-developer.md) — team handicap tracking

```

## docs/guides/continue-setup.md (score: 0.555)
```
# SLOPE + Continue Setup Guide

[Continue](https://continue.dev) does not have a tool-level hook system, so SLOPE guard integration is limited to manual/GenericAdapter usage. However, Continue's MCP support and rules system provide read-only access to SLOPE data.

## MCP Server Setup

Continue supports MCP servers in Agent mode. Add the SLOPE MCP server to your Continue config:

**`~/.continue/config.yaml`:**
```yaml
mcpServers:
  - name: slope
    command: npx
    args: ["-y", "mcp-slope-tools"]
```

**Or as a standalone file** (`.continue/mcpServers/slope.yaml` in your workspace):
```yaml
name: slope
command: npx
args: ["-y", "mcp-slope-tools"]
```

This gives Continue's Agent mode access to SLOPE's search and execute tools for querying scorecards, handicap cards, and codebase maps.

## Rules Setup

Continue's rules system provides static instructions to the agent. Add SLOPE-aware rules:

**`.continuerules`** (workspace root):
```
Use SLOPE for sprint tracking. Run `slope briefing` before starting work.
Commit early, commit often. Push after completing each ticket.
```

**Or as structured rules** (`.continue/rules/slope.md`):
```markdown
---
name: SLOPE Sprint Discipline
alwaysApply: true
---

- Run `slope briefing` before starting any sprint work
- Commit after each file creation, feature, or bug fix
- Push after completing each ticket
- Run `slope validate` on scorecards before merging
```

## Limitations

Continue does **not** support:
- Tool-level hooks (PreToolUse, PostToolUse, etc.)
- Blocking tool execution
- Dynamic context injection from guards
- Automated guard enforcement

These limitations are inherent to Continue's architecture — there is no hook or middleware system for tool calls.

## GenericAdapter for Manual Integration

For projects that need guard enforcement, use SLOPE's GenericAdapter:

```bash
# Run a guard manually
echo '{"tool_name":"write_file","file_path":"src/index.ts"}' | slope guard hazard

# Install generic guard hooks
slope hook add --level=full --harness=generic
```

The GenericAdapter outputs JSON that can be consumed by external scripts or CI pipelines.

## Why No `--continue` Init Flag

Continue's configuration (`~/.continue/config.yaml`) is global — it lives in the user's home directory, not in the workspace. The `slope init` command is workspace-scoped and cannot reliably resolve or write to user-specific global paths. Configure Continue manually per the instructions above.

```

## docs/store.md (score: 0.553)
```
# SLOPE Store

The SLOPE store persists sessions, claims, scorecards, events, and common issues. Two backends are supported: SQLite (default) and PostgreSQL.

## Configuration

Store type is set in `.slope/config.json`:

```json
{
  "store": "sqlite",
  "store_path": ".slope/slope.db"
}
```

For PostgreSQL:

```json
{
  "store": "postgres",
  "postgres": {
    "connectionString": "postgres://user:pass@host:5432/slope",
    "projectId": "my-project"
  }
}
```

PostgreSQL requires the `pg` package: `npm install pg`.

## Migration Behavior

Migrations run automatically when the store is opened. Each migration is applied exactly once and tracked in a `schema_version` table.

- **SQLite:** Migrations run synchronously in the constructor.
- **PostgreSQL:** Migrations use a transaction-scoped advisory lock (`pg_advisory_xact_lock`) for concurrency safety. Multiple agents can safely open the store simultaneously.

Current schema version: **3** (sessions, claims, scorecards, common issues, events, swarm support).

## CLI Commands

### `slope store status`

Show store type, schema version, and row counts:

```
$ slope store status
Store type:     sqlite
Path:           .slope/slope.db
Schema version: 3
Sessions:       2
Claims:         5
Scorecards:     12
Events:         847
Last event:     2026-02-27T14:30:00Z
```

Use `--json` for machine-readable output:

```
$ slope store status --json
{"type":"sqlite","path":".slope/slope.db","schemaVersion":3,"sessions":2,...}
```

### `slope store migrate status`

Show current schema version and whether migrations are pending:

```
$ slope store migrate status
Current schema version: 3
Total migrations:       3
Status:                 up to date
```

### `slope store backup`

Back up the store to a file:

```
$ slope store backup
Backup created: .slope/slope-backup-2026-02-27_14-30-00.db

$ slope store backup --output=/path/to/backup.db
Backup created: /path/to/backup.db
```

For SQLite, the backup flushes the WAL (Write-Ahead Log) before copying to ensure all pending writes are included. For PostgreSQL, the command prints the `pg_dump` command for you to run manually.

### `slope store restore`

Restore from a backup file:

```
$ slope store restore --from=.slope/slope-backup-2026-02-27_14-30-00.db
Store restored from .slope/slope-backup-2026-02-27_14-30-00.db (overwritten)
```

The restore validates that the backup is a valid SLOPE database (checks for `schema_version` table) before overwriting. For PostgreSQL, it prints the `psql` command.

## MCP Tool

The `store_status` MCP tool exposes store health checks to AI agents:

```
search({ module: 'store', query: 'store_status' })
```

Returns `StoreHealthResult` with `healthy`, `type`, `schemaVersion`, `stats`, and `errors` fields.

## Health Check API

The `checkStoreHealth()` function runs `getSchemaVersion()` and `getStats()`, catches any errors, and returns a structured result:

```typescript
import { checkStoreHealth } from '@slope-dev/slope';

const result = await checkStoreHealth(store, 'sqlite');
// { healthy: true, type: 'sqlite', schemaVersion: 3, stats: {...}, errors: [] }
```

## PostgreSQL Hardening

The PostgreSQL store validates connections at startup:

1. **Connection string format** — must start with `postgres://` or `postgresql://`, include a hostname and database name.
2. **Connection ping** — executes `SELECT 1` before returning the store. On failure, the pool is cleaned up and a clear error is thrown.

```

## docs/backlog/sprint-26-plan.md (score: 0.551)
```
# Sprint 26 — The Fairway Map: User Flow Tracking

**Par:** 4 | **Slope:** 2 (`new subsystem across 3 packages, but follows established patterns`) | **Type:** feature

**Theme:** Flow tracking — map user-facing workflows to code paths, queryable via MCP search.

## Tickets

### S26-1: Flow types + validation functions
- **Club:** short_iron | **Complexity:** standard
- Create `packages/core/src/flows.ts` with types and pure functions:
  - `FlowStep`, `FlowDefinition`, `FlowsFile` — typed schema
  - `parseFlows(json)` — parse + validate JSON
  - `validateFlows(flows, cwd)` — check file paths resolve, detect orphaned paths
  - `checkFlowStaleness(flow, currentSha, cwd)` — diff files between verified SHA and current
  - `loadFlows(flowsPath)` — read + parse, return null if missing
- Export types and functions from `packages/core/src/index.ts`
- Add `flowsPath` to `SlopeConfig` interface with default `.slope/flows.json`
- Tests in `packages/core/tests/flows.test.ts`

### S26-2: `slope flows` CLI command
- **Club:** short_iron | **Complexity:** standard
- Create `packages/cli/src/commands/flows.ts` with subcommands:
  - `slope flows init` — create `.slope/flows.json` with example template
  - `slope flows list` — table of flows with staleness indicators
  - `slope flows check` — validate all flows (file existence, staleness per SHA); exit 1 if any stale
- Register in `packages/cli/src/index.ts`
- Tests in `packages/cli/tests/flows.test.ts`

### S26-3: MCP search integration
- **Club:** short_iron | **Complexity:** standard
- Add `'flows'` to Zod module enum in `packages/mcp-tools/src/index.ts`
- Add `handleFlowsQuery(query?)` — reads `.slope/flows.json`, filters by id/title/tags, returns formatted definitions with staleness
- Wire into search dispatch
- Add `'flows'` to registry module type in `packages/mcp-tools/src/registry.ts`
- Add registry entries for flow functions
- Add flow type definitions to `SLOPE_TYPES`
- Tests in `packages/mcp-tools/tests/flows.test.ts`

### S26-4: CODEBASE.md flows section + stale-flows guard
- **Club:** wedge | **Complexity:** small
- Add `generateFlowsSummary()` to `packages/cli/src/commands/map.ts`
- Add `<!-- AUTO-GENERATED: START/END flows -->` markers to template
- Add `flows` count to YAML frontmatter metadata
- Add `'stale-flows'` guard to `GuardName` type union and `GUARD_DEFINITIONS` in `packages/core/src/guard.ts`

### S26-5: Docs + sprint plan artifact
- **Club:** putter | **Complexity:** trivial
- Save sprint plan to `docs/backlog/sprint-26-plan.md`
- Update `docs/backlog/README.md` with Sprint 26 row
- Update `CLAUDE.md` with Flows section

## Execution Order

```
S26-1 → S26-2 → S26-3 → S26-4 → S26-5
         ↘ S26-4 (guard part can parallel with S26-3)
```

```

## docs/retros/sprint-29-review.md (score: 0.550)
```

## Sprint 29 Review: Fix NPM Publishing Pipeline

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 5 |
| Slope | 1 |
| Score | 5 |
| Label | Par |
| Fairway % | 100% (6/6) |
| GIR % | 66.7% (4/6) |
| Putts | 2 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 6)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S29-1 | Wedge | In the Hole | — | Two vi.mock() paths in next-action.test.ts and guards.test.ts didn't match import paths after package consolidation. Changed '../src/store.js' → '../../src/cli/store.js' and '../src/config.js' → '../../src/cli/config.js'. 20 tests fixed, CI green. |
| S29-2 | Putter | In the Hole | — | Rewrote scripts/version-bump.mjs to bump single root package.json for @slope-dev/slope instead of looping over 5 old @srbryers/* packages. |
| S29-3 | Wedge | Green | wrong_token_type: User first created a classic publish token (requires OTP) instead of a granular access token. Required a second attempt with the correct token type. | Manual step — replaced classic NPM publish token (EOTP error) with granular access token scoped to @slope-dev/slope. Updated NPM_TOKEN GitHub Actions secret. Took two attempts due to initial token type confusion. |
| S29-4 | Putter | In the Hole | — | Deleted failed v1.5.0-npm release and stale v1.5.0 release (GitHub Packages era) with their tags via gh CLI. |
| S29-5 | Putter | In the Hole | — | Added pull_request trigger to .github/workflows/ci.yml. CI previously only ran on push to main. |
| S29-6 | Short Iron | Green | publish_retry: First publish attempt failed due to wrong token type from S29-3. Re-ran workflow after token was corrected — succeeded on second attempt. | Bumped version to 1.5.1, created GitHub Release v1.5.1, watched publish workflow succeed. Verified @slope-dev/slope@1.5.1 live on npm with provenance attestation. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | none | Sprint was reactive — fixing breakage from recent consolidation refactor, not greenfield work |
| Altitude | minor | NPM token types and OIDC/provenance are under-documented — required trial and error for correct token configuration |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| wrong_token_type | S29-3 | User first created a classic publish token (requires OTP) instead of a granular access token. Required a second attempt with the correct token type. |
| publish_retry | S29-6 | First publish attempt failed due to wrong token type from S29-3. Re-ran workflow after token was corrected — succeeded on second attempt. |

**Known hazards for future sprints:**
- NPM classic publish tokens require OTP in CI — always use Granular Access Tokens for GitHub Actions
- vi.mock() paths must exactly match the import paths used in the module under test — Vitest resolves them independently
- Creating a GitHub Release from a stale commit runs the workflow version at that commit, not HEAD

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | Full build + test + typecheck verified locally before every commit and confirmed green on CI |
| Diet | healthy | Commit-per-ticket discipline maintained — 5 code commits plus version bump, all pushed promptly |
| Supplements | healthy | No new tests written — sprint fixed 20 existing broken tests. 1161 total tests passing. |
| Recovery | healthy | Added .env to .gitignore immediately after user placed NPM token in local .env — prevented credential leak |

### Course Management Notes

- 6 tickets, par 5, score 5 — clean par with 2 minor hazards (token type, publish retry) absorbed without penalties
- Slope 1 confirmed appropriate — all small fixes and config changes, no new infrastructure
- Sprint type: fix — reactive cleanup after consolidation refactor broke CI and publish pipeline
- @slope-dev/slope@1.5.1 published to npm with provenance attestation — pipeline verified end-to-end

### 19th Hole

- **How did it feel?** Fast, low-resistance sprint. All code fixes were surgical — 2-line mock path corrections, 13-line script rewrite, 2-line YAML addition. The only friction was external: NPM token types are confusing and the first token was the wrong type.
- **Advice for next player?** When publishing scoped packages to npm from GitHub Actions: use a Granular Access Token (not Classic Publish, not Classic Automation). Classic tokens require OTP even in CI. Granular tokens bypass OTP and can be scoped to specific packages. The --provenance flag requires id-token: write permission in the workflow.
- **What surprised you?** The consolidation from 5 packages to 1 only broke 2 test files (mock paths), not the source code itself. The publish workflow was already correctly updated but the release was created from a stale commit that ran the old workflow.
- **Excited about next?** The release pipeline is now fully automated: bump version → push → create GitHub Release → auto-publish to npm with provenance. Future releases are a 3-step process.


```

