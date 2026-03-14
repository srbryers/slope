# SLOPE

**Sprint Lifecycle & Operational Performance Engine**

Quantified sprint metrics for AI-assisted development. Scorecards, handicap tracking, and real-time agent guidance for Claude Code, Cursor, Windsurf, Cline, OB1, and OpenCode.

## Quick Start

```bash
npm install -g @slope-dev/slope

# Auto-detects your AI coding tool and installs everything
slope init

# Or target a specific platform
slope init --claude-code
slope init --cursor
slope init --windsurf
slope init --cline
slope init --opencode
slope init --all          # Install for all detected platforms
```

> Installed locally? Use `npx slope` instead.

`slope init` auto-detects which AI coding tools are active in your repo and installs platform-specific rules, hooks, guard scripts, and MCP configuration. See [Platform Setup](#platform-setup) for details on what each platform gets.

## What SLOPE Does

SLOPE replaces subjective retrospectives with quantified sprint metrics. Every sprint gets a **scorecard** that tracks each ticket's approach complexity, outcome, and hazards encountered. Over time, your **handicap card** reveals patterns — do you consistently over-engineer? Under-scope? Pick the wrong approach?

For AI-assisted development, SLOPE also provides **real-time agent guidance**: 22 guard hooks that inject context, warnings, and blocks into your coding agent's workflow as you work.

### Core Concepts

| Concept | What it measures |
|---------|-----------------|
| Par | Expected sprint baseline (1-2 tickets = 3, 3-4 = 4, 5+ = 5) |
| Slope | Difficulty modifier (cross-package changes, migrations, new infra) |
| Club | Approach complexity (driver = risky/new, putter = trivial) |
| Result | Outcome (in_the_hole = perfect, missed_long = over-engineered) |
| Hazard | Gotchas encountered (rough = code quality, water = security, bunker = architecture) |
| Handicap | Rolling performance trend across sprints |

> Don't like golf terms? SLOPE supports 7 [pluggable metaphors](#metaphors) — same math, your vocabulary.

## Platform Setup

### Claude Code

The most fully-featured integration. `slope init --claude-code` installs:

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.claude/rules/*.md` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.claude/hooks/slope-guard.sh` | 22 real-time guards (configured in `.claude/settings.json`) |
| Slash commands | `.claude/commands/*.md` | `/start-sprint`, `/post-sprint`, `/review-pr` workflow automation |
| MCP server | `.mcp.json` | `search()` to discover API, `execute()` to run SLOPE commands |
| Project context | `CLAUDE.md` | Project-wide context with SLOPE workflow summary |

**Capabilities:** Context injection, all hook events (PreToolUse, PostToolUse, Stop, PreCompact), slash commands, full MCP integration.

**Slash commands** (Claude Code exclusive):
- `/start-sprint` — pre-sprint setup: briefing, branch creation, sprint state, prior scorecard verification
- `/post-sprint` — scorecard creation, validation, review, common-issues distillation
- `/review-pr` — structured PR review with finding tracking and scorecard amendment

### Cursor

Full guard support with context injection. `slope init --cursor` installs:

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.cursor/rules/*.mdc` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.cursor/hooks/slope-guard.sh` | Guards configured in `.cursor/hooks.json` |
| MCP server | `.cursor/mcp.json` | API search and command execution |
| Project context | `.cursorrules` | Project-wide context |

**Capabilities:** Context injection, PreToolUse/PostToolUse/Stop events, MCP integration.

### Windsurf

Guard support with blocking only (no context injection). `slope init --windsurf` installs:

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.windsurf/rules/*.mdc` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.windsurf/hooks/slope-guard.sh` | Exit-code based guards in `.windsurf/hooks.json` |
| MCP server | `.windsurf/mcp.json` | API search and command execution |
| Project context | `.windsurfrules` | Project-wide context |

**Capabilities:** PreToolUse/PostToolUse events, MCP integration. **Limitation:** Guards can block/allow actions but cannot inject guidance text into agent context.

### Cline

Full guard support with per-event hook scripts. `slope init --cline` installs:

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.clinerules/*.md` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.clinerules/hooks/` | Per-event scripts (PreToolUse, PostToolUse, TaskCancel, PreCompact) |
| MCP instructions | `.clinerules/slope-context.md` | Setup guide for manual MCP configuration |

**Capabilities:** Context injection, all hook events including PreCompact. **Note:** MCP server must be configured manually through the Cline VS Code extension UI — SLOPE cannot auto-install it.

### OB1 (Terminal Caddy)

Guard support with per-event hook scripts. `slope init --ob1` installs:

| Component | Location | Purpose |
|-----------|----------|---------|
| Guard hooks | `.ob1/hooks/` | Per-event scripts (pre_tool, post_tool, post_agent) |
| MCP server | `.ob1/mcp.json` | API search and command execution |

**Capabilities:** Context injection, PreToolUse/PostToolUse/Stop events, MCP integration.

### OpenCode

Plugin-based integration. `slope init --opencode` installs:

| Component | Location | Purpose |
|-----------|----------|---------|
| Plugin | `.opencode/plugins/slope-plugin.ts` | Session lifecycle hooks |
| MCP server | `opencode.json` | API search and command execution |
| Project context | `AGENTS.md` | Project-wide context |

### Platform Capabilities Matrix

| | Claude Code | Cursor | Windsurf | Cline | OB1 | OpenCode |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Context injection | Yes | Yes | -- | Yes | Yes | -- |
| PreToolUse guards | Yes | Yes | Yes | Yes | Yes | -- |
| PostToolUse guards | Yes | Yes | Yes | Yes | Yes | -- |
| Stop/session-end | Yes | Yes | -- | Yes | Yes | Yes |
| PreCompact | Yes | -- | -- | Yes | -- | -- |
| Slash commands | Yes | -- | -- | -- | -- | -- |
| MCP auto-install | Yes | Yes | Yes | Manual | Yes | Yes |
| Rules/context files | Yes | Yes | Yes | Yes | -- | Yes |

## Guard Hooks

Guards are the real-time guidance system. They fire on specific tool calls and inject context, warnings, or blocks into your agent's workflow.

```bash
# Install all guards (auto-detects platform)
slope hook add --level=full

# Or specify the harness explicitly
slope hook add --level=full --harness=cursor
```

### What Guards Do

| Guard | Fires on | What it does |
|-------|----------|-------------|
| `explore` | Read/Glob/Grep/Edit/Write | Suggests checking codebase map; blocks edits when map is 31+ commits stale |
| `hazard` | Edit/Write | Warns about known issues in areas being edited |
| `sprint-completion` | `gh pr create` / session end | Blocks PR without scorecard; blocks session end with incomplete gates |
| `commit-nudge` | Edit/Write | Nudges to commit after prolonged editing |
| `push-nudge` | Bash (git commit) | Nudges to push when unpushed commits pile up |
| `scope-drift` | Edit/Write | Warns when editing files outside claimed ticket scope |
| `subagent-gate` | Agent | Enforces model selection on Explore/Plan subagents |
| `branch-before-commit` | Bash (git commit) | Blocks commits directly on main/master |
| `workflow-gate` | ExitPlanMode | Blocks plan exit until review rounds complete |
| `version-check` | Bash (git push) | Blocks push when package versions haven't been bumped |
| `stop-check` | Session end | Warns about uncommitted/unpushed work |
| `next-action` | Session end | Suggests next actions before session ends |

Plus 10 more for review workflows, transcript recording, worktree safety, and flow staleness detection. Run `slope guard list` to see all available guards.

## MCP Server

The SLOPE MCP server gives your agent direct access to the scoring engine:

```bash
# Discover all available API functions
search({})

# Search for specific functionality
search({ query: 'handicap' })
search({ module: 'map' })          # Get the codebase map

# Execute SLOPE code in a sandbox
execute({ code: 'return computeHandicapCard(loadScorecards())' })
```

The MCP server is auto-configured during `slope init` for all platforms except Cline (manual setup required).

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
| `slope auto-card --sprint=N` | Generate scorecard from git + CI signals |
| `slope report --html` | Generate HTML performance report |
| `slope dashboard` | Live local performance dashboard |

### Planning

| Command | Description |
|---------|-------------|
| `slope briefing` | Pre-sprint hazard index, nutrition alerts, filtered gotchas |
| `slope plan --complexity=<level>` | Club recommendation + training plan |
| `slope next` | Show next sprint number |
| `slope roadmap validate` | Validate roadmap dependencies and sprint status |

### Review & Findings

| Command | Description |
|---------|-------------|
| `slope review recommend` | Which review types to run based on sprint characteristics |
| `slope review findings add` | Record a review finding |
| `slope review amend` | Inject findings as hazards into scorecard |
| `slope review defer --from=N --to=M` | Defer a finding to a future sprint |
| `slope review deferred --sprint=N` | List deferred findings targeting a sprint |
| `slope review resolve --id=<uuid>` | Mark a deferred finding as resolved |

### Sessions

| Command | Description |
|---------|-------------|
| `slope session start\|end\|list` | Manage live sessions |
| `slope claim --target=<t>` | Claim a ticket or area |
| `slope status` | Sprint status + conflicts |
| `slope sprint start --number=N` | Initialize sprint state with gate tracking |

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

## Core API

```typescript
import {
  buildScorecard,
  validateScorecard,
  computeHandicapCard,
  computeDispersion,
  formatSprintReview,
  loadScorecards,
  getMetaphor,
  createDeferred,
  listDeferred,
} from '@slope-dev/slope';
```

Published as [`@slope-dev/slope`](https://www.npmjs.com/package/@slope-dev/slope).

## Documentation

- **[Getting Started](docs/getting-started.md)** — installation, setup, core concepts
- **[Tutorial: First Sprint](docs/tutorial-first-sprint.md)** — end-to-end walkthrough
- **[Framework Reference](docs/framework.md)** — full scoring system specification
- **[Dashboard Guide](docs/guides/dashboard.md)** — live performance dashboard
- **[Multi-Developer Guide](docs/guides/multi-developer.md)** — team handicap and leaderboard
- **[Cline Setup](docs/guides/cline-setup.md)** — Cline-specific MCP configuration
- **[Scorecard Template](docs/scorecard-template.md)** — field-by-field reference

## Contributing

1. Fork and clone
2. `pnpm install && pnpm build`
3. `pnpm test` — runs all tests
4. `pnpm typecheck` — type checking
5. Create a feature branch, make changes, submit a PR

## License

MIT
