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
  ClubSelection,
  HazardHit,
  HazardSeverity,
  HazardType,
} from './types.js';
import { computeScoreLabel } from './handicap.js';
import { HAZARD_SEVERITY_PENALTIES } from './constants.js';

// --- Helpers ---

const MISS_RESULT_TO_DIR: Partial<Record<ShotResult, MissDirection>> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

const CLUBS: readonly ClubSelection[] = ['driver', 'long_iron', 'short_iron', 'wedge', 'putter'];
const SHOT_RESULTS: readonly ShotResult[] = ['fairway', 'green', 'in_the_hole', 'missed_long', 'missed_short', 'missed_left', 'missed_right'];
const HAZARD_TYPES: readonly HazardType[] = ['bunker', 'water', 'ob', 'rough', 'trees'];
const HAZARD_SEVERITIES: readonly HazardSeverity[] = ['minor', 'moderate', 'major', 'critical'];

/** Runtime-friendly shot input accepted by buildScorecard, including MCP/JS aliases. */
export interface ScorecardShotInput {
  ticket_key?: string;
  /** Backward-compatible alias used by early MCP examples. */
  ticket?: string;
  title?: string;
  club: ClubSelection;
  result: ShotResult;
  hazards?: Array<HazardHit | string>;
  provisional_declared?: boolean;
  notes?: string;
}

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
  let hazardPenalties = 0;
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
    for (const hazard of shot.hazards) {
      hazardPenalties += HAZARD_SEVERITY_PENALTIES[hazard.severity ?? 'minor'];
    }
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
    hazard_penalties: hazardPenalties,
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
      putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    };
  }

  const s = raw as Record<string, unknown>;

  if ('fairways_hit' in s && 'fairways_total' in s) {
    const numberOrDefault = (value: unknown, fallback: number) => (
      value == null ? fallback : Number(value) || 0
    );
    return {
      fairways_hit: Number(s.fairways_hit) || 0,
      fairways_total: numberOrDefault(s.fairways_total, shotCount),
      greens_in_regulation: Number(s.greens_in_regulation) || 0,
      greens_total: numberOrDefault(s.greens_total, shotCount),
      putts: Number(s.putts) || 0,
      penalties: Number(s.penalties) || 0,
      hazards_hit: Number(s.hazards_hit) || 0,
      hazard_penalties: Number(s.hazard_penalties) || 0,
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
    hazard_penalties: Number(s.hazard_penalties) || 0,
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
  shots: ScorecardShotInput[];
  player?: string;

  // Optional overrides for fields that can't be derived from shots
  putts?: number;
  penalties?: number;
  /** Optional judged final score. Defaults to par plus recorded misses/penalties. */
  score?: number;
  type?: SprintType;
  conditions?: ConditionRecord[];
  special_plays?: SpecialPlay[];
  training?: TrainingSession[];
  nutrition?: NutritionEntry[];
  nineteenth_hole?: NineteenthHole;
  bunker_locations?: string[];
  yardage_book_updates?: string[];
  course_management_notes?: string[];
  skills_used?: string[];
  skills_created?: string[];
  skills_recommended?: string[];
  skills_skipped?: string[];
  skill_gaps_found?: string[];

  // Multi-agent (swarm) sprints
  agents?: AgentBreakdown[];

  // Inspiration tracking
  inspired_by?: string[];
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
  validateScorecardInput(input);
  const shots = input.shots.map((shot, index) => normalizeScorecardShot(shot, input.sprint_number, index));
  const penalties = input.penalties ?? 0;
  const stats = computeStatsFromShots(shots, {
    putts: input.putts ?? 0,
    penalties,
  });

  // Score is quality relative to sprint par, not ticket count. Par already
  // captures sprint size (1-2 → 3, 3-4 → 4, 5+ → 5), so counting every
  // ticket again punishes larger, clean sprints. Misses and penalties add
  // strokes; callers may provide a judged score when the retro warrants it.
  const missCount = Object.values(stats.miss_directions).reduce((a, b) => a + b, 0);
  const score = Math.round(input.score ?? (input.par + missCount + penalties + stats.hazard_penalties));
  const score_label: ScoreLabel = computeScoreLabel(score, input.par);

  return {
    sprint_number: input.sprint_number,
    ...(input.player ? { player: input.player } : {}),
    theme: input.theme,
    par: input.par,
    slope: input.slope,
    score,
    score_label,
    date: input.date,
    shots,
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
    ...(input.skills_used ? { skills_used: input.skills_used } : {}),
    ...(input.skills_created ? { skills_created: input.skills_created } : {}),
    ...(input.skills_recommended ? { skills_recommended: input.skills_recommended } : {}),
    ...(input.skills_skipped ? { skills_skipped: input.skills_skipped } : {}),
    ...(input.skill_gaps_found ? { skill_gaps_found: input.skill_gaps_found } : {}),
    ...(input.agents ? { agents: input.agents } : {}),
    ...(input.inspired_by ? { inspired_by: input.inspired_by } : {}),
  };
}

function validateScorecardInput(input: ScorecardInput): void {
  if (!Number.isFinite(input.sprint_number) || input.sprint_number <= 0) {
    throw new Error('Scorecard sprint_number must be a positive number');
  }
  if (input.par !== 3 && input.par !== 4 && input.par !== 5) {
    throw new Error('Scorecard par must be 3, 4, or 5');
  }
  if (!Number.isFinite(input.slope) || input.slope < 0) {
    throw new Error('Scorecard slope must be a non-negative number; call computeSlope with an array of factor names');
  }
  if (input.score !== undefined && (!Number.isFinite(input.score) || input.score < 0)) {
    throw new Error('Scorecard score override must be a non-negative number');
  }
  if (!Array.isArray(input.shots)) {
    throw new Error('Scorecard shots must be an array');
  }
}

function normalizeScorecardShot(raw: ScorecardShotInput, sprintNumber: number, index: number): ShotRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Scorecard shot ${index + 1} must be an object`);
  }
  const ticketKey = raw.ticket_key?.trim() || raw.ticket?.trim();
  if (!ticketKey) {
    throw new Error(`Scorecard shot ${index + 1} requires ticket_key (ticket is accepted as a backward-compatible alias)`);
  }
  if (!CLUBS.includes(raw.club)) {
    throw new Error(`Scorecard shot ${ticketKey} has invalid club "${String(raw.club)}"`);
  }
  if (!SHOT_RESULTS.includes(raw.result)) {
    throw new Error(`Scorecard shot ${ticketKey} has invalid result "${String(raw.result)}"`);
  }
  const hazards = (raw.hazards ?? []).map((hazard, hazardIndex) =>
    normalizeScorecardHazard(hazard, ticketKey, hazardIndex),
  );
  return {
    ticket_key: ticketKey,
    title: raw.title?.trim() || `${ticketKey} (Sprint ${sprintNumber})`,
    club: raw.club,
    result: raw.result,
    hazards,
    ...(raw.provisional_declared !== undefined ? { provisional_declared: raw.provisional_declared } : {}),
    ...(raw.notes?.trim() ? { notes: raw.notes.trim() } : {}),
  };
}

function normalizeScorecardHazard(
  raw: HazardHit | string,
  ticketKey: string,
  index: number,
): HazardHit {
  if (typeof raw === 'string') {
    const description = raw.trim();
    if (!description) throw new Error(`Scorecard shot ${ticketKey} hazard ${index + 1} cannot be empty`);
    return { type: 'rough', severity: 'minor', description };
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Scorecard shot ${ticketKey} hazard ${index + 1} must be a string or hazard object`);
  }
  if (!HAZARD_TYPES.includes(raw.type)) {
    throw new Error(`Scorecard shot ${ticketKey} hazard ${index + 1} has invalid type "${String(raw.type)}"`);
  }
  if (raw.severity !== undefined && !HAZARD_SEVERITIES.includes(raw.severity)) {
    throw new Error(`Scorecard shot ${ticketKey} hazard ${index + 1} has invalid severity "${String(raw.severity)}"`);
  }
  const description = raw.description?.trim();
  if (!description) {
    throw new Error(`Scorecard shot ${ticketKey} hazard ${index + 1} requires a description`);
  }
  return {
    type: raw.type,
    ...(raw.severity ? { severity: raw.severity } : {}),
    description,
    ...(raw.gotcha_id?.trim() ? { gotcha_id: raw.gotcha_id.trim() } : {}),
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
      score: Math.round(agent.shots.length + stats.hazard_penalties),
      stats,
    };
  });
}
