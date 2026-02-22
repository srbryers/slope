import type { GolfScorecard, ShotResult } from './types.js';
import { computeScoreLabel } from './handicap.js';

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

// --- Helpers ---

const MISS_RESULTS: Record<string, 'long' | 'short' | 'left' | 'right'> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

const GOOD_RESULTS = new Set<ShotResult>(['fairway', 'green', 'in_the_hole']);

function isValidISODate(s: string): boolean {
  const d = new Date(s);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s);
}

// --- Main validator ---

/**
 * Validate a SLOPE scorecard for internal consistency.
 * Accepts either `sprint_number` (TypeScript type) or `sprint` (retro JSON field name).
 */
export function validateScorecard(card: GolfScorecard & { sprint?: number }): ScorecardValidationResult {
  const errors: ScorecardValidationError[] = [];
  const warnings: ScorecardValidationWarning[] = [];

  // Normalize sprint field — retro JSONs use "sprint", TS type uses "sprint_number"
  const sprintNumber = card.sprint_number ?? card.sprint;

  // Rule 6: basic field validation
  if (![3, 4, 5].includes(card.par)) {
    errors.push({ code: 'INVALID_PAR', message: `par must be 3, 4, or 5 (got ${card.par})`, field: 'par' });
  }
  if (typeof card.score !== 'number' || card.score <= 0) {
    errors.push({ code: 'INVALID_SCORE', message: `score must be > 0 (got ${card.score})`, field: 'score' });
  }
  if (!card.date || !isValidISODate(card.date)) {
    errors.push({ code: 'INVALID_DATE', message: `date must be a valid ISO string (got "${card.date}")`, field: 'date' });
  }
  if (sprintNumber == null || typeof sprintNumber !== 'number' || sprintNumber <= 0) {
    errors.push({ code: 'MISSING_SPRINT', message: 'sprint_number (or sprint) is required and must be > 0', field: 'sprint_number' });
  }

  // Rule 1: score_label matches computeScoreLabel(score, par)
  if (typeof card.score === 'number' && card.score > 0 && [3, 4, 5].includes(card.par)) {
    const expected = computeScoreLabel(card.score, card.par);
    if (card.score_label !== expected) {
      errors.push({
        code: 'SCORE_LABEL_MISMATCH',
        message: `score_label "${card.score_label}" doesn't match computed "${expected}" (score=${card.score}, par=${card.par})`,
        field: 'score_label',
      });
    }
  }

  // Rule 2: stat bounds
  const stats = card.stats;
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
