# SLOPE — Sprint Lifecycle & Operational Performance Engine

SLOPE is a golf-inspired framework for measuring and improving sprint execution quality. It replaces subjective sprint retrospectives with objective, quantifiable metrics.

## Why Golf?

Golf provides the ideal metaphor for sprint scoring because:

1. **Individual accountability** — Each shot (ticket) has a clear outcome
2. **Course management** — Strategic decisions matter as much as execution
3. **Handicap system** — Tracks improvement over time, adjusts for difficulty
4. **Miss patterns** — Consistent misses reveal systemic issues to fix
5. **Conditions** — External factors are acknowledged, not ignored

## Core Concepts

### Par System

Par is the expected baseline for a sprint, determined by ticket count:

| Tickets | Par |
|---------|-----|
| 1-2 | 3 |
| 3-4 | 4 |
| 5+ | 5 |

### Slope (Difficulty Rating)

Slope factors increase the expected difficulty. Each adds +1:

- **cross_package** — Changes span multiple packages
- **schema_migration** — Database migrations involved
- **new_area** — First time touching this code area
- **external_dep** — External service or new dependency
- **concurrent_agents** — Multiple agents working simultaneously

### Score

`Score = tickets_delivered + penalties`

Penalties are added for reverts, broken tests, and CI failures.

### Score Labels

| Label | vs Par | Meaning |
|-------|--------|---------|
| Eagle | -2 | Well ahead of schedule |
| Birdie | -1 | Ahead of schedule |
| Par | 0 | On schedule |
| Bogey | +1 | Took longer than expected |
| Double bogey | +2 | Significantly over time |
| Triple+ | 3+ | Major overrun |

### Club Selection

Before each ticket, declare your approach complexity:

| Club | Complexity | Risk Level |
|------|-----------|------------|
| Driver | New infra, architectural changes | High |
| Long iron | Multi-package, schema+API+UI | Medium-high |
| Short iron | Standard single-package work | Medium |
| Wedge | Config, docs, small fixes | Low |
| Putter | One-line fixes, typos | Minimal |

### Shot Results

| Result | Meaning |
|--------|---------|
| `in_the_hole` | Perfect execution |
| `green` | Completed with minor adjustments |
| `fairway` | Clean start, on the right path |
| `missed_long` | Over-engineered / scope creep |
| `missed_short` | Under-scoped / missed requirements |
| `missed_left` | Wrong approach / architectural miss |
| `missed_right` | Spec drift / implementation diverged |

## Analysis Tools

### Handicap Card

The handicap card tracks performance over time with rolling windows:

- **Last 5 / Last 10 / All-time** windows
- **Fairway %** — How often you start on the right path
- **GIR (Greens in Regulation)** — How often tickets land correctly
- **Miss pattern** — Which direction you consistently miss

### Dispersion Report

Analyzes shot scatter across all scorecards to identify:
- **Dominant miss direction** — Your most common failure mode
- **Miss rate** — Overall percentage of missed shots
- **Systemic issues** — Patterns requiring structural changes

### Area Performance

Breaks down performance by:
- **Sprint type** — Features vs feedback vs infra
- **Club** — Which complexity levels you handle well
- **Par value** — Performance on different sprint sizes

## Advisor System

### Club Recommendation

Before starting a ticket, get a data-driven approach recommendation:

```bash
slope plan --complexity=medium --areas=migration
```

The advisor checks your historical miss rates for each club and may downgrade your approach if you have a high miss rate at a given complexity level.

### Shot Classification

After completing a ticket, classify the shot from execution data:

```bash
slope classify --scope="a.ts,b.ts" --modified="a.ts,b.ts" --tests=pass --reverts=0
```

### Training Plan

Based on handicap trends and dispersion data, the system generates targeted recommendations:
- Dominant miss patterns → specific practice areas
- Worsening trends → scope reduction suggestions
- Club-specific issues → approach adjustments
- Recurring hazards → proactive verification steps

## Development Health (Nutrition)

Track five categories of development health:

| Category | Aspect |
|----------|--------|
| Hydration | Dependencies up to date |
| Diet | Code hygiene (linting, dead code) |
| Recovery | Technical debt paydown |
| Supplements | Tooling improvements |
| Stretching | Pre-session warmup |

## Getting Started

```bash
npm install -g @slope-dev/cli
slope init
slope card
```

See the [README](../README.md) for full setup instructions.
