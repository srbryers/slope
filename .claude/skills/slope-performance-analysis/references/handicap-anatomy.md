# Handicap Card Anatomy

Field-by-field interpretation of `slope card` output.

## Top-Level Fields

### Rolling Stats
```
last_5:    0.2    ← Average score-vs-par delta over last 5 sprints
last_10:   0.8    ← Average over last 10 sprints
all_time:  1.2    ← Lifetime average
```

**Trend detection:**
- `last_5 < last_10` → Improving (recent sprints better than history)
- `last_5 ≈ last_10` → Stable
- `last_5 > last_10` → Worsening (recent sprints worse)

A handicap of 0 means consistently hitting par — optimal performance.

### Score Labels
| Score vs Par | Label | Meaning |
|-------------|-------|---------|
| -2 or better | eagle | Significantly under par |
| -1 | birdie | One under par |
| 0 | par | On target |
| +1 | bogey | One over par |
| +2 | double_bogey | Two over par |
| +3 or worse | triple_bogey+ | Significantly over par |

## Club Performance Section

Each club tier tracks total shots and success rate:
```
driver:      3 shots, 67% success
long_iron:   8 shots, 88% success
short_iron: 25 shots, 96% success
wedge:      15 shots, 100% success
putter:     10 shots, 100% success
```

**Interpretation:**
- Success = shot scored `fairway`, `green`, or `in_the_hole`
- Low success on driver/long_iron → over-scoping or unfamiliar territory
- Low success on short_iron → standard work has friction (usually API shape issues)
- Low success on wedge/putter → something fundamentally wrong with simple tasks

## Dispersion Section

Miss direction distribution across all missed shots:
```
long:   40%   ← Over-engineering, over-scoping
short:  20%   ← Incomplete implementation, missed requirements
left:   30%   ← Wrong approach, incorrect tools/patterns
right:  10%   ← Scope creep, unrelated work pulled in
```

**Dominant miss (>40% in one direction):** Indicates systemic issue.
- Dominant `long` → Improve estimation, break tickets smaller
- Dominant `short` → Improve requirements gathering, add acceptance criteria
- Dominant `left` → More pre-shot research, consult yardage book
- Dominant `right` → Enforce ticket boundaries, flag additions before implementing

## Hazard Hotspots Section

Modules ranked by weighted hazard score:
```
Module: "src/core/scoring.ts"
  rough: 3, bunker: 1
  weighted_score: 2.8 (recent: 2, total: 4)
```

**Weighted formula:** `(recentCount * 0.7) + (totalCount * 0.3)`

Recent = last 10 sprints. This weights recent hazards higher than historical ones.

**Priority tiers:**
- `weighted_score >= 3.0` → Immediate attention (hardening sprint)
- `weighted_score >= 1.5` → Monitor, address in next relevant sprint
- `weighted_score < 1.5` → Low priority, track passively
