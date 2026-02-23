# SLOPE Roadmap — Phases 1-3 (Complete)

> **Status: Complete.** All 9 sprints (S7-S15) have been implemented. See [roadmap-phase4.md](roadmap-phase4.md) for the next phase (S17-S20).

**Phase 1 (S7-S10):** Course strategy tooling + metaphor engine + platform reach + improved auto-scoring
**Phase 2 (S11-S13):** Session telemetry + agent guidance + HTML reports + launch polish
**Phase 3 (S14-S15):** Multi-agent orchestration primitives — roles, communication, team scoring

**Parallel tracks:**
- Strategy: S7 (standalone, first)
- Presentation: S8 → S9 → S13
- Signals/Guidance: S10 → S11 → S12 → S13
- Orchestration: S13 → S14 → S15

**Critical path:** S10 → S11 → S12 → S13 → S14 → S15 (longest chain, 6 sprints)
**Parallel tracks:** S7 (standalone) + S8 → S9 (runs alongside S10-S11)
**Minimum viable launch:** S8 + S9 (metaphors + all 3 platforms)
**Full framework:** S7-S15 (SLOPE owns the complete methodology; Caddystack becomes pure UI)

---

## Phase 1 — Foundation

### Sprint 7 — The Yardage Book

**Par:** 4 | **Slope:** 2 (`moderate: new subsystem, structured data format, CLI commands, MCP integration`) | **Type:** architecture + methodology

**Theme:** Strategic planning tools for SLOPE's highest methodology level — course strategy. Today SLOPE has shot-level planning (club selection), hole-level planning (sprint plans), and round-level review (handicap cards, tournaments). Missing is the course-level layer: building multi-sprint roadmaps, validating them against the codebase, and running structured architect reviews. This sprint codifies the process of vision → roadmap → review → iteration as methodology tooling.

**Why first:** The roadmap tooling should exist before we execute the rest of the roadmap. Every subsequent sprint benefits from `slope roadmap` validation, strategic briefing context, and structured review automation.

#### Methodology Levels (after S7)

| Level | Golf Analogy | SLOPE Tooling |
|-------|-------------|---------------|
| **Shot** (per-ticket) | Club selection | `slope plan`, `slope classify`, pre-shot routine |
| **Hole** (per-sprint) | Hole strategy | Sprint plans, `slope briefing`, review-loop rule |
| **Round** (per-phase) | Round review | `slope card`, `slope tournament`, post-round routine |
| **Course** (strategic) | Walk the course | `slope roadmap` (NEW), architect review, strategic briefing |

#### Tickets

##### S7-1: Structured roadmap format + schema
- **Club:** short_iron | **Complexity:** standard
- Define a typed roadmap format in `packages/core/src/roadmap.ts`:
  - `RoadmapDefinition`: phases, sprints, dependency graph
  - `RoadmapSprint`: id, theme, par, slope, tickets (typed), dependencies, parallel flags
  - `RoadmapTicket`: key, title, club, complexity, description, depends_on
- **JSON is the source of truth** — roadmaps are authored and validated as JSON files matching the schema. Markdown rendering is an output format (`slope roadmap show` renders to markdown), not an input format. This avoids the fragility of parsing arbitrary markdown into typed structures.
- Dependency graph is queryable: critical path computation, parallel opportunity detection, blocker analysis
- Export from core: `parseRoadmap()`, `validateRoadmap()`, `computeCriticalPath()`, `findParallelOpportunities()`
- Tests: schema validation, dependency cycle detection, critical path computation, parallel detection

##### S7-2: `slope roadmap` CLI command
- **Club:** short_iron | **Complexity:** standard
- `slope roadmap validate` — validates a roadmap file against the schema, checks dependency graph for cycles, verifies sprint ticket counts (3-4 per sprint), confirms sprint numbering continuity
- `slope roadmap review` — runs structured architect review checks:
  - Dependency correctness (does anything claim a dep it doesn't need, or miss one?)
  - Scope balance (any sprint overloaded or underloaded?)
  - Naming collision detection (checks ticket fields/types against existing codebase types via grep)
  - Vision doc coverage (compares roadmap deliverables against vision doc "Next" items)
  - Gap analysis (are there vision items not covered?)
- `slope roadmap status` — shows current progress: which sprint is active, what's completed, what's blocked
- `slope roadmap show` — renders the roadmap summary (dependency graph, critical path, parallel tracks)
- Tests: validation catches common errors, review detects known issues, status tracking

##### S7-3: MCP + briefing integration
- **Club:** short_iron | **Complexity:** standard
- Roadmap queryable via MCP `execute()`: agents can check which sprint they're in, what the strategic context is, what comes next
- `slope briefing` gains a **strategic context** section when a roadmap exists:
  - "Sprint 3 of 9 — on the signals/guidance track"
  - "This sprint's deliverable feeds into S12 (The Caddy) via the events table"
  - "Parallel track (presentation: S8→S9) is currently at S9"
- Strategic context is concise (3-5 lines) — positioned before the existing hazard/common-issues sections
- Tests: MCP roadmap queries, briefing output with strategic context, briefing without roadmap (graceful degradation)

##### S7-4: Roadmap documentation + `slope init` integration
- **Club:** wedge | **Complexity:** small
- `slope init` offers to create a starter roadmap alongside the config and templates
- Document the roadmap format and commands in README
- Add course strategy to the sprint checklist rule (`.claude/rules/sprint-checklist.md`) as a new "Pre-Tournament Routine" section
- Tests: init creates roadmap file, documentation accuracy

#### Execution Order

```
S7-1 → S7-2 → S7-3 → S7-4
```

S7-1 (schema + format) must land first. S7-2 (CLI) builds on the types. S7-3 (MCP + briefing) needs the CLI working. S7-4 (docs + init) is cleanup.

**Note:** S7 has no dependencies on any other sprint and can start immediately. It benefits from completing before S8 so the roadmap tooling is available during execution, but S8 does not hard-depend on S7.

---

### Sprint 8 — The Rosetta Stone

**Par:** 4 | **Slope:** 2 (`moderate: new subsystem, touches formatters across core + CLI`) | **Type:** architecture + feature

**Theme:** Build the metaphor engine — a pluggable language layer that makes SLOPE's scoring concepts expressible in Golf, Tennis, Baseball, Gaming, D&D, and Matrix terminology. Scoring math is untouched; formatters, CLI output, and templates become metaphor-aware.

#### Tickets

##### S8-1: MetaphorDefinition interface + metaphor registry
- **Club:** short_iron | **Complexity:** standard
- Create `packages/core/src/metaphor.ts` with `MetaphorDefinition` interface
  - Fields: `id`, `name`, `description`, plus term maps for sprints, tickets, results, performance, difficulty, clubs, nutrition categories
  - Term maps use typed keys matching existing enum values (e.g., `ShotResult` → display string)
- Create `packages/core/src/metaphors/` directory with one file per metaphor:
  - `golf.ts` (default — maps to current hardcoded terms)
  - `tennis.ts`, `baseball.ts`, `gaming.ts`, `dnd.ts`, `matrix.ts`
- Export `getMetaphor(id: string): MetaphorDefinition` and `listMetaphors(): MetaphorDefinition[]`
- Add `"metaphor"` field to config schema in `packages/core/src/config.ts`
- Tests: definition completeness (every metaphor covers every term), registry lookup, default fallback

##### S8-2: Metaphor-aware formatters
- **Club:** long_iron | **Complexity:** moderate (touches 7-8 files with pervasive hardcoded strings: formatter.ts, briefing.ts, handicap.ts, advisor.ts, constants.ts, validation.ts, builder.ts, and golf-specific enums like `TrainingType`)
- Update formatters in `packages/core/src/` to accept optional `MetaphorDefinition` parameter
- When provided, formatters use metaphor terms instead of hardcoded golf strings
- When omitted, behavior is identical to today (golf terms) — full backward compatibility
- **Scope boundary:** Internal type names (`GolfScorecard`, `HoleScore`, `HoleStats`, `ClubSelection`, `ShotResult`, etc.) remain golf-derived and are NOT renamed. Metaphors are display-only — they affect output strings, not the type system or API surface. This prevents a breaking rename cascade across all packages.
- Key formatters to update: handicap card, review, briefing, validation output, training plan
- Tests: snapshot tests comparing golf output (unchanged) vs tennis/gaming output (new terms)

##### S8-3: CLI metaphor resolution + config support
- **Club:** wedge | **Complexity:** small
- CLI commands read `"metaphor"` from `.slope/config.json` and resolve via `getMetaphor()`
- Pass resolved metaphor to formatter calls
- `slope init` gains `--metaphor <id>` flag to set the metaphor in config during setup
- `slope config metaphor <id>` (or similar) to change metaphor post-init
- Fallback chain: CLI flag → config file → `"golf"` default
- Tests: CLI resolves metaphor from config, flag overrides config, invalid metaphor shows available options

##### S8-4: Metaphor documentation + validation
- **Club:** putter | **Complexity:** trivial
- Add metaphor section to README (available metaphors, how to configure)
- Update CLAUDE.md with metaphor configuration notes

#### Execution Order

```
S8-1 → S8-2 → S8-3 → S8-4
```

S8-1 (interface + registry) must land first — everything depends on `MetaphorDefinition`. S8-2 (formatters) and S8-3 (CLI) could partially overlap but S8-3 needs the formatter signatures from S8-2. S8-4 is docs cleanup.

---

### Sprint 9 — Cross-Platform

**Par:** 4 | **Slope:** 2 (`moderate: new platform configs, template generation, testing across tools`) | **Type:** dx + integration

**Theme:** Complete Cursor integration and add OpenCode support. `slope init` generates metaphor-aware templates for all three platforms. Every supported tool gets working MCP config + rules/context files.

#### Tickets

##### S9-1: Template generators replace static templates
- **Club:** short_iron | **Complexity:** standard
- Refactor `slope init` to generate templates dynamically using the configured metaphor
- Templates reference metaphor terms (e.g., "Pre-Round Routine" becomes "Pre-Set Routine" in Tennis)
- Existing static templates in `templates/` (repo root) become the golf-metaphor baseline; generator produces equivalent output for any metaphor
- CLAUDE.md, .cursorrules, and AGENTS.md templates all go through the generator
- Tests: generated templates contain correct metaphor terms, golf output matches current static templates

##### S9-2: Cursor .cursorrules + MCP config
- **Club:** short_iron | **Complexity:** standard
- **Existing infrastructure:** Cursor `.mdc` rule templates and MCP config already exist in `templates/cursor/`. This ticket completes the integration — adds `.cursorrules` file, updates MCP config to use published package, and wires templates through the metaphor-aware generator from S9-1.
- Create `.cursorrules` template with SLOPE methodology (sprint checklist, commit discipline, review loop) adapted for Cursor's format
- `slope init --cursor` installs `.cursorrules` (with metaphor terms) + Cursor MCP config
- MCP config points to `@srbryers/mcp-tools` (published package, not local build)
- Acceptance criteria: MCP server connects in Cursor, `search()` and `execute()` work (manual verification)
- Tests: template generation, file installation, no-clobber guard

##### S9-3: OpenCode AGENTS.md + MCP config
- **Club:** short_iron | **Complexity:** standard
- Create AGENTS.md template (CLAUDE.md-compatible format, which OpenCode reads)
- `slope init --opencode` installs AGENTS.md + OpenCode MCP config (`opencode.json` or equivalent)
- Research OpenCode's MCP config format and hook system — document findings
- Tests: template generation, file installation, MCP config format validation

##### S9-4: Platform detection + unified init
- **Club:** wedge | **Complexity:** small
- `slope init` (no flag) detects which platforms are present in the project:
  - Claude Code: `.claude/` directory or `CLAUDE.md` exists
  - Cursor: `.cursor/` directory or `.cursorrules` exists
  - OpenCode: `opencode.json` or `AGENTS.md` exists
- Offers to install for detected platforms, or asks which to target
- `slope init --all` installs for all three platforms
- Tests: detection logic for each platform, combined init

#### Execution Order

```
S9-1 → S9-2 ─┐
              ├→ S9-4
S9-1 → S9-3 ─┘
```

S9-1 (template generators) must land first. S9-2 (Cursor) and S9-3 (OpenCode) can run in parallel after S9-1. S9-4 (detection + unified init) depends on both platform implementations.

---

### Sprint 10 — Signal Intelligence

**Par:** 4 | **Slope:** 2 (`moderate: new DB table, signal parsing, classification improvements`) | **Type:** feature + infrastructure

**Theme:** Make auto-scoring practical for community adoption. Today `auto-card` uses git signals only and defaults all shots to `in_the_hole`. Add CI/test signal ingestion, an events table for structured telemetry, and smarter shot classification that uses multiple signal sources.

#### Tickets

##### S10-1: Events table + schema migration framework
- **Club:** short_iron | **Complexity:** standard
- **Introduce a lightweight versioned migration system** — `schema_version` table tracks the current version; sequential migration functions run on store initialization. S14 and S15 will also need this for column additions (e.g., `swarm_id` on sessions). `CREATE TABLE IF NOT EXISTS` alone cannot handle ALTER TABLE scenarios.
- Add `events` table via the new migration system:
  ```sql
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    type TEXT NOT NULL,     -- 'failure', 'dead_end', 'scope_change', 'compaction', 'hazard', 'decision'
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL,     -- JSON blob with event-specific fields
    sprint_number INTEGER,
    ticket_key TEXT
  )
  ```
- Add store methods: `insertEvent()`, `getEventsBySession()`, `getEventsBySprint()`
- Export event types from core: `SlopeEvent`, `EventType`
- Tests: migration runner (version tracking, sequential execution, idempotency), CRUD operations, query by session/sprint, JSON data round-trip

##### S10-2: CI/test signal parser
- **Club:** short_iron | **Complexity:** standard
- New module in core: `packages/core/src/signals/ci.ts`
- Parse common CI output formats:
  - Jest/Vitest: test count, pass/fail, first-run vs retry
  - Generic: exit code, stdout patterns for pass/fail
- `slope auto-card --ci <path-or-stdin>` ingests CI output alongside git signals
- Signal weighting: CI failures override git-only "clean" assessment
- Tests: parsing Jest output, Vitest output, signal combination logic

##### S10-3: Improved shot classification from combined signals
- **Club:** short_iron | **Complexity:** standard
- Enhance `classifyShot()` in core to accept multi-source signal input:
  - Git signals: diff size, revert detection, scope drift (existing)
  - CI signals: test pass/fail, retry count (from S10-2)
  - Event signals: failure count, dead ends (from S10-1)
- Classification matrix:
  - All green, small diff, no events → `in_the_hole`
  - Tests pass, moderate diff, minor scope drift → `green`
  - Tests pass after retry, or scope drift > threshold → `fairway`
  - Test failures, reverts, or dead ends → appropriate miss direction
- Remove the current default-everything-to-`in_the_hole` behavior
- **Behavioral change:** git-only auto-card (no `--ci` flag) will produce different results than v1.0.0. Default without CI should be `green` (not `in_the_hole`) when git signals are clean. This is a semver-minor behavioral change (not a type/API break) — acceptable in v1.x because auto-card output was always documented as "review before filing." Document in changelog and CLI help. Add `--classify=legacy` flag for users who need the old default during transition.
- Tests: classification for each signal combination, backward compat with git-only input, explicit test for git-only default

##### S10-4: Auto-card integration + documentation
- **Club:** wedge | **Complexity:** small
- Wire S10-2 and S10-3 into `slope auto-card` command
- Update CLI help text and README with new `--ci` flag
- Document signal sources and classification logic
- Tests: end-to-end auto-card with combined signals

#### Execution Order

```
S10-1 ─┐
       ├→ S10-3 → S10-4
S10-2 ─┘
```

S10-1 (events table) and S10-2 (CI parser) are independent. S10-3 (combined classification) needs both. S10-4 (integration) wraps it up.

**Note:** S10 has no dependency on S8 or S9 and can run in parallel with the presentation track (S8-S9).

---

## Phase 2 — Telemetry, Guidance & Launch

### Sprint 11 — The Transcript

**Par:** 4 | **Slope:** 2 (`moderate: hook integration, event extraction, pipeline wiring`) | **Type:** feature + infrastructure

**Theme:** Wire session telemetry into the common-issues and hazard pipeline. Hooks capture structured events from agent sessions. Events feed into auto-scoring, briefings, and common-issues promotion.

#### Tickets

##### S11-1: Claude Code session hooks for event capture
- **Club:** short_iron | **Complexity:** standard
- **New CLI command:** `slope extract --session-id=<id>` — reads Claude Code's conversation history from its known local storage location, parses it, and writes structured events to SQLite via `insertEvent()`
- Research spike: determine where Claude Code stores conversation history (filesystem path, format). Design the parser around verified format, not assumptions.
- Events map to the `EventType` enum from S10-1: failure, dead_end, scope_change, compaction, hazard, decision
- Implement `session-end` hook template that calls `slope extract` automatically on session end
- `slope hook add session-end-events` installs the hook
- Tests: event extraction from sample transcript data, `slope extract` CLI command, hook installation

##### S11-2: Event-to-common-issues pipeline
- **Club:** short_iron | **Complexity:** standard
- New module: `packages/core/src/pipeline.ts`
- Analyze events across sprints to detect recurring patterns:
  - Same failure type in same file/area across 2+ sprints → promote to common issue
  - Dead ends with similar context → hazard candidate
- `slope distill --auto` runs the pipeline and updates common issues
- Respects existing manual entries — auto-promoted issues are tagged with `"source": "telemetry"`
- Tests: pattern detection across mock event sets, promotion thresholds, no-clobber on manual entries

##### S11-3: Briefing integration with events
- **Club:** wedge | **Complexity:** small
- `slope briefing` includes relevant events from recent sessions when working in the same area
- "Last time in `packages/core/src/formatters/`, the agent hit a type mismatch after refactoring" style context
- Events older than N sprints are excluded (configurable, default 5)
- Tests: briefing output includes event context, respects recency window

##### S11-4: OpenCode plugin hooks (research + prototype)
- **Club:** long_iron | **Complexity:** moderate
- Research OpenCode's `tool.execute.after`, `session.compacted`, `session.idle` hook points
- Prototype a SLOPE plugin that logs events to SQLite as they happen (real-time, not post-session)
- Document findings and integration path, even if plugin isn't production-ready
- Tests: if plugin is functional, basic event capture tests; otherwise, research document

#### Execution Order

```
S11-1 → S11-2 → S11-3
S11-4 (independent research track)
```

S11-1 (hooks) provides the event data. S11-2 (pipeline) processes it. S11-3 (briefing) surfaces it. S11-4 is independent research.

---

### Sprint 12 — The Caddy

**Par:** 4 | **Slope:** 2 (`moderate: platform-specific hook APIs, real-time data lookups, new hook category`) | **Type:** feature + dx

**Theme:** Agent behavior hooks that use SLOPE's own data (hazards, common issues, claims, codebase indices, git state) to guide agents in real-time. Two tiers: scoring-only (lifecycle hooks, the default) or full (all guidance hooks active). Hooks are non-blocking hints — the agent sees the guidance and decides.

#### Hook Levels

| Level | What's installed | Who it's for |
|-------|-----------------|-------------|
| **scoring** (default) | session-start, session-end, pre-merge, post-sprint | Users who just want scorecards |
| **full** | + explore-guard, hazard-warn, commit-nudge, scope-drift, compaction-checkpoint, next-work | Users who want SLOPE actively guiding agent behavior |

`slope hook add --level=full` installs all hooks for the detected platform. Individual hooks can also be added one at a time.

#### Tickets

##### S12-1: Guard framework + hook generation
- **Club:** short_iron | **Complexity:** standard
- **Research spike first:** verify Claude Code's current `PreToolUse`/`PostToolUse` hook API contract (input format, expected output, matcher syntax). The existing SLOPE hooks are lifecycle shell scripts — guidance hooks are a fundamentally different category. Design the framework around verified behavior, not assumptions.
- New hook category in SLOPE: **guidance hooks** (distinct from existing lifecycle hooks)
- For Claude Code: generate `.claude/hooks.json` entries with `PreToolUse`/`PostToolUse` matchers that call SLOPE CLI commands
- For OpenCode: generate plugin hook registrations for `tool.execute.before`/`tool.execute.after`
- For Cursor: document limitations; fall back to lifecycle hooks where possible
- Hook contract: each guidance hook is a CLI command (`slope guard <hook-name>`) that receives tool context on stdin, returns JSON with the platform's expected response format
- `slope hook add` gains `--level` flag: `scoring` (default, current behavior) or `full`
- `slope guard disable <hook-name>` and `slope guard enable <hook-name>` for selective post-installation control. Config: `"guidance.disabled": ["scope-drift"]` in `.slope/config.json`. Allows troubleshooting without full uninstall.
- Tests: hook generation for each platform, CLI guard command contract, level filtering, selective disable/enable

##### S12-2: PreToolUse guards — explore + hazard
- **Club:** short_iron | **Complexity:** standard
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
  - `blocker_timeout`: if an agent is blocked for >N minutes, escalate
  - `claim_conflict`: if two agents claim overlapping scope, escalate
  - `test_failure_cascade`: if >N test failures across the swarm, escalate
- Escalation actions: log event, notify other agents via standup, mark ticket as blocked
- `slope escalate --reason="<description>"` for manual escalation
- Escalation events feed into the common-issues pipeline (S11) — recurring escalation patterns become documented hazards
- Tests: timeout-based escalation, conflict escalation, cascade detection, manual escalation

##### S15-3: Team handicap + swarm performance
- **Club:** short_iron | **Complexity:** standard
- Extend handicap computation for multi-agent data:
  - Per-role handicap: how does the "backend" role perform across sprints?
  - Swarm efficiency: ratio of coordination overhead to productive work
  - Cross-agent dispersion: which role combinations produce the best results?
- `slope card --swarm` shows swarm-level handicap card alongside individual agent cards
- Training recommendations adapt: "The architect role consistently misses long — consider reducing scope for architecture tickets"
- Tests: per-role handicap computation, swarm efficiency metric, cross-agent dispersion analysis

##### S15-4: Caddystack integration surface + documentation
- **Club:** short_iron | **Complexity:** standard (API surface documentation, MCP exposure verification, migration guide, format mapping from Caddystack's existing standup protocol)
- Document the complete SLOPE API surface that Caddystack consumes:
  - Session/swarm management (start, end, heartbeat, status)
  - Role assignment and context injection
  - Standup protocol (generate, ingest)
  - Escalation (trigger, query, resolve)
  - Scorecard generation (solo and swarm)
- Ensure all orchestration primitives are accessible via MCP tools (search + execute)
- Add orchestration examples to `slope init` templates
- Migration guide: how to move from Caddystack-native orchestration to SLOPE orchestration
- Tests: MCP tool access for all orchestration functions, example validation

#### Execution Order

```
S15-1 ─┐
       ├→ S15-3 → S15-4
S15-2 ─┘
```

S15-1 (scorecard aggregation) and S15-2 (escalation) are independent. S15-3 (team handicap) benefits from both. S15-4 (integration surface) is the final documentation and validation pass.

---

## SLOPE Methodology Layers

After S15, SLOPE owns the complete methodology stack:

| Layer | Scope | Sprints |
|-------|-------|---------|
| **Strategy** | Course planning — roadmaps, architect review, strategic briefings | S7 |
| **Scoring** | Scorecards, handicaps, dispersion, nutrition, tournaments | Shipped (v1.0.0) |
| **Signals** | Auto-scoring from git, CI, test runners, agent telemetry | S10, S11 |
| **Guidance** | Real-time agent hooks — explore guard, hazard warnings, commit nudge, scope drift, compaction, next-work | S12 |
| **Orchestration** | Roles, communication protocol, swarm sessions, escalation, team scoring | S14, S15 |
| **Presentation** | Metaphors, HTML reports, platform templates | S8, S9, S13 |

Caddystack consumes all layers via MCP and provides the mobile UI — remote agent management, push notifications, real-time monitoring dashboard.

## Summary

| Sprint | Theme | Par | Slope | Tickets | Key Deliverable | Depends On |
|--------|-------|-----|-------|---------|-----------------|------------|
| **S7** | The Yardage Book | 4 | 2 | 4 | Strategic planning tools — roadmap format, validation, review, briefing integration | — |
| **S8** | The Rosetta Stone | 4 | 2 | 4 | Metaphor engine — 6 metaphors, all formatters swappable | — |
| **S9** | Cross-Platform | 4 | 2 | 4 | Cursor + OpenCode support, metaphor-aware templates | S8 |
| **S10** | Signal Intelligence | 4 | 2 | 4 | Auto-scoring from git/CI signals, events table, migration framework | — (parallel with S8-S9) |
| **S11** | The Transcript | 4 | 2 | 4 | Session telemetry hooks, event-to-common-issues pipeline | S10 |
| **S12** | The Caddy | 4 | 2 | 4 | Agent guidance hooks — 6 guards across PreToolUse, discipline, and session lifecycle | S11 |
| **S13** | The Clubhouse | 4 | 2 | 4 | Static HTML reports + documentation + launch prep | S9, S12 (join point) |
| **S14** | The Foursome | 4 | 2 | 4 | Multi-agent primitives — roles, standup protocol, swarm sessions | S13 |
| **S15** | The Leaderboard | 4 | 2 | 4 | Team scoring, escalation rules, Caddystack integration surface | S14 |

**Total:** 36 tickets across 9 sprints. All sprints at 4 tickets.

### Vision Doc Coverage

| Vision Item | Sprint |
|-------------|--------|
| Strategic planning / roadmap tooling | S7 |
| Metaphor engine | S8 |
| Cursor support | S9 |
| OpenCode support | S9 |
| Improved auto-scoring | S10 |
| Session telemetry | S10 (events table) + S11 (hooks + pipeline) |
| Agent guidance hooks | S12 |
| Static HTML reports | S13 |
| Multi-agent roles + communication | S14 |
| Team scoring + escalation | S15 |
| Caddystack → pure UI layer | S15 |
