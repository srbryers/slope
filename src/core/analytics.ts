// SLOPE — Sprint Analytics
// Pure compute functions for handicap trends, velocity tracking, and guard effectiveness.

import type { GolfScorecard } from './types.js';
import { normalizeStats } from './builder.js';

// --- T1: Handicap Trend ---

export interface TrendPoint {
  sprint: number;
  handicap: number;       // cumulative avg(score - par) up to this sprint
  fairway_pct: number;    // cumulative fairways_hit / fairways_total * 100
  gir_pct: number;        // cumulative GIR / total * 100
}

/**
 * Compute per-sprint time-series of handicap, fairway%, and GIR%.
 * O(n) incremental — maintains running sums, no per-sprint computeHandicapCard() call.
 */
export function computeHandicapTrend(scorecards: GolfScorecard[]): TrendPoint[] {
  if (scorecards.length === 0) return [];

  const sorted = [...scorecards].sort((a, b) => a.sprint_number - b.sprint_number);

  let sumDiff = 0;
  let sumFairwaysHit = 0;
  let sumFairwaysTotal = 0;
  let sumGir = 0;
  let sumGirTotal = 0;

  return sorted.map((sc, i) => {
    const stats = normalizeStats(sc.stats, (sc.shots ?? []).length);
    sumDiff += sc.score - sc.par;
    sumFairwaysHit += stats.fairways_hit;
    sumFairwaysTotal += stats.fairways_total;
    sumGir += stats.greens_in_regulation;
    sumGirTotal += stats.greens_total;

    const count = i + 1;
    return {
      sprint: sc.sprint_number,
      handicap: Math.round((sumDiff / count) * 100) / 100,
      fairway_pct: sumFairwaysTotal > 0
        ? Math.round((sumFairwaysHit / sumFairwaysTotal) * 10000) / 100
        : 0,
      gir_pct: sumGirTotal > 0
        ? Math.round((sumGir / sumGirTotal) * 10000) / 100
        : 0,
    };
  });
}

// --- T2: Sprint Velocity ---

export interface VelocityPoint {
  sprint: number;
  tickets: number;         // shots.length
  par: number;
  score: number;
  differential: number;    // score - par
  at_or_under_par: boolean;
}

export interface VelocityReport {
  points: VelocityPoint[];
  avg_tickets: number;
  par_accuracy_pct: number;    // % of sprints at or under par
  avg_differential: number;
  trend: 'improving' | 'stable' | 'declining';
}

/**
 * Compute sprint velocity metrics from scorecards.
 * Trend detection: compare last-5 avg differential to all-time avg.
 * Threshold: 0.3 avoids noise (one bogey in 5 sprints = 0.2 swing).
 */
export function computeVelocity(scorecards: GolfScorecard[]): VelocityReport {
  if (scorecards.length === 0) {
    return {
      points: [],
      avg_tickets: 0,
      par_accuracy_pct: 0,
      avg_differential: 0,
      trend: 'stable',
    };
  }

  const sorted = [...scorecards].sort((a, b) => a.sprint_number - b.sprint_number);

  const points: VelocityPoint[] = sorted.map(sc => ({
    sprint: sc.sprint_number,
    tickets: (sc.shots ?? []).length,
    par: sc.par,
    score: sc.score,
    differential: sc.score - sc.par,
    at_or_under_par: sc.score <= sc.par,
  }));

  const totalTickets = points.reduce((s, p) => s + p.tickets, 0);
  const atOrUnder = points.filter(p => p.at_or_under_par).length;
  const totalDiff = points.reduce((s, p) => s + p.differential, 0);
  const avgDiff = totalDiff / points.length;

  // Trend: compare last-5 avg to all-time avg
  const last5 = points.slice(-5);
  const last5Diff = last5.reduce((s, p) => s + p.differential, 0) / last5.length;

  const THRESHOLD = 0.3;
  let trend: VelocityReport['trend'] = 'stable';
  if (last5Diff < avgDiff - THRESHOLD) trend = 'improving';
  else if (last5Diff > avgDiff + THRESHOLD) trend = 'declining';

  return {
    points,
    avg_tickets: Math.round((totalTickets / points.length) * 100) / 100,
    par_accuracy_pct: Math.round((atOrUnder / points.length) * 10000) / 100,
    avg_differential: Math.round(avgDiff * 100) / 100,
    trend,
  };
}

// --- T3: Guard Effectiveness ---

export interface GuardMetrics {
  guard: string;
  total: number;
  allow: number;
  deny: number;
  ask: number;
  context: number;
  silent: number;
  block_rate: number;      // (deny / total) * 100
}

export interface GuardEffectivenessReport {
  total_executions: number;
  by_guard: GuardMetrics[];
  most_active: string | null;    // guard with most executions
  most_blocking: string | null;  // guard with highest block_rate (min 5 executions)
}

/** Possible decision values in guard metrics JSONL (superset of GuardResult.decision) */
export type GuardDecision = 'allow' | 'deny' | 'ask' | 'context' | 'silent';

interface GuardMetricLine {
  ts: string;
  guard: string;
  event: string;
  tool?: string;
  decision: string;
}

/**
 * Compute guard effectiveness metrics from raw JSONL lines.
 * Pure function — no I/O. Caller reads the file and passes lines.
 * Malformed lines are skipped gracefully.
 */
export function computeGuardMetrics(lines: string[]): GuardEffectivenessReport {
  const byGuard = new Map<string, { allow: number; deny: number; ask: number; context: number; silent: number }>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: GuardMetricLine;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }

    if (!parsed.guard || typeof parsed.guard !== 'string') continue;

    if (!byGuard.has(parsed.guard)) {
      byGuard.set(parsed.guard, { allow: 0, deny: 0, ask: 0, context: 0, silent: 0 });
    }
    const entry = byGuard.get(parsed.guard)!;

    switch (parsed.decision) {
      case 'allow': entry.allow++; break;
      case 'deny': entry.deny++; break;
      case 'ask': entry.ask++; break;
      case 'context': entry.context++; break;
      default: entry.silent++; break;
    }
  }

  const metrics: GuardMetrics[] = [];
  let totalExecutions = 0;
  let mostActive: string | null = null;
  let mostActiveCount = 0;
  let mostBlocking: string | null = null;
  let mostBlockingRate = 0;

  for (const [guard, counts] of byGuard) {
    const total = counts.allow + counts.deny + counts.ask + counts.context + counts.silent;
    const blockRate = total > 0 ? Math.round((counts.deny / total) * 10000) / 100 : 0;

    metrics.push({
      guard,
      total,
      ...counts,
      block_rate: blockRate,
    });

    totalExecutions += total;

    if (total > mostActiveCount) {
      mostActiveCount = total;
      mostActive = guard;
    }

    // most_blocking requires minimum 5 executions
    if (total >= 5 && blockRate > mostBlockingRate) {
      mostBlockingRate = blockRate;
      mostBlocking = guard;
    }
  }

  // Sort by total descending
  metrics.sort((a, b) => b.total - a.total);

  return {
    total_executions: totalExecutions,
    by_guard: metrics,
    most_active: mostActive,
    most_blocking: mostBlocking,
  };
}
