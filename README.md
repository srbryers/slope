# SLOPE

**Sprint Lifecycle & Operational Performance Engine**

Quantified sprint metrics for AI-assisted development. Scorecards, handicap tracking, and real-time agent guidance for Claude Code, Cursor, Windsurf, Cline, OB1, and OpenCode.

## Setup

Install SLOPE as a dev dependency in your project:

```bash
npm install --save-dev @slope-dev/slope
```

Then initialize from inside your AI coding tool. Pick your platform below and paste the prompt.

---

### Claude Code

The most fully-featured integration — context injection, guard hooks, slash commands, and MCP.

**Paste this prompt into Claude Code:**

```
Install and initialize SLOPE for this project. Run:

1. npx slope init --claude-code --interactive --smart
2. npx slope hook add --level=full
3. npx slope map

This will create .claude/rules/, .claude/hooks/, .claude/commands/, .mcp.json, and CLAUDE.md.
After init, verify the MCP server works by running the `search` MCP tool with an empty query.
```

**What you get:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.claude/rules/*.md` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.claude/hooks/slope-guard.sh` | 22 real-time guards configured in `.claude/settings.json` |
| Slash commands | `.claude/commands/*.md` | `/start-sprint`, `/post-sprint`, `/review-pr` workflow automation |
| MCP server | `.mcp.json` | `search()` to discover API, `execute()` to run SLOPE commands |
| Project context | `CLAUDE.md` | Project-wide context with SLOPE workflow summary |
| Codebase map | `CODEBASE.md` | Auto-generated index for agent navigation |

**Slash commands** (Claude Code exclusive):
- `/start-sprint` — pre-sprint setup: briefing, branch creation, sprint state, prior scorecard verification
- `/post-sprint` — scorecard creation, validation, review, common-issues distillation
- `/review-pr` — structured PR review with finding tracking and scorecard amendment

---

### Cursor

Full guard support with context injection and MCP.

**Paste this prompt into Cursor:**

```
Install and initialize SLOPE for this project. Run these commands in the terminal:

1. npx slope init --cursor --interactive --smart
2. npx slope hook add --level=full --harness=cursor
3. npx slope map

This will create .cursor/rules/, .cursor/hooks/, .cursor/mcp.json, .cursorrules, and CODEBASE.md.
```

**What you get:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.cursor/rules/*.mdc` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.cursor/hooks/slope-guard.sh` | Guards configured in `.cursor/hooks.json` |
| MCP server | `.cursor/mcp.json` | API search and command execution |
| Project context | `.cursorrules` | Project-wide context |

---

### Windsurf

Guard support with blocking (no context injection).

**Paste this prompt into Windsurf:**

```
Install and initialize SLOPE for this project. Run these commands in the terminal:

1. npx slope init --windsurf --interactive --smart
2. npx slope hook add --level=full --harness=windsurf
3. npx slope map

This will create .windsurf/rules/, .windsurf/hooks/, .windsurf/mcp.json, .windsurfrules, and CODEBASE.md.
```

**What you get:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.windsurf/rules/*.mdc` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.windsurf/hooks/slope-guard.sh` | Exit-code based guards in `.windsurf/hooks.json` |
| MCP server | `.windsurf/mcp.json` | API search and command execution |
| Project context | `.windsurfrules` | Project-wide context |

**Note:** Guards can block/allow actions but cannot inject guidance text into agent context.

---

### Cline

Full guard support with per-event hook scripts. MCP requires manual setup.

**Paste this prompt into Cline:**

```
Install and initialize SLOPE for this project. Run these commands in the terminal:

1. npx slope init --cline --interactive --smart
2. npx slope hook add --level=full --harness=cline
3. npx slope map

This will create .clinerules/, .clinerules/hooks/, and CODEBASE.md.

After init, I need to manually add the MCP server through the Cline VS Code extension.
Read .clinerules/slope-context.md for the MCP configuration instructions.
```

**What you get:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Rules | `.clinerules/*.md` | Sprint checklist, commit discipline, review loop, codebase context |
| Guard hooks | `.clinerules/hooks/` | Per-event scripts (PreToolUse, PostToolUse, TaskCancel, PreCompact) |
| MCP instructions | `.clinerules/slope-context.md` | Setup guide for manual MCP configuration |

**Note:** MCP server must be configured manually through the Cline VS Code extension UI.

---

### OB1

Guard support with per-event hook scripts and MCP.

**Paste this prompt into OB1:**

```
Install and initialize SLOPE for this project. Run these commands:

1. npx slope init --ob1
2. npx slope hook add --level=full --harness=ob1
3. npx slope map

This will create .ob1/hooks/, .ob1/mcp.json, and CODEBASE.md.
```

**What you get:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Guard hooks | `.ob1/hooks/` | Per-event scripts (pre_tool, post_tool, post_agent) |
| MCP server | `.ob1/mcp.json` | API search and command execution |

---

### OpenCode

Plugin-based integration with MCP.

**Paste this prompt into OpenCode:**

```
Install and initialize SLOPE for this project. Run these commands:

1. npx slope init --opencode
2. npx slope map

This will create opencode.json, .opencode/plugins/, AGENTS.md, and CODEBASE.md.
```

**What you get:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Plugin | `.opencode/plugins/slope-plugin.ts` | Session lifecycle hooks |
| MCP server | `opencode.json` | API search and command execution |
| Project context | `AGENTS.md` | Project-wide context |

---

### Platform Capabilities

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

## Guard Hooks

Guards are the real-time guidance system. They fire on specific tool calls and inject context, warnings, or blocks into your agent's workflow. They're installed automatically by `slope hook add --level=full`.

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

Plus 10 more for review workflows, transcript recording, worktree safety, and flow staleness detection. Run `npx slope guard list` to see all available guards.

## MCP Server

The SLOPE MCP server gives your agent direct access to the scoring engine. It's auto-configured during `slope init` for all platforms except Cline.

```
# Discover all available API functions
search({})

# Search for specific functionality
search({ query: 'handicap' })
search({ module: 'map' })          # Get the codebase map

# Execute SLOPE code in a sandbox
execute({ code: 'return computeHandicapCard(loadScorecards())' })
```

## CLI Reference

All commands use `npx slope` when installed locally.

### Setup

| Command | Description |
|---------|-------------|
| `npx slope init` | Initialize SLOPE (auto-detects platform) |
| `npx slope init --interactive --smart` | Guided setup with repo analysis |
| `npx slope hook add --level=full` | Install all guidance hooks |
| `npx slope map` | Generate/update codebase map |

### Scoring

| Command | Description |
|---------|-------------|
| `npx slope card` | Display handicap card |
| `npx slope validate [path]` | Validate scorecard(s) |
| `npx slope review [path]` | Generate sprint review markdown |
| `npx slope auto-card --sprint=N` | Generate scorecard from git + CI signals |
| `npx slope report --html` | Generate HTML performance report |
| `npx slope dashboard` | Live local performance dashboard |

### Planning

| Command | Description |
|---------|-------------|
| `npx slope briefing` | Pre-sprint hazard index, nutrition alerts, filtered gotchas |
| `npx slope plan --complexity=<level>` | Club recommendation + training plan |
| `npx slope next` | Show next sprint number |
| `npx slope roadmap validate` | Validate roadmap dependencies and sprint status |

### Review & Findings

| Command | Description |
|---------|-------------|
| `npx slope review recommend` | Which review types to run based on sprint characteristics |
| `npx slope review findings add` | Record a review finding |
| `npx slope review amend` | Inject findings as hazards into scorecard |
| `npx slope review defer --from=N --to=M` | Defer a finding to a future sprint |
| `npx slope review deferred --sprint=N` | List deferred findings targeting a sprint |
| `npx slope review resolve --id=<uuid>` | Mark a deferred finding as resolved |

### Sessions

| Command | Description |
|---------|-------------|
| `npx slope session start\|end\|list` | Manage live sessions |
| `npx slope claim --target=<t>` | Claim a ticket or area |
| `npx slope status` | Sprint status + conflicts |
| `npx slope sprint start --number=N` | Initialize sprint state with gate tracking |

### Maintenance

| Command | Description |
|---------|-------------|
| `npx slope extract --file=<path>` | Extract events into store |
| `npx slope distill` | Promote patterns to common issues |
| `npx slope store health\|backup\|restore` | Store diagnostics and management |
| `npx slope flows init\|list\|check` | Manage user flow definitions |

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
npx slope init --metaphor=gaming          # Set during init
npx slope card --metaphor=tennis          # Override per-command
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
