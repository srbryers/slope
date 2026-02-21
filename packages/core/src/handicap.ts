import type {
  GolfScorecard,
  HandicapCard,
  HoleStats,
  MissDirection,
  RollingStats,
  ScoreLabel,
} from './types.js';
import { PAR_THRESHOLDS, SCORE_LABELS } from './constants.js';
import { normalizeStats } from './builder.js';

/**
 * Compute par value from ticket count.
 * 1-2 tickets = par 3, 3-4 tickets = par 4, 5+ tickets = par 5.
 */
export function computePar(ticketCount: number): 3 | 4 | 5 {
  for (const [par, [min, max]] of Object.entries(PAR_THRESHOLDS)) {
    if (ticketCount >= min && ticketCount <= max) {
      return Number(par) as 3 | 4 | 5;
    }
  }
  return 5;
}

/**
 * Compute slope (difficulty modifier) from a list of factors present in the sprint.
 * Each factor adds +1 to the base slope of 0.
 */
export function computeSlope(factors: string[]): number {
  return factors.length;
}

/**
 * Compute a ScoreLabel from actual score and par.
 * Scores 3+ over par are all 'triple_plus'.
 */
export function computeScoreLabel(score: number, par: number): ScoreLabel {
  const diff = score - par;
  if (diff <= -2) return 'eagle';
  if (diff >= 3) return 'triple_plus';
  return SCORE_LABELS[diff] ?? 'par';
}

/**
 * Compute rolling statistics from a window of scorecards.
 * Returns zeroed stats if the array is empty.
 */
function computeRollingStats(scorecards: GolfScorecard[]): RollingStats {
  if (scorecards.length === 0) {
    return {
      handicap: 0,
      fairway_pct: 0,
      gir_pct: 0,
      avg_putts: 0,
      penalties_per_round: 0,
      miss_pattern: { long: 0, short: 0, left: 0, right: 0 },
      mulligans: 0,
      gimmes: 0,
    };
  }

  const n = scorecards.length;

  // Handicap: average (score - par), floored at 0
  const totalDiff = scorecards.reduce((sum, sc) => sum + (sc.score - sc.par), 0);
  const handicap = Math.max(0, Math.round((totalDiff / n) * 10) / 10);

  // Aggregate stats
  let totalFairways = 0;
  let totalFairwaysTotal = 0;
  let totalGir = 0;
  let totalGirTotal = 0;
  let totalPutts = 0;
  let totalPenalties = 0;
  const missPattern: Record<MissDirection, number> = { long: 0, short: 0, left: 0, right: 0 };
  let totalMulligans = 0;
  let totalGimmes = 0;

  for (const sc of scorecards) {
    const stats: HoleStats = normalizeStats(sc.stats, sc.shots?.length ?? 0);
    totalFairways += stats.fairways_hit;
    totalFairwaysTotal += stats.fairways_total;
    totalGir += stats.greens_in_regulation;
    totalGirTotal += stats.greens_total;
    totalPutts += stats.putts;
    totalPenalties += stats.penalties;

    for (const dir of ['long', 'short', 'left', 'right'] as MissDirection[]) {
      missPattern[dir] += stats.miss_directions[dir] ?? 0;
    }

    for (const play of sc.special_plays) {
      if (play === 'mulligan') totalMulligans++;
      if (play === 'gimme') totalGimmes++;
    }
  }

  const fairway_pct = totalFairwaysTotal > 0
    ? Math.round((totalFairways / totalFairwaysTotal) * 1000) / 10
    : 0;

  const gir_pct = totalGirTotal > 0
    ? Math.round((totalGir / totalGirTotal) * 1000) / 10
    : 0;

  return {
    handicap,
    fairway_pct,
    gir_pct,
    avg_putts: Math.round((totalPutts / n) * 10) / 10,
    penalties_per_round: Math.round((totalPenalties / n) * 10) / 10,
    miss_pattern: missPattern,
    mulligans: totalMulligans,
    gimmes: totalGimmes,
  };
}

/**
 * Compute a full HandicapCard from an array of scorecards.
 * Scorecards should be ordered chronologically (oldest first).
 */
export function computeHandicapCard(scorecards: GolfScorecard[]): HandicapCard {
  const last5 = scorecards.slice(-5);
  const last10 = scorecards.slice(-10);

  return {
    last_5: computeRollingStats(last5),
    last_10: computeRollingStats(last10),
    all_time: computeRollingStats(scorecards),
  };
}
