# Performance Analysis Gotchas

Common metric misinterpretation pitfalls. Read before drawing conclusions from performance data.

## 1. Recency Bias in Temporal Weighting

**What:** SLOPE weights recent hazards at 0.7 and historical at 0.3. This is intentional but can mislead — a single bad recent sprint can dominate hotspot rankings over modules with long histories of issues.

**Prevention:** Always check both weighted and raw counts. A module with 1 recent hazard (weighted: 0.7) ranks above one with 2 historical hazards (weighted: 0.6), even though the latter has more total issues. Look at `all_time` alongside `last_5`.

## 2. Handicap vs Score Confusion

**What:** Handicap is a rolling average of score-vs-par deltas. A handicap of 2 does NOT mean you scored 2 — it means you average 2 strokes over par across recent sprints.

**Example:** A sprint with score=6, par=4 contributes +2 to handicap. A sprint with score=3, par=4 contributes -1 (birdie).

**Prevention:** When reporting, always say "handicap of X" not "score of X". Include the par context.

## 3. Small-Sample Club Statistics

**What:** Club success rates with fewer than 5 uses are unreliable. One failed driver attempt out of 2 total shows 50% success rate, but that's not enough data to conclude drivers are problematic.

**Prevention:** Only recommend club-specific interventions when the club has 5+ recorded uses. Below that threshold, note the sample size limitation.

## 4. Hotspot Over-Indexing

**What:** A module appearing as a hotspot doesn't always mean the module is broken. It might just be the most-edited module. High edit frequency naturally produces more hazards.

**Prevention:** Normalize hazard count by edit frequency when possible. A module with 2 hazards across 20 edits (10% rate) is healthier than one with 2 hazards across 3 edits (67% rate).

## 5. Review-Inflated Scores

**What:** Post-hole reviews add hazard penalties to the scorecard. A sprint that looks clean during coding can balloon from par to triple-bogey after review findings are applied (seen in S45: par -> triple+ from 2.5 penalty points).

**Prevention:** When analyzing trends, distinguish between "coding score" (pre-review) and "final score" (post-review). Improving review scores doesn't mean coding got worse — it often means reviews got more thorough.

## 6. Dispersion Direction Misinterpretation

**What:** Miss directions map to specific root causes, but they're easy to confuse:
- `long` = over-engineering (NOT "took too long")
- `short` = incomplete (NOT "too fast")
- `left` = wrong approach
- `right` = scope creep

**Prevention:** Use the precise definitions. "This sprint ran long" means it took more time, not that tickets were over-scoped. Over-scoping is `long`, time overrun is a separate concern.

## 7. Zero-Hazard Sprints Aren't Necessarily Perfect

**What:** A sprint with 0 hazards might mean perfect execution, or it might mean reviews weren't thorough enough. All hazards since S43 were found by review — without review, they'd show as 0.

**Prevention:** Check whether reviews were actually conducted. A 0-hazard sprint without reviews is unknown, not clean.
