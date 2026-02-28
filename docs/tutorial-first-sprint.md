# Tutorial: Your First Sprint with SLOPE

This tutorial walks you through a complete sprint cycle — from setup to scoring to reviewing performance. By the end, you'll have a scorecard, a handicap card, and a workflow you can repeat for every sprint.

## Prerequisites

- Node.js 18+
- A project repository (any language)
- SLOPE installed: `npm install -g @slope-dev/slope`

## Part 1: Setup

### Initialize SLOPE

```bash
cd your-project
slope init
```

If SLOPE detects your AI coding tool (Claude Code, Cursor, etc.), it installs platform-specific rules and MCP configuration automatically. Otherwise, specify your platform:

```bash
slope init --claude-code    # or --cursor, --windsurf, --cline, --opencode
```

For a guided setup with repo analysis:

```bash
slope init --interactive --smart
```

This prompts for project name, metaphor, team members, and vision — then scans your repo to generate a tailored first sprint plan.

### Understand Par and Slope

**Par** is the expected baseline for your sprint, based on ticket count:

| Tickets | Par |
|---------|-----|
| 1–2     | 3   |
| 3–4     | 4   |
| 5+      | 5   |

**Slope** measures difficulty. Count how many of these factors apply:

- `cross_package` — changes span multiple packages
- `schema_migration` — database migrations involved
- `new_area` — first time in this code area
- `external_dep` — external service or new dependency
- `concurrent_agents` — multiple agents working simultaneously

For a 4-ticket sprint with one cross-package change: par = 4, slope = 1.

## Part 2: Planning

### Select Clubs

Before coding, declare an approach complexity ("club") for each ticket:

| Club       | Risk    | When to use                      |
|------------|---------|----------------------------------|
| Driver     | High    | New infra, architectural changes |
| Long iron  | Med-high| Multi-package, schema+API+UI     |
| Short iron | Medium  | Standard single-package work     |
| Wedge      | Low     | Config, docs, small fixes        |
| Putter     | Minimal | One-line fixes, typos            |

Example sprint plan — "User Authentication" (4 tickets, par 4, slope 1):

| Ticket | Title              | Club       |
|--------|--------------------|------------|
| S5-1   | Add login endpoint | Short iron |
| S5-2   | OAuth integration  | Long iron  |
| S5-3   | Session management | Short iron |
| S5-4   | Auth tests         | Wedge      |

### Run a Briefing

```bash
slope briefing
```

The briefing shows:
- **Handicap snapshot** — your current performance trend
- **Hazard index** — known issues from recent sprints
- **Nutrition alerts** — process health indicators
- **Common gotchas** — recurring patterns filtered for relevance

Filter for your sprint's work area:

```bash
slope briefing --categories=api,testing
slope briefing --keywords=auth,oauth
```

## Part 3: During the Sprint

### Start a Session

```bash
slope session start --role=primary
```

This creates a tracked session in the SQLite store. If you're using Claude Code or OpenCode with hooks installed, sessions start automatically.

### Claim Tickets

```bash
slope claim --target=S5-1
slope status                # See active claims and conflicts
```

### Work and Commit

Follow commit discipline — commit after each file, feature, or bug fix. Push after each ticket and every 30 minutes:

```bash
# After completing S5-1
git add -A && git commit -m "feat(S5-1): add login endpoint"
git push

# Release the claim
slope release --target=S5-1

# Move to next ticket
slope claim --target=S5-2
```

### Score Each Ticket as You Go

As you finish each ticket, note:
1. **Result** — did it land perfectly (`in_the_hole`), cleanly (`green`), or miss?
2. **Hazards** — any gotchas? Types: `bunker` (design), `water` (security), `rough` (code quality), `trees` (UX)
3. **Penalties** — broken tests, reverts, CI failures

### End the Session

```bash
slope session end
```

## Part 4: Scoring

### Create the Scorecard

After all tickets are done, create a scorecard JSON file. Here's a complete example for our "User Authentication" sprint:

```json
{
  "sprint_number": 5,
  "theme": "User Authentication",
  "par": 4,
  "slope": 1,
  "score": 5,
  "score_label": "bogey",
  "date": "2026-02-28",
  "shots": [
    {
      "ticket_key": "S5-1",
      "title": "Add login endpoint",
      "club": "short_iron",
      "result": "in_the_hole",
      "hazards": [],
      "notes": "Clean implementation, existing patterns to follow"
    },
    {
      "ticket_key": "S5-2",
      "title": "OAuth integration",
      "club": "long_iron",
      "result": "missed_long",
      "hazards": [
        { "type": "bunker", "description": "OAuth provider docs were outdated" },
        { "type": "rough", "description": "Token refresh logic needed 3 iterations" }
      ],
      "notes": "Over-engineered the token storage — should have started simpler"
    },
    {
      "ticket_key": "S5-3",
      "title": "Session management",
      "club": "short_iron",
      "result": "green",
      "hazards": [],
      "notes": "Redis session store worked first try"
    },
    {
      "ticket_key": "S5-4",
      "title": "Auth tests",
      "club": "wedge",
      "result": "green",
      "hazards": [
        { "type": "rough", "description": "Mock OAuth server setup was fiddly" }
      ]
    }
  ],
  "conditions": [
    { "type": "wind", "description": "OAuth provider had intermittent outages" }
  ],
  "special_plays": [],
  "stats": {
    "fairways_hit": 4,
    "fairways_total": 4,
    "greens_in_regulation": 3,
    "greens_total": 4,
    "putts": 0,
    "penalties": 1,
    "hazards_hit": 3,
    "hazard_penalties": 0,
    "miss_directions": { "long": 1, "short": 0, "left": 0, "right": 0 }
  },
  "yardage_book_updates": [
    "OAuth integrations: start with minimal token storage, iterate"
  ],
  "bunker_locations": [
    "OAuth provider documentation frequently outdated — verify against actual API"
  ],
  "course_management_notes": [
    "The OAuth ticket should have been a driver, not a long iron",
    "Session management was straightforward — good club selection there"
  ]
}
```

Save this as `docs/retros/sprint-5.json`.

> **Tip:** You can use `slope auto-card --sprint=5` to generate a draft scorecard from git commits and CI signals, then refine it manually.

### Validate

```bash
slope validate docs/retros/sprint-5.json
```

Expected output:

```
Validating docs/retros/sprint-5.json...
  ✓ Sprint 5 "User Authentication" — bogey (+1)
    4 shots, 3 hazards, 1 penalty
    Miss pattern: 1 long
```

Fix any validation errors before proceeding.

### Generate the Review

```bash
slope review docs/retros/sprint-5.json
```

This produces a markdown review with:
- Score summary (bogey — 1 over par)
- Shot-by-shot analysis
- Hazard summary
- Miss pattern analysis
- Recommendations for next sprint

### Check for Implementation Reviews

```bash
slope review recommend
```

If reviews are recommended (architect, code, security, etc.), conduct them and record findings:

```bash
slope review findings add --type=code --ticket=S5-2 --severity=medium \
  --description="Token refresh should use exponential backoff"
slope review amend --sprint=5
```

## Part 5: Performance

### View Your Handicap Card

```bash
slope card
```

Output:

```
SLOPE Handicap Card
═══════════════════

         Last 5    Last 10   All-Time
Avg       +0.6      +0.4      +0.3
Best       -1        -1        -1
Worst      +2        +2        +2
Trend      →         ↑         ↑

Miss Pattern (last 10):
  Long:  3  ████
  Short: 1  █
  Left:  1  █
  Right: 0

Hazard Index:
  Rough:  5  █████
  Bunker: 3  ███
  Water:  1  █
```

The handicap card reveals:
- **Trend direction** — are you improving (↑), stable (→), or declining (↓)?
- **Miss patterns** — do you consistently over-engineer (long) or under-scope (short)?
- **Hazard frequency** — which types of gotchas hit you most?

### Generate an HTML Report

```bash
slope report --html --output=slope-report.html
```

Opens a self-contained HTML dashboard with charts for handicap trends, dispersion patterns, area performance, and sprint-by-sprint breakdowns.

### Interactive Dashboard

```bash
slope dashboard
```

Launches a live local dashboard that auto-refreshes as you add scorecards.

## Part 6: Planning Sprint 2

### Distill Learnings

After reviewing your scorecard, promote recurring patterns to common issues:

```bash
slope distill
```

This scans your sprint data for patterns and adds them to `.slope/common-issues.json`, so they appear in future briefings.

### Brief for Next Sprint

```bash
slope briefing --sprint=6
```

The briefing now includes hazards and gotchas from Sprint 5, so you avoid the same mistakes.

### Install Guard Hooks

If you haven't already, install guidance hooks for real-time hints during coding:

```bash
slope hook add --level=full
```

Guards will:
- Remind you to check the codebase map before exploring
- Warn about known hazards in files you're editing
- Nudge you to commit and push regularly
- Alert you when editing outside your claimed scope

## Appendix: Scorecard JSON Schema

### Required Fields

| Field            | Type     | Description                                    |
|------------------|----------|------------------------------------------------|
| `sprint_number`  | number   | Sprint identifier                              |
| `theme`          | string   | Sprint theme/name                              |
| `par`            | number   | Expected baseline (3, 4, or 5)                 |
| `slope`          | number   | Difficulty rating (count of slope factors)      |
| `score`          | number   | Actual score (tickets + penalties)              |
| `score_label`    | string   | eagle/birdie/par/bogey/double_bogey/triple_plus |
| `date`           | string   | ISO date (YYYY-MM-DD)                          |
| `shots`          | array    | One entry per ticket (see below)               |
| `conditions`     | array    | External factors                               |
| `special_plays`  | array    | Mulligans, gimmes, provisionals                |
| `stats`          | object   | Computed statistics (see below)                |

### Shot Object

| Field        | Type   | Description                              |
|--------------|--------|------------------------------------------|
| `ticket_key` | string | Ticket identifier (e.g., "S5-1")        |
| `title`      | string | Ticket title                             |
| `club`       | string | driver/long_iron/short_iron/wedge/putter |
| `result`     | string | in_the_hole/green/fairway/missed_*       |
| `hazards`    | array  | `[{ type, description }]`               |
| `notes`      | string | Optional notes                           |

### Hazard Types

| Type     | Meaning                                |
|----------|----------------------------------------|
| `bunker` | Design/architecture issues             |
| `water`  | Security vulnerabilities               |
| `rough`  | Code quality issues                    |
| `trees`  | UX/usability problems                  |

### Stats Object

| Field                 | Type   | Description                      |
|-----------------------|--------|----------------------------------|
| `fairways_hit`        | number | Tickets with clean starts        |
| `fairways_total`      | number | Total tickets                    |
| `greens_in_regulation`| number | Tickets completed correctly      |
| `greens_total`        | number | Total tickets                    |
| `putts`               | number | Minor fix-up commits             |
| `penalties`           | number | Reverts, broken tests, CI fails  |
| `hazards_hit`         | number | Total hazards encountered        |
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
