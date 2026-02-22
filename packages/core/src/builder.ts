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
  AgentBreakdown,
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

// --- Stats normalization ---

/**
 * Normalize any stats shape to a proper HoleStats object.
 * Handles the simplified format ({ fairway: true, putts: 0 }) used by
 * some scorecards, falling back to safe defaults for missing fields.
 */
export function normalizeStats(raw: unknown, shotCount = 0): HoleStats {
  if (!raw || typeof raw !== 'object') {
    return {
      fairways_hit: 0, fairways_total: 0,
      greens_in_regulation: 0, greens_total: 0,
      putts: 0, penalties: 0, hazards_hit: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    };
  }

  const s = raw as Record<string, unknown>;

  if ('fairways_hit' in s && 'fairways_total' in s) {
    return {
      fairways_hit: Number(s.fairways_hit) || 0,
      fairways_total: Number(s.fairways_total) || 0,
      greens_in_regulation: Number(s.greens_in_regulation) || 0,
      greens_total: Number(s.greens_total) || 0,
      putts: Number(s.putts) || 0,
      penalties: Number(s.penalties) || 0,
      hazards_hit: Number(s.hazards_hit) || 0,
      miss_directions: normalizeMissDirections(s.miss_directions),
    };
  }

  const fairwayHit = s.fairway === true ? shotCount : 0;
  const girHit = s.gir === true ? shotCount : 0;

  return {
    fairways_hit: fairwayHit,
    fairways_total: shotCount,
    greens_in_regulation: girHit,
    greens_total: shotCount,
    putts: Number(s.putts) || 0,
    penalties: Number(s.penalties) || 0,
    hazards_hit: Number(s.hazards_hit) || 0,
    miss_directions: normalizeMissDirections(s.miss_directions),
  };
}

function normalizeMissDirections(raw: unknown): Record<MissDirection, number> {
  const defaults: Record<MissDirection, number> = { long: 0, short: 0, left: 0, right: 0 };
  if (!raw || typeof raw !== 'object') return defaults;
  const r = raw as Record<string, unknown>;
  return {
    long: Number(r.long) || 0,
    short: Number(r.short) || 0,
    left: Number(r.left) || 0,
    right: Number(r.right) || 0,
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

  // Multi-agent (swarm) sprints
  agents?: AgentBreakdown[];
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
    ...(input.agents ? { agents: input.agents } : {}),
  };
}

// --- Agent Aggregation ---

/** Input for building per-agent breakdowns from swarm session data */
export interface AgentShotInput {
  session_id: string;
  agent_role: string;
  shots: ShotRecord[];
}

/**
 * Build AgentBreakdown entries from per-agent shot data.
 * Each agent's score and stats are computed independently.
 */
export function buildAgentBreakdowns(agents: AgentShotInput[]): AgentBreakdown[] {
  return agents.map((agent) => {
    const stats = computeStatsFromShots(agent.shots);
    return {
      session_id: agent.session_id,
      agent_role: agent.agent_role,
      shots: agent.shots,
      score: agent.shots.length,
      stats,
    };
  });
}
