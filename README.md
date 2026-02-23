# SLOPE

**Sprint Lifecycle & Operational Performance Engine**

A framework for measuring and improving sprint execution quality. Replace subjective retrospectives with objective, quantifiable metrics. Works with Claude Code, Cursor, and OpenCode.

## Quick Start

```bash
# Install globally (makes `slope` available everywhere)
npm install -g @slope-dev/slope

# Or install locally in your project and use npx
npm install @slope-dev/slope
npx slope init

# Initialize in your project (auto-detects your AI tool)
slope init

# Or specify your platform
slope init --claude-code
slope init --cursor
slope init --opencode

# View your handicap card
slope card

# Get a pre-sprint briefing
slope briefing

# Generate an HTML performance report
slope report --html
```

> **Note:** If installed locally (without `-g`), prefix commands with `npx` — e.g., `npx slope card`.

## What is SLOPE?

SLOPE maps sprint execution to a scoring metaphor. Every sprint has a **par** (expected ticket count), every ticket is a **shot** with an approach complexity and outcome. Over time, your **handicap** reveals patterns: Do you over-engineer? Under-scope? Pick the wrong approach?

SLOPE provides:
- **Scorecards** — structured sprint retros with quantified outcomes
- **Handicap tracking** — rolling performance windows (last 5, 10, all-time)
- **Dispersion analysis** — miss pattern detection and systemic issue identification
- **Training recommendations** — data-driven improvement suggestions
- **Agent guidance hooks** — real-time hints for AI coding agents
- **HTML reports** — self-contained visual performance dashboards
- **Multi-platform support** — Claude Code, Cursor, OpenCode

## Metaphors

SLOPE ships with 6 built-in metaphors. The scoring math is identical — only the terminology changes.

| Metaphor | Sprint | Ticket | Perfect | Par | Miss |
|----------|--------|--------|---------|-----|------|
| **Golf** (default) | Sprint | Shot | Hole-in-One | Par | Missed Long/Short/Left/Right |
| **Tennis** | Set | Point | Ace | Deuce | Wide/Net/Long/Out |
| **Baseball** | Inning | At-Bat | Home Run | Single | Foul/Strike/Pop/Ground |
| **Gaming** | Level | Quest | S-Rank | B-Rank | Over-leveled/Under-leveled/Wrong Path/Side-tracked |
| **D&D** | Quest | Encounter | Natural 20 | DC Met | Fumble/Misfire/Detour/Distraction |
| **Matrix** | Simulation | Anomaly | The One | Stable | Overclocked/Underclocked/Drift/Noise |

Configure in `.slope/config.json`:

```json
{ "metaphor": "gaming" }
```

Or per-command: `slope review --metaphor=tennis`

## Package

Published as a single package: [`@slope-dev/slope`](https://www.npmjs.com/package/@slope-dev/slope)

Includes the core scoring engine, SQLite store, CLI (22 commands), and MCP server.

## CLI Commands

### Scoring & Analysis

| Command | Description |
|---------|-------------|
| `slope card` | Display handicap card with rolling windows |
| `slope validate [path]` | Validate scorecard(s) |
| `slope review [path] [--plain] [--metaphor=id]` | Format sprint review as markdown |
| `slope report --html [--output=path] [--metaphor=id]` | Generate HTML performance report |
| `slope tournament --id=<id> --sprints=N..M` | Build tournament review from sprint range |
| `slope auto-card --sprint=N [--ci=path]` | Generate scorecard from git + CI signals |

### Planning & Guidance

| Command | Description |
|---------|-------------|
| `slope briefing [--sprint=N] [--categories=...] [--keywords=...]` | Pre-sprint briefing |
| `slope plan --complexity=<level>` | Club recommendation + training plan |
| `slope classify --scope=... --modified=... --tests=pass` | Classify a shot from execution trace |
| `slope next` | Show next sprint number |
| `slope roadmap validate\|review\|status\|show` | Strategic planning tools |

### Sessions & Claims

| Command | Description |
|---------|-------------|
| `slope session start\|end\|heartbeat\|list` | Manage live sessions |
| `slope claim --target=<t> [--scope=area] [--force]` | Claim a ticket or area |
| `slope release --id=<id>` | Release a claim |
| `slope status [--sprint=N]` | Show sprint course status + conflicts |

### Agent Hooks

| Command | Description |
|---------|-------------|
| `slope hook add\|remove\|list\|show` | Manage lifecycle hooks |
| `slope hook add --level=full` | Install all guidance hooks |
| `slope guard list\|enable\|disable` | Manage guard activation |
| `slope guard <name>` | Run a guard handler (stdin/stdout) |

### Setup

| Command | Description |
|---------|-------------|
| `slope init` | Create `.slope/` directory with config |
| `slope init --claude-code` | Install Claude Code rules, hooks, MCP config |
| `slope init --cursor` | Install Cursor rules + MCP config |
| `slope init --opencode` | Install OpenCode AGENTS.md + plugin |
| `slope init --all` | Install for all detected platforms |
| `slope extract --file=<path>` | Extract events into SLOPE store |
| `slope distill [--auto]` | Promote event patterns to common issues |

## Platform Setup

### Claude Code

```bash
slope init --claude-code
```

Installs:
- `.claude/rules/` — Sprint checklist, commit discipline, review loop
- `.claude/hooks/` — Guard dispatcher for real-time guidance
- `.mcp.json` — SLOPE MCP server config
- `CLAUDE.md` — Project context

### Cursor

```bash
slope init --cursor
```

Installs:
- `.cursor/rules/` — SLOPE methodology rules
- `.cursor/mcp.json` — MCP server config

### OpenCode

```bash
slope init --opencode
```

Installs:
- `AGENTS.md` — SLOPE methodology (OpenCode reads this format)
- `.opencode/plugins/slope-plugin.ts` — Event capture plugin

## Agent Guidance Hooks

SLOPE can guide AI agents in real-time via hook integration. Six guards provide contextual hints:

| Guard | Trigger | What it does |
|-------|---------|-------------|
| `explore` | Before search/read | Suggests checking codebase index first |
| `hazard` | Before file edit | Warns about known issues in the area |
| `commit-nudge` | After file edit | Nudges commit/push after prolonged editing |
| `scope-drift` | Before file edit | Warns when editing outside claimed scope |
| `compaction` | Before context compact | Saves checkpoint to store |
| `stop-check` | Before session end | Blocks if uncommitted/unpushed work exists |

Install all guards:

```bash
slope hook add --level=full
```

Guards are non-blocking hints (except `stop-check`) — they inject context, never deny actions.

## Configuration

After `slope init`, configure `.slope/config.json`:

```json
{
  "scorecardDir": "docs/retros",
  "scorecardPattern": "sprint-*.json",
  "minSprint": 1,
  "metaphor": "golf",
  "commonIssuesPath": ".slope/common-issues.json",
  "sessionsPath": ".slope/sessions.json",
  "roadmapPath": "docs/backlog/roadmap.json",
  "guidance": {
    "disabled": [],
    "commitInterval": 15,
    "pushInterval": 30
  }
}
```

## Core API

```typescript
import {
  buildScorecard,
  validateScorecard,
  computeHandicapCard,
  computeDispersion,
  formatSprintReview,
  recommendClub,
  classifyShot,
  generateTrainingPlan,
  buildReportData,
  generateHtmlReport,
  getMetaphor,
  loadScorecards,
} from '@slope-dev/slope';

// Build a scorecard
const card = buildScorecard({
  sprint_number: 1,
  theme: 'My First Sprint',
  par: 3,
  slope: 0,
  date: '2026-02-22',
  shots: [
    { ticket_key: 'S1-1', title: 'Setup', club: 'short_iron', result: 'green', hazards: [] },
    { ticket_key: 'S1-2', title: 'Feature', club: 'short_iron', result: 'in_the_hole', hazards: [] },
    { ticket_key: 'S1-3', title: 'Tests', club: 'wedge', result: 'green', hazards: [] },
  ],
});

// Generate HTML report with gaming metaphor
const data = buildReportData([card]);
const gaming = getMetaphor('gaming');
const html = generateHtmlReport(data, gaming);
```

## License

MIT
