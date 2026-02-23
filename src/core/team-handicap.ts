// SLOPE — Team Handicap & Swarm Performance
// Per-role handicap computation and swarm efficiency metrics.

import type {
  GolfScorecard,
  AgentBreakdown,
  MissDirection,
  HoleStats,
  RollingStats,
} from './types.js';
import { normalizeStats } from './builder.js';

/** Per-role handicap card — how a specific agent role performs across sprints */
export interface RoleHandicap {
  role: string;
  sprints_participated: number;
  total_shots: number;
  stats: RollingStats;
}

/** Swarm efficiency metrics for a set of sprints */
export interface SwarmEfficiency {
  total_sprints: number;
  total_agents: number;
  avg_agents_per_sprint: number;
  total_shots: number;
  total_score: number;
  avg_score_vs_par: number;
  coordination_events: number;
  efficiency_ratio: number;
}

/** Cross-agent dispersion — which role combinations produce results */
export interface RoleCombinationStats {
  roles: string[];
  sprint_count: number;
  avg_score_vs_par: number;
  total_hazards: number;
}

/** Complete team handicap report */
export interface TeamHandicapCard {
  overall: RollingStats;
  by_role: RoleHandicap[];
  swarm_efficiency: SwarmEfficiency;
  role_combinations: RoleCombinationStats[];
}

/**
 * Extract per-role agent breakdowns from scorecards that have agents data.
 * Groups all agent shot data by role across multiple sprints.
 */
export function extractRoleData(scorecards: GolfScorecard[]): Map<string, AgentBreakdown[]> {
  const byRole = new Map<string, AgentBreakdown[]>();

  for (const card of scorecards) {
    if (!card.agents || card.agents.length === 0) continue;
    for (const agent of card.agents) {
      const list = byRole.get(agent.agent_role) || [];
      list.push(agent);
      byRole.set(agent.agent_role, list);
    }
  }

  return byRole;
}

/**
 * Compute per-role handicap from agent breakdowns across sprints.
 */
export function computeRoleHandicap(role: string, breakdowns: AgentBreakdown[]): RoleHandicap {
  if (breakdowns.length === 0) {
    return {
      role,
      sprints_participated: 0,
      total_shots: 0,
      stats: zeroStats(),
    };
  }

  const n = breakdowns.length;
  let totalFairways = 0;
  let totalFairwaysTotal = 0;
  let totalGir = 0;
  let totalGirTotal = 0;
  let totalHazards = 0;
  let totalShots = 0;
  const missPattern: Record<MissDirection, number> = { long: 0, short: 0, left: 0, right: 0 };

  for (const bd of breakdowns) {
    const stats = bd.stats;
    totalFairways += stats.fairways_hit;
    totalFairwaysTotal += stats.fairways_total;
    totalGir += stats.greens_in_regulation;
    totalGirTotal += stats.greens_total;
    totalHazards += stats.hazards_hit;
    totalShots += (bd.shots ?? []).length;

    for (const dir of ['long', 'short', 'left', 'right'] as MissDirection[]) {
      missPattern[dir] += stats.miss_directions[dir] ?? 0;
    }
  }

  const fairway_pct = totalFairwaysTotal > 0
    ? Math.round((totalFairways / totalFairwaysTotal) * 1000) / 10
    : 0;

  const gir_pct = totalGirTotal > 0
    ? Math.round((totalGir / totalGirTotal) * 1000) / 10
    : 0;

  // Handicap for agents: average score (shots count) per participation
  const totalScore = breakdowns.reduce((sum, bd) => sum + bd.score, 0);
  const handicap = Math.round((totalScore / n) * 10) / 10;

  return {
    role,
    sprints_participated: n,
    total_shots: totalShots,
    stats: {
      handicap,
      fairway_pct,
      gir_pct,
      avg_putts: 0, // Not applicable per-agent
      penalties_per_round: 0,
      miss_pattern: missPattern,
      mulligans: 0,
      gimmes: 0,
    },
  };
}

/**
 * Compute swarm efficiency across a set of scorecards.
 * Efficiency ratio = productive shots / (total shots + coordination events).
 */
export function computeSwarmEfficiency(
  scorecards: GolfScorecard[],
  coordinationEvents?: number,
): SwarmEfficiency {
  const swarmCards = scorecards.filter(c => c.agents && c.agents.length > 0);

  if (swarmCards.length === 0) {
    return {
      total_sprints: 0,
      total_agents: 0,
      avg_agents_per_sprint: 0,
      total_shots: 0,
      total_score: 0,
      avg_score_vs_par: 0,
      coordination_events: coordinationEvents ?? 0,
      efficiency_ratio: 0,
    };
  }

  let totalAgents = 0;
  let totalShots = 0;

  for (const card of swarmCards) {
    totalAgents += card.agents!.length;
    totalShots += (card.shots ?? []).length;
  }

  const totalScore = swarmCards.reduce((sum, c) => sum + c.score, 0);
  const totalPar = swarmCards.reduce((sum, c) => sum + c.par, 0);
  const coordEvents = coordinationEvents ?? 0;

  // Efficiency = productive shots / (total shots + coordination overhead)
  const denominator = totalShots + coordEvents;
  const efficiency_ratio = denominator > 0
    ? Math.round((totalShots / denominator) * 1000) / 10
    : 0;

  return {
    total_sprints: swarmCards.length,
    total_agents: totalAgents,
    avg_agents_per_sprint: Math.round((totalAgents / swarmCards.length) * 10) / 10,
    total_shots: totalShots,
    total_score: totalScore,
    avg_score_vs_par: Math.round(((totalScore - totalPar) / swarmCards.length) * 10) / 10,
    coordination_events: coordEvents,
    efficiency_ratio,
  };
}

/**
 * Analyze which role combinations produce the best results.
 * Groups sprints by the set of roles present and computes averages.
 */
export function analyzeRoleCombinations(scorecards: GolfScorecard[]): RoleCombinationStats[] {
  const swarmCards = scorecards.filter(c => c.agents && c.agents.length > 0);
  const comboMap = new Map<string, { scores: number[]; hazards: number[] }>();

  for (const card of swarmCards) {
    const roles = [...new Set(card.agents!.map(a => a.agent_role))].sort();
    const key = roles.join('+');

    const entry = comboMap.get(key) || { scores: [], hazards: [] };
    entry.scores.push(card.score - card.par);
    entry.hazards.push(card.stats.hazards_hit);
    comboMap.set(key, entry);
  }

  return Array.from(comboMap.entries()).map(([key, data]) => ({
    roles: key.split('+'),
    sprint_count: data.scores.length,
    avg_score_vs_par: Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 10) / 10,
    total_hazards: data.hazards.reduce((a, b) => a + b, 0),
  }));
}

/**
 * Build a complete team handicap card from scorecards.
 * Includes overall rolling stats, per-role handicap, swarm efficiency,
 * and role combination analysis.
 */
export function computeTeamHandicap(
  scorecards: GolfScorecard[],
  coordinationEvents?: number,
): TeamHandicapCard {
  // Overall stats (same as regular handicap, using computeRollingStats pattern)
  const overall = computeOverallStats(scorecards);

  // Per-role handicap
  const roleData = extractRoleData(scorecards);
  const byRole: RoleHandicap[] = [];
  for (const [role, breakdowns] of roleData) {
    byRole.push(computeRoleHandicap(role, breakdowns));
  }
  // Sort by sprints participated descending
  byRole.sort((a, b) => b.sprints_participated - a.sprints_participated);

  // Swarm efficiency
  const swarmEfficiency = computeSwarmEfficiency(scorecards, coordinationEvents);

  // Role combinations
  const roleCombinations = analyzeRoleCombinations(scorecards);

  return {
    overall,
    by_role: byRole,
    swarm_efficiency: swarmEfficiency,
    role_combinations: roleCombinations,
  };
}

// --- Internal helpers ---

function zeroStats(): RollingStats {
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

function computeOverallStats(scorecards: GolfScorecard[]): RollingStats {
  if (scorecards.length === 0) return zeroStats();

  const n = scorecards.length;
  const totalDiff = scorecards.reduce((sum, sc) => sum + (sc.score - sc.par), 0);
  const handicap = Math.max(0, Math.round((totalDiff / n) * 10) / 10);

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
    const stats = normalizeStats(sc.stats, sc.shots?.length ?? 0);
    totalFairways += stats.fairways_hit;
    totalFairwaysTotal += stats.fairways_total;
    totalGir += stats.greens_in_regulation;
    totalGirTotal += stats.greens_total;
    totalPutts += stats.putts;
    totalPenalties += stats.penalties;
    for (const dir of ['long', 'short', 'left', 'right'] as MissDirection[]) {
      missPattern[dir] += stats.miss_directions[dir] ?? 0;
    }
    for (const play of sc.special_plays ?? []) {
      if (play === 'mulligan') totalMulligans++;
      if (play === 'gimme') totalGimmes++;
    }
  }

  return {
    handicap,
    fairway_pct: totalFairwaysTotal > 0 ? Math.round((totalFairways / totalFairwaysTotal) * 1000) / 10 : 0,
    gir_pct: totalGirTotal > 0 ? Math.round((totalGir / totalGirTotal) * 1000) / 10 : 0,
    avg_putts: Math.round((totalPutts / n) * 10) / 10,
    penalties_per_round: Math.round((totalPenalties / n) * 10) / 10,
    miss_pattern: missPattern,
    mulligans: totalMulligans,
    gimmes: totalGimmes,
  };
}
