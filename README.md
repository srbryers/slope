# SLOPE

**Sprint Lifecycle & Operational Performance Engine**

Replace subjective retrospectives with quantified sprint metrics. Track every ticket's approach, outcome, and hazards — then use rolling analytics to spot patterns and improve over time.

## Why SLOPE?

- **Quantified retros** — structured scorecards with objective scoring instead of "how did it feel?"
- **Pattern detection** — rolling handicap windows reveal if you consistently over-engineer, under-scope, or pick the wrong approach
- **AI agent guidance** — 16 guard hooks give real-time hints to Claude Code, Cursor, Windsurf, Cline, and OpenCode
- **Pluggable metaphors** — golf, tennis, baseball, gaming, D&D, matrix, or agile terminology — same math, your vocabulary
- **Zero infrastructure** — SQLite store, CLI-driven, lives in your repo

## Quick Start

```bash
# Install
npm install -g @slope-dev/slope

# Initialize (auto-detects your AI coding tool)
slope init

# View your handicap card
slope card
```

> Installed locally? Use `npx slope` instead.

## Core Concepts

Every sprint has a **par** (expected baseline from ticket count: 1–2 → par 3, 3–4 → par 4, 5+ → par 5). Each ticket is a **shot** with an approach complexity (**club**: driver → putter) and an outcome (**result**: in_the_hole → missed). Over time, your **handicap card** shows rolling averages, miss patterns, and trend direction.

| Concept | What it measures |
|---------|-----------------|
| Par     | Expected sprint baseline (from ticket count) |
| Slope   | Difficulty modifier (cross-package, migrations, etc.) |
| Club    | Approach complexity (driver = risky, putter = trivial) |
| Result  | Outcome (in_the_hole = perfect, missed_long = over-engineered) |
| Hazard  | Gotchas encountered (bunker, water, rough, trees) |
| Handicap| Rolling performance trend across sprints |

## Features

### Scoring & Analysis
- **Scorecards** — structured JSON retros with shot-by-shot tracking
- **Handicap card** — rolling windows (last 5, 10, all-time) with trend arrows
- **Dispersion analysis** — miss pattern heatmaps and area performance
- **HTML reports** — self-contained visual dashboards with charts
- **Auto-card** — generate draft scorecards from git commits + CI signals

### Planning & Workflow
- **Briefings** — pre-sprint hazard index, nutrition alerts, filtered gotchas
- **Sessions & claims** — track who's working on what, detect conflicts
- **Roadmap tools** — validate dependencies, find critical path, parallel opportunities
- **Club advisor** — complexity recommendations based on historical performance

### AI Agent Guidance
- **16 guard hooks** — real-time hints injected into agent context
- **MCP server** — search API functions and execute SLOPE commands from your agent
- **5 platform adapters** — Claude Code, Cursor, Windsurf, Cline, OpenCode
- **Codebase map** — auto-generated index for agent navigation

### Team & Multi-Developer
- **Team handicap** — aggregate performance across team members
- **Leaderboard** — multi-developer performance ranking
- **Standups** — structured standup reports with handoff tracking
- **Escalation** — severity-based alerts for blocked work

## Platform Compatibility

| Platform    | Rules | Hooks | MCP | Session Tracking |
|-------------|-------|-------|-----|------------------|
| Claude Code | .claude/rules/ | .claude/hooks/ | .mcp.json | Auto (hooks) |
| Cursor      | .cursor/rules/ | .cursor/hooks/ | .cursor/mcp.json | Auto (hooks) |
| Windsurf    | .windsurf/rules/ | .windsurf/hooks/ | .windsurf/mcp.json | Auto (hooks) |
| Cline       | .clinerules/ | .clinerules/hooks/ | Manual setup | Auto (hooks) |
| OpenCode    | AGENTS.md | Plugin | opencode.json | Auto (plugin) |

```bash
slope init --claude-code   # or --cursor, --windsurf, --cline, --opencode, --all
```

## CLI Quick Reference

### Setup & Config

| Command | Description |
|---------|-------------|
| `slope init` | Initialize SLOPE (auto-detects platform) |
| `slope init --interactive --smart` | Guided setup with repo analysis |
| `slope hook add --level=full` | Install all guidance hooks |
| `slope map` | Generate/update codebase map |

### Scoring

| Command | Description |
|---------|-------------|
| `slope card` | Display handicap card |
| `slope validate [path]` | Validate scorecard(s) |
| `slope review [path]` | Generate sprint review markdown |
| `slope report --html` | Generate HTML performance report |
| `slope auto-card --sprint=N` | Generate scorecard from git + CI |
| `slope dashboard` | Live local performance dashboard |

### Planning

| Command | Description |
|---------|-------------|
| `slope briefing` | Pre-sprint briefing with hazards and gotchas |
| `slope plan --complexity=<level>` | Club recommendation + training plan |
| `slope next` | Show next sprint number |
| `slope roadmap validate` | Validate roadmap dependencies |

### Sessions

| Command | Description |
|---------|-------------|
| `slope session start\|end\|list` | Manage live sessions |
| `slope claim --target=<t>` | Claim a ticket or area |
| `slope release --target=<t>` | Release a claim |
| `slope status` | Sprint status + conflicts |

### Maintenance

| Command | Description |
|---------|-------------|
| `slope extract --file=<path>` | Extract events into store |
| `slope distill` | Promote patterns to common issues |
| `slope store health\|backup\|restore` | Store diagnostics and management |
| `slope flows init\|list\|check` | Manage user flow definitions |

## Metaphors

7 built-in metaphors — same scoring math, different vocabulary:

| Metaphor | Sprint | Ticket | Perfect | On Target |
|----------|--------|--------|---------|-----------|
| **Golf** (default) | Sprint | Shot | Hole-in-One | Par |
| **Tennis** | Set | Point | Ace | Deuce |
| **Baseball** | Inning | At-Bat | Home Run | Single |
| **Gaming** | Level | Quest | S-Rank | B-Rank |
| **D&D** | Quest | Encounter | Natural 20 | DC Met |
| **Matrix** | Simulation | Anomaly | The One | Stable |
| **Agile** | Sprint | Story | Shipped | Accepted |

```bash
slope init --metaphor=gaming          # Set during init
slope card --metaphor=tennis          # Override per-command
```

## Documentation

- **[Getting Started](docs/getting-started.md)** — installation, setup, core concepts, platform guides
- **[Tutorial: First Sprint](docs/tutorial-first-sprint.md)** — end-to-end walkthrough with example scorecard
- **[Framework Reference](docs/framework.md)** — full scoring system specification
- **[Dashboard Guide](docs/guides/dashboard.md)** — live performance dashboard
- **[Multi-Developer Guide](docs/guides/multi-developer.md)** — team handicap and leaderboard
- **[Cline Setup](docs/guides/cline-setup.md)** — Cline-specific configuration
- **[Scorecard Template](docs/scorecard-template.md)** — field-by-field reference

## Core API

```typescript
import {
  buildScorecard,
  validateScorecard,
  computeHandicapCard,
  computeDispersion,
  formatSprintReview,
  buildReportData,
  generateHtmlReport,
  loadScorecards,
  getMetaphor,
} from '@slope-dev/slope';
```

Published as [`@slope-dev/slope`](https://www.npmjs.com/package/@slope-dev/slope) — includes the scoring engine, SQLite store, CLI (30 commands), and MCP server.

## Contributing

1. Fork and clone
2. `pnpm install && pnpm build`
3. `pnpm test` — runs all tests
4. `pnpm typecheck` — type checking
5. Create a feature branch, make changes, submit a PR

## License

MIT
