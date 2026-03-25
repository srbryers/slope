# Sprint 75 Plan — The Convergence (Loop Self-Improvement)

**Par:** 3 (3 tickets)
**Slope:** 3 (cross-cutting: core analytics, backlog generation, CLI)
**Theme:** Convergence detection, backlog quality scoring, and auto-generation from common issues

## Context

The loop generates backlogs from scorecard data (`slope-loop/analyze-scorecards.ts`) using 6 strategies (hotspot hardening, test coverage, hazard cleanup, documentation, overflow, roadmap fallback). It computes handicap trends and velocity, but has no convergence detection — can't tell if improvement is plateauing or reversing.

**What exists:**
- `computeHandicapCard()` → last_5, last_10, all_time rolling stats
- `computeHandicapTrend()` → per-sprint time-series (handicap, fairway_pct, gir_pct)
- `computeVelocity()` → improving/stable/declining with 0.3 threshold
- `handicap_delta` in SprintResult (last5 vs all_time, post-sprint)
- `computeGuardMetrics()` → per-guard block/allow rates
- Common issues generator → HACK/FIXME clusters, structural warnings

**What's missing:**
- Plateau detection (same hazards for N consecutive sprints)
- Backlog quality scoring (which tickets are likely to succeed?)
- Auto-generating backlog from common issues and guard data

## Tickets

### T1: Backlog quality scoring — rate tickets by execution likelihood
**Club:** short_iron
**Files:** `slope-loop/analyze-scorecards.ts`, `src/cli/loop/types.ts`

**Problem:** All generated backlog tickets are treated equally. Tickets targeting areas with low model success rates or high hazard density are likely to fail, wasting execution budget.

**Approach:**
- Add `quality_score: number` (0-1) to `BacklogTicket` (optional, backward compat)
- Score based on:
  - Club success rate from model-config.json (higher = better)
  - Module hazard density (fewer recent hazards = better)
  - File count (max_files=1 scores higher than max_files=3)
- In `analyze-scorecards.ts`, compute quality_score when generating tickets
- Sort backlog sprints by average quality_score (highest first)
- `slope loop status` shows quality scores when available

**Hazard watch:** quality_score must be optional — old backlogs without it must still work.

### T2: Auto-generate backlog from common issues and guard data
**Club:** long_iron
**Files:** `slope-loop/analyze-scorecards.ts`, `src/core/generators/common-issues.ts`

**Problem:** Backlog generation only uses scorecard hazard data. Common issues (HACK/FIXME clusters, structural warnings) and guard metrics (high block rates indicating friction) aren't factored in.

**Approach:**
- Add a new strategy to `analyze-scorecards.ts`: **Strategy 7 — Issue-driven**
  - Read `.slope/common-issues.json` for recurring patterns
  - Filter to patterns with `sprints_hit.length >= 3` (persistent issues)
  - Generate tickets targeting the source modules referenced in the pattern
- Add **Strategy 8 — Guard friction reduction**
  - Read guard metrics (if available) for guards with high block_rate (>50%)
  - Generate tickets to address the root cause (e.g., if `scope-drift` blocks frequently → tickets for claim management improvements)
- Both strategies produce tickets with `strategy: 'hardening'` and appropriate club/module metadata
- Guard metrics input is optional — skip strategy 8 if no metrics available

**Hazard watch:** Common issues patterns don't have file paths — need to infer modules from `description` and `prevention` text (similar to hazard guard's area matching). Guard metrics may not exist in all installations.

### T3: Convergence metrics — improvement rate and plateau detection
**Club:** short_iron
**Files:** `src/core/analytics.ts`, `src/cli/commands/loop.ts`

**Problem:** `computeVelocity()` only reports improving/stable/declining. No detection of plateau (diminishing returns) or reversion (getting worse after improvement).

**Approach:**
- Add `computeConvergence(scorecards)` to `analytics.ts` returning:
  ```
  { improvement_rate: number,    // avg handicap change per sprint (negative = improving)
    plateau: boolean,            // true if |improvement_rate| < 0.1 for last 10 sprints
    reversion: boolean,          // true if last_5 > last_10 after prior improvement
    sprints_since_improvement: number,  // consecutive sprints without score decrease
    prediction: 'improving' | 'plateau' | 'reverting' | 'insufficient_data' }
  ```
- Add `slope loop convergence` subcommand that prints the convergence card
- Emit convergence data in `slope loop analyze` output for backlog generation to consume
- When plateau detected, `analyze-scorecards.ts` can shift strategy from "more hardening" to "architectural" tickets

**Hazard watch:** Need at least 10 scorecards for meaningful convergence. Return `insufficient_data` prediction when fewer.

## Review Tier

**Light** (1 round) — 3 tickets, well-scoped analytics additions building on existing infrastructure.

## Dependencies

- T1 and T3 are independent
- T2 can start after T1 (uses quality_score in generated tickets)
