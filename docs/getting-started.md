# Getting Started with SLOPE

SLOPE (Sprint Lifecycle & Operational Performance Engine) replaces subjective sprint retrospectives with quantified metrics. Track every ticket's approach, outcome, and hazards — then use rolling analytics to spot patterns and improve.

## Installation

```bash
# Install globally
npm install -g @slope-dev/slope

# Or install locally in your project
npm install @slope-dev/slope
```

> If installed locally, prefix commands with `npx` — e.g., `npx slope card`.

## Quick Start

```bash
# 1. Initialize in your project (auto-detects your AI coding tool)
slope init

# 2. View your handicap card
slope card

# 3. Get a pre-sprint briefing
slope briefing
```

That's it. SLOPE creates a `.slope/` directory with config, a SQLite store, an example scorecard, and a starter roadmap. If it detects Claude Code, Cursor, Windsurf, Cline, or OpenCode, it installs platform-specific rules and MCP configuration automatically.

## Core Concepts

SLOPE uses a scoring system (golf by default — [other metaphors available](#metaphors)) to quantify sprint execution:

### Par

Par is the expected baseline, determined by ticket count:

| Tickets | Par |
|---------|-----|
| 1–2     | 3   |
| 3–4     | 4   |
| 5+      | 5   |

### Slope (Difficulty)

Slope factors increase expected difficulty. Each adds +1:

- **cross_package** — changes span multiple packages
- **schema_migration** — database migrations involved
- **new_area** — first time touching this code area
- **external_dep** — external service or new dependency
- **concurrent_agents** — multiple agents working simultaneously

### Clubs (Approach Complexity)

Before each ticket, declare your approach:

| Club       | When to use                        |
|------------|------------------------------------|
| Driver     | New infra, architectural changes   |
| Long iron  | Multi-package, schema+API+UI       |
| Short iron | Standard single-package work       |
| Wedge      | Config, docs, small fixes          |
| Putter     | One-line fixes, typos              |

### Shot Results

After completing a ticket, record the outcome:

| Result       | Meaning                              |
|--------------|--------------------------------------|
| in_the_hole  | Perfect execution                    |
| green        | Completed with minor adjustments     |
| fairway      | Clean start, on the right path       |
| missed_long  | Over-engineered / scope creep        |
| missed_short | Under-scoped / missed requirements   |
| missed_left  | Wrong approach / architectural miss  |
| missed_right | Spec drift / implementation diverged |

### Handicap

Your handicap card (`slope card`) shows rolling performance windows (last 5, 10, and all-time sprints), miss patterns, and trend direction. A lower score relative to par means better execution.

For the full framework reference, see [framework.md](framework.md).

## Platform Setup

### Claude Code

```bash
slope init --claude-code
```

Installs:
- `.claude/rules/` — sprint checklist, commit discipline, review loop, codebase context
- `.claude/hooks/` — session lifecycle hooks
- `.mcp.json` — SLOPE MCP server (search + execute tools)
- `CLAUDE.md` — project context

**After install:** Restart Claude Code to load the MCP server.

### Cursor

```bash
slope init --cursor
```

Installs:
- `.cursor/rules/` — SLOPE methodology rules (`.mdc` format)
- `.cursor/hooks/` — session lifecycle hooks
- `.cursor/mcp.json` — SLOPE MCP server
- `.cursorrules` — project context

### Windsurf

```bash
slope init --windsurf
```

Installs:
- `.windsurf/rules/` — SLOPE methodology rules (`.mdc` format)
- `.windsurf/hooks/` — session lifecycle hooks
- `.windsurf/mcp.json` — SLOPE MCP server
- `.windsurfrules` — project context

### Cline

```bash
slope init --cline
```

Installs:
- `.clinerules/` — SLOPE methodology rules (`.md` format)
- `.clinerules/hooks/` — session lifecycle hooks
- `.clinerules/slope-context.md` — project context with MCP instructions

**After install:** Add the SLOPE MCP server manually via Cline settings in VS Code. See [Cline setup guide](guides/cline-setup.md).

### OpenCode

```bash
slope init --opencode
```

Installs:
- `AGENTS.md` — project context (OpenCode reads this format)
- `opencode.json` — SLOPE MCP server
- `.opencode/plugins/slope-plugin.ts` — session lifecycle plugin

### All Platforms

```bash
slope init --all
```

Installs for Claude Code, Cursor, Windsurf, and OpenCode simultaneously.

### Smart Init

```bash
slope init --interactive --smart
```

Runs repo analysis (stack detection, file structure, testing framework, git history) and generates a tailored configuration, first sprint plan, and common issues list.

## Common Workflows

### Before a Sprint

```bash
slope briefing                          # Full briefing: handicap, hazards, gotchas
slope briefing --categories=testing,api # Filter by work area
slope briefing --keywords=migration     # Filter by keyword
```

### During a Sprint

```bash
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
