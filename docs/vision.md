# SLOPE Vision

> **SLOPE is an opinionated, open-source methodology and scoring engine for AI-assisted development.** It gives developers and their agents a structured feedback loop: score each sprint, track patterns over time, and feed learnings back into future sessions.

## The Problem

AI coding agents are powerful but unmeasured. Developers use Claude Code, Cursor, OpenCode, and other tools to write code at unprecedented speed — but have no way to answer basic questions:

- **Is my agent work getting better over time?**
- **What patterns cause failures?**
- **Am I over-engineering, under-scoping, or picking the wrong approach?**
- **What hazards should I watch for in this area of the codebase?**

Only 20% of teams measure AI impact with engineering metrics ([Jellyfish, 2025](https://jellyfish.co/blog/2025-ai-metrics-in-review/)). AI-generated code introduces 1.7x more issues than human-written code ([Second Talent, 2026](https://www.secondtalent.com/resources/ai-generated-code-quality-metrics-and-statistics-for-2026/)). The tools exist to write code faster, but nothing exists to write code *better over time*.

SLOPE fills that gap.

## What SLOPE Is

**Methodology as code.** Not a blog post, not a prompt template — a scoring engine with types, validation, MCP tools, and a CLI. SLOPE provides:

1. **Structured sprint scoring** — Every sprint gets a scorecard with objective metrics: tickets delivered, approach complexity, execution quality, hazards encountered, penalties incurred.

2. **Performance tracking** — Handicap cards with rolling windows (last 5, last 10, all-time) reveal trends. Dispersion analysis identifies systematic failure modes. Area performance shows which types of work you handle well.

3. **Feedback loops** — Hazard indices, common issues, and training recommendations carry forward from sprint to sprint. Each session starts with a briefing built from everything that came before.

4. **Automated classification** — Shot classification from git signals, test results, and execution traces. The goal is fully automated scorecard generation from CI/CD data, with manual override when needed.

5. **Development health (Nutrition)** — Five categories of developer/project health tracked per sprint: hydration (dependencies), diet (code hygiene), recovery (tech debt), supplements (tooling), and stretching (pre-session warmup). Nutrition trends surface in briefings as alerts when categories are declining.

6. **Tournament reviews** — Aggregate multiple sprints into initiative-level reviews. When a feature or milestone spans several sprints, tournament reviews roll up scoring, hazards, and trends across the full arc.

## Who It's For

**Solo developers using AI coding agents.** The primary user is a developer working with one or more AI agents (Claude Code, Cursor, OpenCode) who wants to systematically improve their agent-assisted workflow.

**Multi-agent operators.** Developers using orchestration tools (like Caddystack) to manage multiple concurrent agents across a project. SLOPE provides the per-sprint scoring layer; the orchestrator maps agent roles and work assignments to SLOPE scorecards, enabling performance comparison across agents, roles, and complexity levels.

**Teams (future).** Shared hazard indices and team-level handicap tracking for organizations where multiple developers contribute SLOPE scorecards to the same repository.

## Design Principles

### Tool-Agnostic via MCP

SLOPE's primary integration surface is the [Model Context Protocol](https://modelcontextprotocol.io/). Any tool that supports MCP servers can use SLOPE's full scoring engine — search the API, execute computations, manage sessions and claims. The same MCP server works across Claude Code, Cursor, OpenCode, and any future MCP-compatible tool.

Platform-specific integrations (rules files, hooks, init templates) provide deeper integration where available, but the core functionality is always accessible via MCP.

### Claude Code First

Claude Code is the primary development target. SLOPE's rules, hooks, and workflow routines were designed for and tested with Claude Code. The sprint checklist, commit discipline, and review loop rules are Claude Code native. As the framework matures, first-class support extends to Cursor and OpenCode.

**Target platforms (in priority order):**
1. Claude Code — rules, hooks, MCP, CLAUDE.md templates
2. Cursor — .cursorrules, MCP config
3. OpenCode — AGENTS.md (CLAUDE.md compatible), MCP, plugin hooks

### Methodology as Code

The framework is opinionated. Sprints have par values. Tickets have club selections. Shots have classifications. This isn't configurable away — it's the point. The opinions are encoded in TypeScript types, validated by the scoring engine, and enforced by the CLI.

What *is* configurable is the language used to express those opinions (see Metaphors below).

### Scorecards Are the Source of Truth

Every sprint produces a scorecard — a JSON file committed to the repository. Scorecards are:
- **Version-controlled** — they travel with the code they describe
- **Human-readable** — plain JSON, inspectable without tools
- **Machine-processable** — the scoring engine consumes them for handicap computation, dispersion analysis, and training recommendations
- **Cumulative** — more data means better trends, better hazard detection, better recommendations

Scorecards should accumulate. A project with 200+ sprints of scorecard data has a rich performance history that informs every future session.

### Automated by Default, Manual When Needed

Scorecard generation should require minimal human input. The ideal flow:

```
git/CI signals → auto-card generates scorecard → validated → committed with the PR
```

Signal sources for automated scoring:
- **Git** — diff size, file count, revert detection, commit cadence, scope drift *(implemented — `slope auto-card` uses git signals today)*
- **CI/test results** — pass/fail, first-run vs retry, coverage changes *(planned)*
- **PR metadata** — review cycles, change requests, merge time *(planned)*
- **Agent telemetry** — tool calls, context compactions, session duration, escalations *(planned — see Session Telemetry below)*

Manual scoring remains available for nuance the automation can't capture — architectural decisions, hazard severity, lessons learned.

### Session Telemetry: Heartbeats and Transcripts

SLOPE already tracks session liveness via **heartbeats** — each active session pings `updateHeartbeat()` on an interval, and stale sessions are automatically cleaned up. This gives us duration tracking and session health, but not *what happened* during the session.

The missing layer is **transcript-derived telemetry** — structured events extracted from agent conversation logs that feed directly into the hazard and common-issues pipeline. Today, hazards and gotchas are identified manually during retrospectives. Transcript analysis automates that.

**Why this matters:** The whole point of SLOPE's common-issues file, hazard index, and pre-round briefings is to prevent repeat failures. But that pipeline only works if failures are captured reliably. Manual capture is lossy — developers forget details, skip retros, or don't recognize a pattern until it's repeated three times. Transcripts capture everything.

**What to extract (not raw transcripts):**

The goal is not to store full conversation logs — those are large, noisy, and mostly uninteresting. Instead, SLOPE should extract **structured events at key moments**:

| Event | Trigger | What it captures |
|-------|---------|-----------------|
| **Failure** | Test failure, build error, revert | What broke, what the agent tried, what fixed it |
| **Dead end** | Agent abandons an approach | The approach that didn't work and why |
| **Scope change** | Files modified outside planned scope | Unplanned scope drift and the cause |
| **Context compaction** | Agent compresses conversation history | What was lost — a natural extraction checkpoint |
| **Hazard encountered** | Agent hits a known pattern from common-issues | Confirms the pattern is still active, adds new context |
| **Decision point** | Agent chooses between approaches | Which option was picked and the reasoning |

**Where it runs:**

The extraction point depends on the platform:

- **Claude Code** — Post-session hook. Claude Code stores conversation history locally. A `session-end` hook would run a transcript extraction command (planned — e.g., `slope extract --transcript`) to parse the session and emit structured events. Claude Code's `PreToolUse`/`PostToolUse` hooks can also capture tool-call sequences in real time. SLOPE already ships a hook system (`slope hook add|remove|list|show`) with templates for `session-start`, `session-end`, `pre-merge`, and `post-sprint` — these are the natural attachment points.
- **OpenCode** — Plugin hooks. OpenCode's `tool.execute.after`, `session.compacted`, and `session.idle` events map directly to the trigger points above. A SLOPE plugin could log events to SQLite as they happen.
- **Cursor** — Limited hook support currently. Post-session extraction from available logs is the likely path.
- **Caddystack** — Already solved differently. The standup protocol (`__STANDUP_START__...END__`) extracts decisions, patterns, escalations, and blockers from agent conversations in structured JSON. This is the existence proof that transcript extraction works at scale.

**Storage:**

Extracted events live in the SQLite store (`.slope/slope.db`) alongside sessions and claims, in a new `events` table (requires a schema migration from the current store). They're lightweight structured records, not raw text. A session that encounters 3 failures and 1 dead end produces ~4 small event rows, not megabytes of transcript.

These events feed into:
- **Common issues** — Recurring failure patterns get promoted automatically
- **Hazard index** — New hazards are captured with full context
- **Auto-scoring** — Dead ends, reverts, and scope changes directly inform shot classification
- **Briefings** — Next session's pre-round briefing includes "last time in this area, the agent hit X"

## Metaphors (Planned)

SLOPE's core scoring engine is pure math — par computation, handicap calculation, dispersion analysis. The language layer is **swappable**. Developers choose the metaphor that resonates with them.

> **Note:** Today, golf terminology is hardcoded throughout the codebase. The metaphor engine described below is planned work — the scoring engine will remain unchanged, but formatters, CLI output, and documentation templates will become metaphor-aware.

### Planned Metaphors

| Metaphor | Sprint | Ticket | Perfect | Good | Over-eng | Under-scope | Performance | Difficulty |
|----------|--------|--------|---------|------|----------|-------------|-------------|------------|
| **Golf** (default) | Hole | Shot | In the hole | Green | Missed long | Missed short | Handicap | Slope |
| **Tennis** | Set | Point | Ace | Winner | Out long | Net ball | Ranking | Surface |
| **Baseball** | Inning | At-bat | Home run | Base hit | Fly out | Strikeout | Batting avg | Park factor |
| **Gaming** | Level | Move | Critical hit | Combo | Overextend | Whiff | XP / Rating | Difficulty |
| **D&D** | Quest | Encounter | Critical hit | Hit | Overcast | Fumble | Level / XP | Challenge Rating |
| **Matrix** | Simulation | Action | The One | Freed mind | Deja vu | Glitch | Anomaly index | Threat level |

Configuration will be via a `"metaphor": "golf"` field in `.slope/config.json` (this field does not exist yet). The default is golf. The scoring engine is metaphor-unaware — metaphors only affect formatters, CLI output, and documentation templates.

> **Why "metaphor" not "theme"?** The scorecard type already has a `theme` field that stores the sprint's title/description (e.g., "Code Mode MCP Refactor"). To avoid overloading the term, the pluggable language system uses "metaphor."

## Architecture

### Packages

| Package | Purpose | npm |
|---------|---------|-----|
| `@slope-dev/core` | Scoring engine, types, validation, formatters, advisor | Published |
| `@slope-dev/store-sqlite` | SQLite storage adapter for sessions, claims, scorecards | Published |
| `@slope-dev/cli` | CLI tool — 15 commands including init, card, validate, review, briefing, plan, session, hook, claim, auto-card, tournament | Published |
| `@slope-dev/mcp-tools` | Code-mode MCP server (search + execute + session/claim) | Published |

### Integration Layers

```
┌─────────────────────────────────────────────────────┐
│                    AI Coding Agent                   │
│           (Claude Code / Cursor / OpenCode)          │
├─────────────────────────────────────────────────────┤
│  MCP Server (@slope-dev/mcp-tools)                  │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐    │
│  │ search  │  │ execute │  │ session / claims │    │
│  └─────────┘  └─────────┘  └──────────────────┘    │
├─────────────────────────────────────────────────────┤
│  Scoring Engine (@slope-dev/core)                   │
│  handicap · dispersion · advisor · tournament ·     │
│  training · briefing · nutrition · classification   │
├─────────────────────────────────────────────────────┤
│  Storage                                            │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ JSON files   │  │ SQLite (.slope/slope.db)     │ │
│  │ (scorecards) │  │ (sessions, claims, events*)  │ │
│  └──────────────┘  └──────────────────────────────┘ │
│  * events table planned for session telemetry       │
├─────────────────────────────────────────────────────┤
│  CLI (@slope-dev/cli) — 15 commands                 │
│  init · card · validate · review · briefing ·       │
│  plan · classify · auto-card · tournament ·         │
│  session · hook · claim · release · status · next   │
├─────────────────────────────────────────────────────┤
│  Hooks (@slope-dev/cli)                             │
│  session-start · session-end · pre-merge ·          │
│  post-sprint · pre-commit                           │
└─────────────────────────────────────────────────────┘
```

## Caddystack Integration

SLOPE is the scoring and methodology layer for [Caddystack](https://github.com/srbryers/caddystack), a platform for managing swarms of AI coding agents from a mobile app.

In Caddystack, SLOPE provides:
- **Per-agent scoring** — Each agent in the swarm produces scoreable work. Caddystack maps agent roles (Backend Engineer, Technical Architect, etc.) to SLOPE scorecards, enabling performance comparison across agents. The per-agent layer is Caddystack's; SLOPE provides the per-sprint scoring primitives underneath.
- **Sprint methodology** — Caddystack's "Agentile Methodology" adapts SLOPE for 2-hour compressed sprint cadences with machine-enforced gates.
- **Hazard propagation** — Common issues and hazard indices flow from SLOPE scorecards into agent context bundles, so agents learn from past failures.
- **Session coordination** — SLOPE's session and claim system prevents concurrent agents from conflicting on the same work areas.

Caddystack is the proof point for SLOPE at scale — 200+ sprints of continuous, scored, agent-assisted development.

## Reporting

### CLI Output (Available Now)
- `slope card` — Handicap card with rolling windows
- `slope review` — Markdown sprint review
- `slope briefing` — Pre-sprint briefing with hazards, trends, and recommendations
- `slope validate` — Scorecard validation
- `slope tournament` — Aggregate multiple sprints into an initiative-level tournament review
- `slope plan` — Club recommendation + training plan for upcoming work
- `slope classify` — Classify a shot from execution trace data

### Static HTML Reports (Planned)
`slope report --html` generates a self-contained HTML file with embedded data and charts — handicap trends, dispersion visualizations, area performance breakdowns. No server required, shareable as a PR artifact or standalone file.

### Local Dashboard (Future)
`slope dashboard` starts a local web server for interactive exploration of scorecard data. Reads from `.slope/` directory, no external hosting. Similar to Storybook's local dev server model.

## Roadmap

### Now (v1.x) — Shipped
- Core scoring engine, CLI (15 commands), MCP server — **shipped and published**
- Golf metaphor as default — **shipped** (hardcoded)
- `auto-card` for git-based scorecard generation — **shipped** (git signals only)
- Session and claim management via SQLite — **shipped**
- Hook system with templates for session lifecycle, pre-merge, post-sprint — **shipped**
- Tournament reviews for initiative-level aggregation — **shipped**
- Nutrition/development health tracking — **shipped**
- Training plan generation from handicap trends — **shipped**

### Next (S7-S15) — Full Framework

See [docs/backlog/roadmap.md](docs/backlog/roadmap.md) for the detailed sprint-by-sprint plan.

**Phase 1 (S7-S10) — Foundation:**
- **S7 — Course strategy** — Strategic planning tools: structured roadmap format, `slope roadmap` CLI (validate, review, status), MCP integration, strategic briefing context. Codifies the vision → roadmap → architect review → iteration process as methodology tooling.
- **S8 — Metaphor engine** — Pluggable metaphor system with 6 metaphors (Golf, Tennis, Baseball, Gaming, D&D, Matrix). Scoring math untouched; formatters and CLI become metaphor-aware.
- **S9 — Cross-platform** — Cursor (.cursorrules + MCP) and OpenCode (AGENTS.md + MCP) support. Template generation replaces static files. Platform auto-detection in `slope init`.
- **S10 — Signal intelligence** — CI/test signal parsing, events table in SQLite, versioned migration framework, improved shot classification from combined signals. Runs parallel to S8-S9.

**Phase 2 (S11-S13) — Telemetry, Guidance & Launch:**
- **S11 — Session telemetry** — Claude Code session hooks for event capture, event-to-common-issues pipeline, briefing integration. OpenCode plugin research.
- **S12 — Agent guidance** — `PreToolUse`/`PostToolUse` hooks that use SLOPE data to guide agents in real-time. Two tiers: scoring (default) and full. Full includes explore guard, hazard warnings, commit discipline nudge, scope drift detection, context compaction checkpoint, and next-work suggestions. Non-blocking hints, not enforcement.
- **S13 — Launch polish** — Static HTML reports (`slope report --html`), documentation overhaul, version bump, launch checklist.

**Phase 3 (S14-S15) — Multi-Agent Orchestration:**
- **S14 — Multi-agent primitives** — Role definitions (backend, frontend, architect, etc.), standardized standup/communication protocol, swarm session management. One sprint, multiple agents, each with role-appropriate context.
- **S15 — Team scoring + integration** — Multi-agent scorecard aggregation, escalation rules, per-role handicaps, swarm performance metrics. Caddystack integration surface — after S15, Caddystack becomes a pure mobile UI layer consuming SLOPE's orchestration API.

**Critical path:** S10 → S11 → S12 → S13 → S14 → S15 (6 sprints). S7 (standalone) + S8 → S9 run in parallel. **Minimum viable launch:** S8 + S9. **Full framework:** S15.

### Later
- **Shared hazard indices** — Multiple developers (not agents) contributing to the same project's common issues. S11's event pipeline handles automated pattern detection; this is the multi-human sharing layer on top.
- **Local dashboard** — Interactive web UI served locally (`slope dashboard`). S13 delivers static HTML reports; the dashboard adds interactivity and a local server.
- **Plugin system** — Formalized plugin architecture beyond the OpenCode prototype in S11-4. Claude Code hooks for automatic lifecycle events beyond what S12 provides.

### Open Questions
- **Multi-human workflow** — S15 covers per-role and per-agent handicaps for multi-agent swarms. The multi-human team layer (different developers, not agents, contributing scorecards) still needs design work. Separate handicaps with shared hazards is the likely starting point.
- **Dashboard distribution** — Static HTML generation ships in S13. Local server is a later extension. Hosted service only if team/cloud features warrant it.
- **Metaphor priorities** — Which metaphors ship first after golf? Likely driven by community interest.

## Competitive Position

SLOPE occupies an uncontested niche. No other tool combines structured sprint scoring with agent-specific performance tracking, pattern-based retrospectives, and MCP-native architecture.

| Need | Market Status | SLOPE |
|------|---------------|-------|
| Sprint scoring for agent work | No tools exist | Only tool doing this |
| Structured retros with pattern tracking | Generic tools — Spinach, TeamRetro (human-focused) | Agent-aware, data-driven |
| Performance trending over time | Org-level — Faros AI, Jellyfish, LinearB | Individual sprint-level scoring |
| Context persistence across sessions | Augment Code (commercial), Zep, various MCP memory servers | Hazard index + common issues + scorecard carry-forward |
| Structured agent workflow methodology | Blog posts (Allegro, BMAD) — not shipping software | Full methodology as code |
| Agent skill measurement | Tessl Task Evals (skill-level, not sprint-level) | Sprint-level with feedback loops |
| MCP-native architecture | Many MCP servers, none for scoring | Unique integration surface |

The multi-agent orchestration space (Claude Squad, Claude Flow, Warp Oz) is complementary — they coordinate agents but don't score or improve them. SLOPE is the quality layer any orchestrator can plug into.

## License

MIT
