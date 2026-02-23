# Sprint 25 — Hazard Severity Scoring

## Context

Hazards are recorded on shots but have zero scoring impact — a sprint with 5 rough hazards scores the same as a clean sprint. In real golf, hazards cost strokes. This sprint adds a `severity` field to hazards that auto-maps to penalty strokes, making the scoring system more honest.

**Goal:** Hazards contribute penalty strokes based on severity. Score formula becomes `shots.length + manual_penalties + hazard_penalties` (rounded to nearest integer).

## Par & Slope

- **Par:** 4 (4 tickets)
- **Slope:** 1 (touches core types, scoring formula, validation, and formatter — cross-cutting)
- **Type:** feature

---

## Tickets

### S25-1: Add HazardSeverity type and penalty mapping

**Club:** wedge | **Complexity:** small

Add the severity type and constants.

**Files:**
- `packages/core/src/types.ts` — Add `HazardSeverity` type, add optional `severity` field to `HazardHit`
- `packages/core/src/constants.ts` — Add `HAZARD_SEVERITY_PENALTIES` mapping

**Changes:**

In `types.ts`:
```typescript
// After line 13 (HazardType)
export type HazardSeverity = 'minor' | 'moderate' | 'major' | 'critical';
```

In `HazardHit` interface (line 33-37):
```typescript
export interface HazardHit {
  type: HazardType;
  severity?: HazardSeverity;  // NEW — defaults to 'minor' if omitted (backward compat)
  description: string;
  gotcha_id?: string;
}
```

In `constants.ts`:
```typescript
import type { HazardSeverity } from './types.js';

export const HAZARD_SEVERITY_PENALTIES: Record<HazardSeverity, number> = {
  minor: 0,
  moderate: 0.5,
  major: 1,
  critical: 2,
};
```

**Backward compat:** `severity` is optional. Missing = `minor` = 0 penalty. All existing scorecards remain valid.

---

### S25-2: Update scoring to include hazard penalties

**Club:** short_iron | **Complexity:** standard

Update the builder to compute hazard penalties and include them in the score.

**Files:**
- `packages/core/src/types.ts` — Add `hazard_penalties` to `HoleStats`
- `packages/core/src/builder.ts` — Update `computeStatsFromShots`, `normalizeStats`, `buildScorecard`, `buildAgentBreakdowns`

**REVIEW FINDING — test churn:** Adding `hazard_penalties` as required to `HoleStats` will break ~20 inline constructions across 14 test files. All `makeStats()` helpers need `hazard_penalties: 0` added. Files affected:
- `tests/builder.test.ts`, `tests/validation.test.ts`, `tests/formatter.test.ts`
- `tests/handicap.test.ts`, `tests/advisor.test.ts`, `tests/advisor-validation.test.ts`
- `tests/briefing.test.ts`, `tests/dispersion.test.ts`, `tests/tournament.test.ts`
- `tests/player.test.ts`, `tests/loader.test.ts`, `tests/dashboard.test.ts`
- `tests/report.test.ts`, `tests/leaderboard.test.ts`, `tests/pr-briefing.test.ts`

Most use `makeStats()` helpers with `Partial<HoleStats>` spread — add `hazard_penalties: 0` to the helper defaults. A few inline constructions need the field added directly.

**Changes:**

In `HoleStats` (types.ts:60-69), add after `hazards_hit`:
```typescript
hazard_penalties: number;
```

In `computeStatsFromShots` (builder.ts:42-79):
- Import `HAZARD_SEVERITY_PENALTIES` from constants
- After the hazards loop, compute penalty sum:
  ```typescript
  let hazardPenalties = 0;
  // (inside the existing shot loop, after hazardsHit += shot.hazards.length)
  for (const hazard of shot.hazards) {
    hazardPenalties += HAZARD_SEVERITY_PENALTIES[hazard.severity ?? 'minor'];
  }
  ```
- Add `hazard_penalties: hazardPenalties` to the return object

In `normalizeStats` (builder.ts:88-126):
- Add `hazard_penalties: Number(s.hazard_penalties) || 0` to both return paths
- Add to the null/empty fallback too

In `buildScorecard` (builder.ts:180-212):
- Change line 187 from `const score = input.shots.length + penalties;` to:
  ```typescript
  const score = Math.round(input.shots.length + penalties + stats.hazard_penalties);
  ```

In `buildAgentBreakdowns` (builder.ts:227-238):
- Agent score should also include hazard penalties:
  ```typescript
  score: Math.round(agent.shots.length + stats.hazard_penalties),
  ```

**Rounding:** `Math.round()` — moderate hazards add 0.5, so odd counts of moderate round up (1.5→2, 2.5→3).

---

### S25-3: Update formatter and validation

**Club:** wedge | **Complexity:** small

**Files:**
- `packages/core/src/formatter.ts` — Show hazard penalties in review table
- `packages/core/src/validation.ts` — Add severity validation rule

**Formatter change** (formatter.ts:120):
- After the `Penalties` line, add hazard penalties if > 0:
  ```typescript
  lines.push(`| Penalties | ${stats.penalties} |`);
  if (stats.hazard_penalties > 0) {
    lines.push(`| Hazard Penalties | ${stats.hazard_penalties} |`);
  }
  ```

**Validation change** (validation.ts, after Rule 4 ~line 118):
- Add Rule 8: validate severity enum values
  ```typescript
  // Rule 8: hazard severity values are valid
  if (card.shots) {
    const validSeverities = ['minor', 'moderate', 'major', 'critical'];
    for (const shot of card.shots) {
      for (const hazard of shot.hazards) {
        if (hazard.severity && !validSeverities.includes(hazard.severity)) {
          errors.push({
            code: 'INVALID_HAZARD_SEVERITY',
            message: `Invalid hazard severity "${hazard.severity}" in ${shot.ticket_key}`,
            field: 'shots.hazards.severity',
          });
        }
      }
    }
  }
  ```

**Re-export in `packages/core/src/index.ts`:**
- Add `HazardSeverity` to the type export block (line 5-44, after `HazardType`)
- Add `HAZARD_SEVERITY_PENALTIES` to the constants export block (line 47-53, after `SCORE_LABELS`)

---

### S25-4: Tests

**Club:** short_iron | **Complexity:** standard

Add tests covering the new scoring behavior.

**Files:**
- `packages/core/tests/builder.test.ts` — hazard penalty computation + scoring tests
- `packages/core/tests/validation.test.ts` — severity validation tests

**Builder test cases:**
- `computeStatsFromShots` with no hazards → `hazard_penalties: 0`
- `computeStatsFromShots` with minor hazard → `hazard_penalties: 0`
- `computeStatsFromShots` with moderate hazard → `hazard_penalties: 0.5`
- `computeStatsFromShots` with major hazard → `hazard_penalties: 1`
- `computeStatsFromShots` with critical hazard → `hazard_penalties: 2`
- `computeStatsFromShots` with mixed severities → correct sum
- `computeStatsFromShots` with hazard missing severity → defaults to minor (0)
- `buildScorecard` with hazards → score includes hazard penalties
- `buildScorecard` rounding: 3 shots + 1 moderate (0.5) → score 4 (rounds up from 3.5)
- `buildScorecard` with both manual penalties and hazard penalties → both contribute
- `normalizeStats` preserves hazard_penalties field

**Validation test cases:**
- Valid severity values pass
- Invalid severity value fails with `INVALID_HAZARD_SEVERITY`
- Missing severity field passes (backward compat)

---

## Execution Order

```
S25-1 (types + constants) → S25-2 (scoring logic) → S25-3 (formatter + validation) → S25-4 (tests)
```

S25-1 is foundation. S25-2 depends on it. S25-3 and S25-4 depend on S25-2.

---

## Key Files Reference

**Modified:**
- `packages/core/src/types.ts` — HazardSeverity type, HazardHit.severity field, HoleStats.hazard_penalties
- `packages/core/src/constants.ts` — HAZARD_SEVERITY_PENALTIES mapping
- `packages/core/src/builder.ts` — computeStatsFromShots, normalizeStats, buildScorecard, buildAgentBreakdowns
- `packages/core/src/formatter.ts` — review table hazard penalties row
- `packages/core/src/validation.ts` — severity enum validation rule
- `packages/core/src/index.ts` — re-export new types/constants
- `packages/core/tests/builder.test.ts` — new test cases
- `packages/core/tests/validation.test.ts` — new test cases

**Read-only reference:**
- `packages/core/src/handicap.ts` — uses stats.penalties (no change needed, hazard_penalties is separate)
- `packages/core/src/tournament.ts` — uses stats.penalties + stats.hazards_hit (no change needed)

---

## Downstream Impact

- `handicap.ts` tracks `stats.penalties` (manual) for rolling stats — **no change needed**, hazard penalties are a separate field
- `tournament.ts` sums `stats.penalties` — **no change needed**
- `team-handicap.ts` sums `stats.penalties` — **no change needed**
- `formatter.ts` displays `stats.penalties` — **add hazard_penalties row** (S25-3)
- Existing scorecards without severity → all hazards default to `minor` (0) → **scores unchanged**

---

## Verification

1. `pnpm -r build && pnpm -r test && pnpm -r typecheck` — all pass
2. `slope validate` on existing scorecards — all still valid, scores unchanged
3. Build a test scorecard with severity hazards via `buildScorecard()` — score reflects penalties
4. `slope review` on a scorecard with hazard penalties — shows hazard penalties row
