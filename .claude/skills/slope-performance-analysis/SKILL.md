---
name: slope-performance-analysis
version: "1.0"
description: >
  Interpreting SLOPE handicap cards, miss patterns, hazard data, and generating
  actionable recommendations. Use when analyzing sprint performance, reading
  handicap cards, investigating miss patterns, computing dispersion, or
  generating backlog strategies from performance data.
triggers:
  - "handicap"
  - "performance"
  - "analysis"
  - "slope card"
  - "miss pattern"
  - "hazard"
  - "dispersion"
  - "trend"
context_files:
  - "CODEBASE.md"
  - ".slope/config.json"
---

# SLOPE Performance Analysis

Performance analysis agent for SLOPE-managed projects. Interprets handicap cards, miss patterns, hazard data, and dispersion to produce actionable recommendations.

## File Map

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — overview and quick reference metrics |
| `gotchas.md` | Metric misinterpretation pitfalls and scoring edge cases |
| `references/handicap-anatomy.md` | Field-by-field card interpretation, rolling stats, trend detection |
| `references/recommendations.md` | From miss patterns and hazard hotspots to actionable backlog strategies |
| `scripts/analysis-helpers.js` | execute() snippets for handicap, dispersion, area performance, training plans |

## Quick Reference — Metric Thresholds

| Metric | Good | Warning | Action Needed |
|--------|------|---------|---------------|
| Handicap | 0-1 | 2-3 | 4+ |
| Trend | Improving | Stable | Worsening |
| Club success rate | >90% | 70-90% | <70% |
| Miss rate | <5% | 5-15% | >15% |
| Recurring hazards | 0-2 | 3-5 | 6+ |

## Key Concepts

- **Handicap** — Rolling performance score (lower is better). 0 = consistently hitting par.
- **Dispersion** — Distribution of miss directions (long/short/left/right). Dominant direction = systemic issue.
- **Hazard hotspots** — Modules with recurring hazards, weighted by recency (0.7 recent, 0.3 historical).
- **Club performance** — Success rate per complexity tier. Low rate on a club = that tier has issues.

## CLI Commands

| Command | Purpose |
|---------|---------|
| `slope card` | Generate handicap card |
| `slope briefing` | Pre-sprint performance summary |
| `slope review recommend` | Check which reviews apply |
| `slope report` | Generate HTML performance report |
| `slope dashboard` | Live local performance dashboard |

Read `gotchas.md` for metric interpretation pitfalls. Read `references/handicap-anatomy.md` for detailed field interpretation.
