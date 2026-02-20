import type {
  GolfScorecard,
  ShotRecord,
  ShotResult,
  HoleStats,
  MissDirection,
  ConditionRecord,
  SpecialPlay,
  TrainingSession,
  NutritionEntry,
  NineteenthHole,
  SprintType,
  ScoreLabel,
} from './types.js';
import { computeScoreLabel } from './handicap.js';

// --- Helpers ---

const MISS_RESULT_TO_DIR: Partial<Record<ShotResult, MissDirection>> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

// --- Stats computation ---

/**
 * Compute HoleStats from a shots array.
 * Derives fairways_hit, GIR, hazards_hit, and miss_directions
 * entirely from shot data — no manual counting needed.
 *
 * - fairways_total = shots.length (every ticket is a fairway opportunity)
 * - fairways_hit = shots where result is fairway, green, or in_the_hole
 * - greens_total = shots.length
 * - greens_in_regulation = shots where result is green or in_the_hole
 * - hazards_hit = total hazards across all shots
 * - miss_directions = count of each missed_* result direction
 * - putts and penalties default to 0 (must be provided separately if needed)
 */
export function computeStatsFromShots(
  shots: ShotRecord[],
  overrides?: { putts?: number; penalties?: number },
): HoleStats {
  let fairwaysHit = 0;
  let greensInReg = 0;
  let hazardsHit = 0;
  const missDirs: Record<MissDirection, number> = { long: 0, short: 0, left: 0, right: 0 };

  for (const shot of shots) {
    // Fairway hit = clean start (not a miss)
    if (shot.result === 'fairway' || shot.result === 'green' || shot.result === 'in_the_hole') {
      fairwaysHit++;
    }
    // Green in regulation = landed on green or holed
    if (shot.result === 'green' || shot.result === 'in_the_hole') {
      greensInReg++;
    }
    // Hazards
    hazardsHit += shot.hazards.length;
    // Miss directions
    const dir = MISS_RESULT_TO_DIR[shot.result];
    if (dir) {
      missDirs[dir]++;
    }
  }

  return {
    fairways_hit: fairwaysHit,
    fairways_total: shots.length,
    greens_in_regulation: greensInReg,
    greens_total: shots.length,
    putts: overrides?.putts ?? 0,
    penalties: overrides?.penalties ?? 0,
    hazards_hit: hazardsHit,
    miss_directions: missDirs,
  };
}

// --- Scorecard builder ---

/** Minimal input for building a scorecard — everything else is computed */
export interface ScorecardInput {
  sprint_number: number;
  theme: string;
  par: 3 | 4 | 5;
  slope: number;
  date: string;
  shots: ShotRecord[];

  // Optional overrides for fields that can't be derived from shots
  putts?: number;
  penalties?: number;
  type?: SprintType;
  conditions?: ConditionRecord[];
  special_plays?: SpecialPlay[];
  training?: TrainingSession[];
  nutrition?: NutritionEntry[];
  nineteenth_hole?: NineteenthHole;
  bunker_locations?: string[];
  yardage_book_updates?: string[];
  course_management_notes?: string[];
}

/**
 * Build a complete GolfScorecard from minimal input.
 *
 * Auto-computes:
 * - stats (from shots array via computeStatsFromShots)
 * - score (shots.length + penalties)
 * - score_label (from computeScoreLabel)
 *
 * You only need to provide the parts requiring judgment:
 * shot results, hazard descriptions, training, nutrition, reflection.
 */
export function buildScorecard(input: ScorecardInput): GolfScorecard {
  const penalties = input.penalties ?? 0;
  const stats = computeStatsFromShots(input.shots, {
    putts: input.putts ?? 0,
    penalties,
  });

  const score = input.shots.length + penalties;
  const score_label: ScoreLabel = computeScoreLabel(score, input.par);

  return {
    sprint_number: input.sprint_number,
    theme: input.theme,
    par: input.par,
    slope: input.slope,
    score,
    score_label,
    date: input.date,
    shots: input.shots,
    stats,
    type: input.type,
    conditions: input.conditions ?? [],
    special_plays: input.special_plays ?? [],
    training: input.training,
    nutrition: input.nutrition,
    nineteenth_hole: input.nineteenth_hole,
    bunker_locations: input.bunker_locations ?? [],
    yardage_book_updates: input.yardage_book_updates ?? [],
    course_management_notes: input.course_management_notes ?? [],
  };
}
