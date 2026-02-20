# SLOPE Scorecard Template

Use this template to fill out a SLOPE scorecard at the end of each sprint.

---

## Golf Metaphor Quick Reference

| Golf Term | Development Meaning |
|---|---|
| **Par** | Expected ticket count (1-2 = par 3, 3-4 = par 4, 5+ = par 5) |
| **Slope** | Difficulty modifier — count of complexity factors present |
| **Score** | Actual tickets delivered + penalty strokes |
| **Club** | Approach complexity declaration (driver = riskiest, putter = simplest) |
| **Fairway** | Clean first approach — ticket started on the right path |
| **Green** | Ticket landed correctly, may need minor adjustments |
| **In the hole** | Perfect execution — no fixes needed |
| **Missed long** | Over-engineered / scope creep |
| **Missed short** | Under-scoped / missed requirements |
| **Missed left** | Wrong approach / architectural miss |
| **Missed right** | Spec drift / implementation diverged from spec |
| **Hazard** | Gotcha or blocker encountered |
| **Penalty** | Reverts, broken tests, CI failures |
| **Mulligan** | Do-over (approach scrapped, restarted) |
| **Gimme** | Trivial fix accepted without full process |

## Club Selection Guide

Declare your club **before** starting each ticket:

| Club | When to use |
|---|---|
| **Driver** | New infrastructure, new packages, architectural changes. High risk. |
| **Long iron** | Multi-package changes, schema + API + UI in one ticket. |
| **Short iron** | Single-package changes with clear scope. Standard work. |
| **Wedge** | Config changes, doc updates, small fixes. |
| **Putter** | One-line fixes, typo corrections. Minimal risk. |

## Slope Factors

Each present factor adds +1 to slope:

1. **cross_package** — Changes span multiple packages
2. **schema_migration** — Involves database migrations
3. **new_area** — Touching code area for the first time
4. **external_dep** — Depends on external service or new dependency
5. **concurrent_agents** — Multiple agents working simultaneously

## How to Fill Out a Scorecard

1. **Set par**: Count tickets → 1-2 = par 3, 3-4 = par 4, 5+ = par 5
2. **Set slope**: Count slope factors present
3. **Record each shot**: For every ticket, note the club, result, and hazards
4. **Record conditions**: External factors that affected the sprint
5. **Record special plays**: Mulligans, gimmes, provisionals
6. **Compute stats**: Use `buildScorecard()` — it auto-computes fairways, GIR, putts, penalties, miss directions, score, and score_label from your shots
7. **Training log**: What practice/learning happened
8. **Nutrition check**: Assess categories (hydration, diet, recovery, supplements, stretching)
9. **19th hole**: Optional informal reflection
10. **Yardage book / bunker locations**: Strategic notes for future sprints

### Validate

```bash
slope validate docs/retros/sprint-N.json
```
