import type { GolfScorecard, HazardSeverity, ShotResult } from './types.js';
import { computeScoreLabel } from './handicap.js';
import { normalizeStats } from './builder.js';
import { sprintIdKey, type SprintId } from './sprint-id.js';

// --- Validation-specific types ---

export interface ScorecardValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ScorecardValidationWarning {
  code: string;
  message: string;
}

export interface ScorecardValidationResult {
  valid: boolean;
  errors: ScorecardValidationError[];
  warnings: ScorecardValidationWarning[];
}

export interface ScorecardValidationOptions {
  knownSkillIds?: Set<string> | string[];
}

// --- Helpers ---

const MISS_RESULTS: Record<string, 'long' | 'short' | 'left' | 'right'> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

const GOOD_RESULTS = new Set<ShotResult>(['fairway', 'green', 'in_the_hole']);
const SKILL_REFERENCE_FIELDS = ['skills_used', 'skills_created', 'skills_recommended', 'skills_skipped'] as const;
const SKILL_NOTE_FIELDS = ['skill_gaps_found'] as const;

function isValidISODate(s: string): boolean {
  const d = new Date(s);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s);
}

// --- Main validator ---

/**
 * Validate a SLOPE scorecard for internal consistency.
 * Accepts either `sprint_number` (TypeScript type) or `sprint` (retro JSON field name).
 */
export function validateScorecard(
  card: GolfScorecard & { sprint?: SprintId; completed_on?: string; started_on?: string; scored?: boolean },
  options: ScorecardValidationOptions = {},
): ScorecardValidationResult {
  const errors: ScorecardValidationError[] = [];
  const warnings: ScorecardValidationWarning[] = [];
  const knownSkillIds = options.knownSkillIds
    ? options.knownSkillIds instanceof Set
      ? options.knownSkillIds
      : new Set(options.knownSkillIds)
    : null;

  // Normalize sprint field — retro JSONs use "sprint", TS type uses "sprint_number"
  const sprintNumber = card.sprint_number ?? card.sprint;
  const validPar = [3, 4, 5].includes(card.par);
  const hasExplicitScore = typeof card.score === 'number' && !Number.isNaN(card.score);
  const effectiveScore = hasExplicitScore ? card.score : validPar ? card.par : undefined;
  const effectiveDate = card.date ?? card.completed_on ?? card.started_on;

  /*
   * `scored: false` -- a sprint that CLOSED WITHOUT BEING SCORED.
   *
   * There was no way to say this, and the gap had teeth. A project archiving old phases hit 31
   * sprints marked complete in archived phases with no scorecard under any name. `roadmap archive`
   * refuses to compact over them, and it only needs a link, a file, and a matching sprint_number --
   * it never reads the score. But this validator demanded par, score and an ISO date, so the only
   * card that satisfied the archive failed validation, 31 times over.
   *
   * That left one honest option and one dishonest one: break a gate, or invent 31 scores. Inventing
   * them is the worse of the two by a distance, because the handicap those numbers feed is the
   * whole point of the tool. A record that says "this closed and nobody scored it" is true, and
   * truth that a gate cannot express gets rounded to a lie.
   *
   * So an unscored card must carry `scored: false` explicitly. It is not a way to skip the checks:
   * a card that simply omits `score` still fails, because forgetting to score a sprint and
   * deliberately recording that one went unscored are different things and should look different.
   * Everything downstream that computes a handicap must skip these.
   */
  const unscored = card.scored === false;

  // Rule 6: basic field validation
  if (!unscored && !validPar) {
    errors.push({ code: 'INVALID_PAR', message: `par must be 3, 4, or 5 (got ${card.par})`, field: 'par' });
  }
  if (!unscored && (typeof effectiveScore !== 'number' || effectiveScore <= 0)) {
    errors.push({ code: 'INVALID_SCORE', message: `score must be > 0 (got ${card.score})`, field: 'score' });
  }
  if (!unscored && (typeof effectiveDate !== 'string' || !isValidISODate(effectiveDate))) {
    errors.push({ code: 'INVALID_DATE', message: `date must be a valid ISO string (got "${effectiveDate}")`, field: 'date' });
  }
  if (unscored && hasExplicitScore) {
    errors.push({
      code: 'UNSCORED_WITH_SCORE',
      message: 'a card marked scored: false must not also carry a score',
      field: 'scored',
    });
  }
  if (sprintNumber == null || sprintIdKey(sprintNumber) === null) {
    errors.push({ code: 'MISSING_SPRINT', message: 'sprint_number (or sprint) is required and must be > 0', field: 'sprint_number' });
  }

  validateSkillFields(card as unknown as Record<string, unknown>, errors, knownSkillIds);

  // Rule 1: score_label matches computeScoreLabel(score, par)
  if (typeof effectiveScore === 'number' && effectiveScore > 0 && validPar) {
    const expected = computeScoreLabel(effectiveScore, card.par);
    if (card.score_label != null && card.score_label !== expected) {
      errors.push({
        code: 'SCORE_LABEL_MISMATCH',
        message: `score_label "${card.score_label}" doesn't match computed "${expected}" (score=${effectiveScore}, par=${card.par})`,
        field: 'score_label',
      });
    }
  }

  // Rule 2: stat bounds
  const stats = card.stats ? normalizeStats(card.stats, card.shots?.length ?? 0) : null;
  if (stats) {
    if (stats.fairways_hit > stats.fairways_total) {
      errors.push({
        code: 'FAIRWAYS_OVERFLOW',
        message: `fairways_hit (${stats.fairways_hit}) > fairways_total (${stats.fairways_total})`,
        field: 'stats.fairways_hit',
      });
    }
    if (stats.greens_in_regulation > stats.greens_total) {
      errors.push({
        code: 'GIR_OVERFLOW',
        message: `greens_in_regulation (${stats.greens_in_regulation}) > greens_total (${stats.greens_total})`,
        field: 'stats.greens_in_regulation',
      });
    }
  }

  // Rule 3: shots.length matches stats.fairways_total
  if (stats && card.shots) {
    if (card.shots.length !== stats.fairways_total) {
      errors.push({
        code: 'SHOTS_COUNT_MISMATCH',
        message: `shots.length (${card.shots.length}) doesn't match stats.fairways_total (${stats.fairways_total})`,
        field: 'shots',
      });
    }
  }

  // Rule 4: hazards_hit consistent with total hazard count from shots
  if (stats && card.shots) {
    const totalHazards = card.shots.reduce((sum, s) => sum + s.hazards.length, 0);
    if (stats.hazards_hit !== totalHazards) {
      errors.push({
        code: 'HAZARDS_COUNT_MISMATCH',
        message: `stats.hazards_hit (${stats.hazards_hit}) doesn't match total hazards from shots (${totalHazards})`,
        field: 'stats.hazards_hit',
      });
    }

    // Rule 4b: hazard severity values must be valid
    const VALID_SEVERITIES: Set<string> = new Set<string>(['minor', 'moderate', 'major', 'critical']);
    for (const shot of card.shots) {
      for (const hazard of shot.hazards) {
        if (hazard.severity != null && !VALID_SEVERITIES.has(hazard.severity)) {
          errors.push({
            code: 'INVALID_HAZARD_SEVERITY',
            message: `hazard severity "${hazard.severity}" is not valid (expected minor|moderate|major|critical)`,
            field: 'shots[].hazards[].severity',
          });
        }
      }
    }
  }

  // Rule 5: miss_directions consistent with shot results
  if (stats && card.shots) {
    const computedMiss: Record<string, number> = { long: 0, short: 0, left: 0, right: 0 };
    for (const shot of card.shots) {
      const dir = MISS_RESULTS[shot.result];
      if (dir) {
        computedMiss[dir]++;
      }
    }
    for (const dir of ['long', 'short', 'left', 'right'] as const) {
      const actual = stats.miss_directions[dir] ?? 0;
      const expected = computedMiss[dir];
      if (actual !== expected) {
        errors.push({
          code: 'MISS_DIRECTION_MISMATCH',
          message: `miss_directions.${dir} is ${actual} but ${expected} shots had missed_${dir} result`,
          field: `stats.miss_directions.${dir}`,
        });
      }
    }
  }

  // Rule 7: warnings for optional but recommended fields
  if (!card.player) {
    warnings.push({ code: 'NO_PLAYER', message: 'No player field — scorecard attributed to default player' });
  }
  if (!card.bunker_locations || card.bunker_locations.length === 0) {
    warnings.push({ code: 'EMPTY_BUNKERS', message: 'No bunker_locations recorded — consider noting hazards for future sprints' });
  }
  if (!card.training || card.training.length === 0) {
    warnings.push({ code: 'NO_TRAINING', message: 'No training sessions recorded' });
  }
  if (!card.nutrition || card.nutrition.length === 0) {
    warnings.push({ code: 'NO_NUTRITION', message: 'No nutrition (dev health) entries recorded' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateSkillFields(
  card: Record<string, unknown>,
  errors: ScorecardValidationError[],
  knownSkillIds: Set<string> | null,
): void {
  for (const field of [...SKILL_REFERENCE_FIELDS, ...SKILL_NOTE_FIELDS]) {
    const value = card[field];
    if (value == null) continue;
    if (!Array.isArray(value)) {
      errors.push({
        code: 'INVALID_SKILL_FIELD',
        message: `${field} must be an array of strings`,
        field,
      });
      continue;
    }

    for (const item of value) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        errors.push({
          code: 'INVALID_SKILL_FIELD',
          message: `${field} must contain only non-empty strings`,
          field,
        });
      }
    }
  }

  if (!knownSkillIds) return;

  for (const field of SKILL_REFERENCE_FIELDS) {
    const values = card[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== 'string' || value.trim().length === 0) continue;
      if (!knownSkillIds.has(value)) {
        errors.push({
          code: 'UNKNOWN_SKILL_REFERENCE',
          message: `${field} references unknown skill "${value}"`,
          field,
        });
      }
    }
  }
}
