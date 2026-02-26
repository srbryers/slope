import type {
  GolfScorecard,
  MissDirection,
  ShotResult,
  DispersionReport,
  AreaReport,
  ClubSelection,
} from './types.js';
import { normalizeStats } from './builder.js';

// --- Helpers ---

const MISS_RESULT_TO_DIR: Partial<Record<ShotResult, MissDirection>> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

const GOOD_RESULTS = new Set<ShotResult>(['fairway', 'green', 'in_the_hole']);

const DIRECTIONS: MissDirection[] = ['long', 'short', 'left', 'right'];

const DIRECTION_INTERPRETATIONS: Record<MissDirection, string> = {
  long: 'Over-scoping or over-engineering — tickets taking more work than estimated',
  short: 'Under-scoping — missing requirements or incomplete implementations',
  left: 'Wrong approach — choosing incorrect tools, patterns, or architecture',
  right: 'Scope creep — pulling in unrelated work or gold-plating',
};

// --- Dispersion Analysis ---

/**
 * Compute shot dispersion analysis from an array of scorecards.
 * Returns miss pattern breakdown, dominant direction, and systemic issues.
 */
export function computeDispersion(scorecards: GolfScorecard[]): DispersionReport {
  const zeroed: DispersionReport = {
    total_shots: 0,
    total_misses: 0,
    miss_rate_pct: 0,
    by_direction: {
      long: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.long },
      short: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.short },
      left: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.left },
      right: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.right },
    },
    dominant_miss: null,
    systemic_issues: [],
  };

  if (scorecards.length === 0) {
    return zeroed;
  }

  let totalShots = 0;
  const dirCounts: Record<MissDirection, number> = { long: 0, short: 0, left: 0, right: 0 };

  for (const sc of scorecards) {
    for (const shot of sc.shots ?? []) {
      totalShots++;
      const dir = MISS_RESULT_TO_DIR[shot.result];
      if (dir) {
        dirCounts[dir]++;
      }
    }
  }

  const totalMisses = DIRECTIONS.reduce((sum, d) => sum + dirCounts[d], 0);
  const missRate = totalShots > 0 ? Math.round((totalMisses / totalShots) * 1000) / 10 : 0;

  const byDirection = {} as DispersionReport['by_direction'];
  let maxDir: MissDirection | null = null;
  let maxCount = 0;

  for (const dir of DIRECTIONS) {
    const count = dirCounts[dir];
    const pct = totalMisses > 0 ? Math.round((count / totalMisses) * 1000) / 10 : 0;
    byDirection[dir] = { count, pct, interpretation: DIRECTION_INTERPRETATIONS[dir] };
    if (count > maxCount) {
      maxCount = count;
      maxDir = dir;
    }
  }

  // Only report dominant if there are misses and one direction is clearly dominant (>40%)
  const dominantMiss = maxCount > 0 && totalMisses > 0 && (maxCount / totalMisses) > 0.4
    ? maxDir
    : null;

  // Systemic issues
  const systemic: string[] = [];
  if (scorecards.length < 5) {
    systemic.push(`Insufficient data — only ${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'} available (need 5+ for reliable patterns)`);
  }
  if (missRate > 30) {
    systemic.push(`High miss rate (${missRate}%) — consider reducing sprint scope or complexity`);
  }
  if (dominantMiss) {
    systemic.push(`Dominant miss direction: ${dominantMiss} — ${DIRECTION_INTERPRETATIONS[dominantMiss]}`);
  }

  return {
    total_shots: totalShots,
    total_misses: totalMisses,
    miss_rate_pct: missRate,
    by_direction: byDirection,
    dominant_miss: dominantMiss,
    systemic_issues: systemic,
  };
}

// --- Area Performance Analysis ---

/**
 * Compute area performance analysis from an array of scorecards.
 * Groups performance by sprint type, club selection, and par value.
 */
export function computeAreaPerformance(scorecards: GolfScorecard[]): AreaReport {
  const byType: Record<string, { count: number; totalDiff: number; fairwayNum: number; fairwayDen: number; girNum: number; girDen: number }> = {};
  const byClub: Record<string, { count: number; holeInOne: number; misses: number }> = {};
  const byPar: Record<number, { count: number; totalDiff: number; overPar: number }> = {};

  for (const sc of scorecards) {
    const sprintType = sc.type ?? 'feature';
    const diff = sc.score - sc.par;

    // By sprint type
    if (!byType[sprintType]) {
      byType[sprintType] = { count: 0, totalDiff: 0, fairwayNum: 0, fairwayDen: 0, girNum: 0, girDen: 0 };
    }
    const t = byType[sprintType];
    t.count++;
    t.totalDiff += diff;
    const stats = normalizeStats(sc.stats, (sc.shots ?? []).length);
    t.fairwayNum += stats.fairways_hit;
    t.fairwayDen += stats.fairways_total;
    t.girNum += stats.greens_in_regulation;
    t.girDen += stats.greens_total;

    // By par
    if (!byPar[sc.par]) {
      byPar[sc.par] = { count: 0, totalDiff: 0, overPar: 0 };
    }
    const p = byPar[sc.par];
    p.count++;
    p.totalDiff += diff;
    if (diff > 0) p.overPar++;

    // By club (per shot)
    for (const shot of sc.shots ?? []) {
      if (!byClub[shot.club]) {
        byClub[shot.club] = { count: 0, holeInOne: 0, misses: 0 };
      }
      const c = byClub[shot.club];
      c.count++;
      if (shot.result === 'in_the_hole') c.holeInOne++;
      if (!GOOD_RESULTS.has(shot.result)) c.misses++;
    }
  }

  // Build report
  const typeReport: AreaReport['by_sprint_type'] = {};
  for (const [type, data] of Object.entries(byType)) {
    typeReport[type] = {
      count: data.count,
      avg_score_vs_par: Math.round((data.totalDiff / data.count) * 10) / 10,
      fairway_pct: data.fairwayDen > 0 ? Math.round((data.fairwayNum / data.fairwayDen) * 1000) / 10 : 0,
      gir_pct: data.girDen > 0 ? Math.round((data.girNum / data.girDen) * 1000) / 10 : 0,
    };
  }

  const clubReport: AreaReport['by_club'] = {};
  for (const [club, data] of Object.entries(byClub)) {
    clubReport[club] = {
      count: data.count,
      in_the_hole_rate: data.count > 0 ? Math.round((data.holeInOne / data.count) * 1000) / 10 : 0,
      miss_rate: data.count > 0 ? Math.round((data.misses / data.count) * 1000) / 10 : 0,
    };
  }

  const parReport: AreaReport['par_performance'] = {};
  for (const [par, data] of Object.entries(byPar)) {
    parReport[Number(par)] = {
      count: data.count,
      avg_score_vs_par: Math.round((data.totalDiff / data.count) * 10) / 10,
      over_par_rate: data.count > 0 ? Math.round((data.overPar / data.count) * 1000) / 10 : 0,
    };
  }

  return {
    by_sprint_type: typeReport,
    by_club: clubReport,
    par_performance: parReport,
  };
}
