# SLOPE

**Sprint Lifecycle & Operational Performance Engine**

A golf-inspired framework for measuring and improving sprint execution quality. Replace subjective retrospectives with objective, quantifiable metrics.

## Quick Start

```bash
# Install
npm install -g @slope-dev/cli

# Initialize in your project
slope init

# View your handicap card
slope card

# Validate a scorecard
slope validate docs/retros/sprint-1.json

# Get a pre-round briefing
slope briefing
```

## What is SLOPE?

SLOPE maps sprint execution to golf scoring. Every sprint is a "hole" with a par (expected ticket count), every ticket is a "shot" with a club (approach complexity) and result (outcome quality).

Over time, your **handicap** reveals patterns: Do you over-engineer? Under-scope? Pick the wrong approach? SLOPE's dispersion analysis and training recommendations help you improve systematically.

See [docs/framework.md](docs/framework.md) for the full framework.

## Packages

| Package | Description |
|---------|-------------|
| [`@slope-dev/core`](packages/core) | Core scoring engine — types, handicap, builder, validation, advisor, formatter, briefing |
| [`@slope-dev/cli`](packages/cli) | CLI tool — `slope init`, `card`, `validate`, `review`, `briefing`, `plan`, `classify` |

## Core API

```typescript
import {
  buildScorecard,
  validateScorecard,
  computeHandicapCard,
  formatSprintReview,
  recommendClub,
  classifyShot,
  generateTrainingPlan,
} from '@slope-dev/core';

// Build a scorecard from shots — stats, score, and label auto-computed
const card = buildScorecard({
  sprint_number: 1,
  theme: 'My First Sprint',
  par: 3,
  slope: 0,
  date: '2026-02-20',
  shots: [
    { ticket_key: 'S1-1', title: 'Setup', club: 'short_iron', result: 'green', hazards: [] },
    { ticket_key: 'S1-2', title: 'Feature', club: 'short_iron', result: 'in_the_hole', hazards: [] },
    { ticket_key: 'S1-3', title: 'Tests', club: 'wedge', result: 'green', hazards: [] },
  ],
});

// Validate
const result = validateScorecard(card);
console.log(result.valid); // true

// Handicap over time
const handicap = computeHandicapCard([card]);
console.log(handicap.all_time.handicap); // 0.0

// Club recommendation for next ticket
const rec = recommendClub({
  ticketComplexity: 'medium',
  scorecards: [card],
});
console.log(rec.club); // 'short_iron'
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `slope init` | Create `.slope/` directory with config and example scorecard |
| `slope init --cursor` | Also install Cursor IDE rules (`.cursor/rules/`) |
| `slope init --claude-code` | Also install Claude Code rules and hooks |
| `slope init --generic` | Install a provider-agnostic SLOPE checklist |
| `slope card` | Display handicap card with rolling windows |
| `slope validate [path]` | Validate scorecard(s) — runs all if no path given |
| `slope review [path]` | Format sprint review as markdown |
| `slope review --plain` | Non-technical sprint review |
| `slope briefing` | Pre-round briefing (handicap + hazards + gotchas) |
| `slope briefing --categories=testing` | Filter briefing by category |
| `slope plan --complexity=medium` | Get club recommendation + training plan |
| `slope classify --scope=... --modified=... --tests=pass --reverts=0` | Classify a shot |
| `slope tournament --id=M-09 --sprints=197..202` | Build tournament review from sprint range |
| `slope auto-card --sprint=N [--since=date]` | Generate scorecard from git commits |
| `slope next` | Show next sprint number (auto-detected from scorecards) |

## Configuration

After `slope init`, configure `.slope/config.json`:

```json
{
  "scorecardDir": "docs/retros",
  "scorecardPattern": "sprint-*.json",
  "minSprint": 1,
  "commonIssuesPath": ".slope/common-issues.json",
  "sessionsPath": ".slope/sessions.json"
}
```

## Agent / IDE Integration

SLOPE ships provider-specific templates so your AI coding assistant follows sprint discipline automatically.

### Cursor

```bash
slope init --cursor
```

Installs `.cursor/rules/` with SLOPE-aware `.mdc` rule files:
- `slope-sprint-checklist.mdc` — Pre-Round, Post-Shot, Post-Hole routines
- `slope-commit-discipline.mdc` — Commit/push triggers
- `slope-review-loop.mdc` — Architect review tiers

### Claude Code

```bash
slope init --claude-code
```

Installs `.claude/rules/` and `.claude/hooks/`:
- `sprint-checklist.md`, `commit-discipline.md`, `review-loop.md`
- `pre-merge-check.sh` — Validates scorecard before merge

### Generic / MCP

```bash
slope init --generic
```

Installs a standalone `SLOPE-CHECKLIST.md` in your project root for any agent or manual use.

## License

MIT
