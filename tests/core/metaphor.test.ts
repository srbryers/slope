import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMetaphor,
  listMetaphors,
  hasMetaphor,
  validateMetaphor,
  golf,
  tennis,
  baseball,
  gaming,
  dnd,
  matrix,
  agile,
} from '../../src/core/index.js';
import type { MetaphorDefinition } from '../../src/core/index.js';

// All built-in metaphors
const ALL_METAPHORS = [golf, tennis, baseball, gaming, dnd, matrix, agile];
const ALL_IDS = ['golf', 'tennis', 'baseball', 'gaming', 'dnd', 'matrix', 'agile'];

describe('metaphor registry', () => {
  it('all 6 built-in metaphors are registered', () => {
    const registered = listMetaphors();
    expect(registered).toHaveLength(7);
    for (const id of ALL_IDS) {
      expect(hasMetaphor(id)).toBe(true);
    }
  });

  it('getMetaphor returns correct metaphor by ID', () => {
    for (const id of ALL_IDS) {
      const m = getMetaphor(id);
      expect(m.id).toBe(id);
    }
  });

  it('getMetaphor returns golf as fallback for unknown ID', () => {
    const m = getMetaphor('nonexistent');
    expect(m.id).toBe('golf');
  });

  it('hasMetaphor returns false for unknown ID', () => {
    expect(hasMetaphor('nonexistent')).toBe(false);
  });

  it('listMetaphors returns all definitions', () => {
    const list = listMetaphors();
    const ids = list.map((m) => m.id).sort();
    expect(ids).toEqual([...ALL_IDS].sort());
  });
});

describe('metaphor completeness', () => {
  for (const metaphor of ALL_METAPHORS) {
    it(`${metaphor.id}: passes validation with no errors`, () => {
      const errors = validateMetaphor(metaphor);
      expect(errors).toEqual([]);
    });
  }
});

describe('metaphor term coverage', () => {
  const CLUB_KEYS = ['driver', 'long_iron', 'short_iron', 'wedge', 'putter'] as const;
  const SHOT_KEYS = ['fairway', 'green', 'in_the_hole', 'missed_long', 'missed_short', 'missed_left', 'missed_right'] as const;
  const HAZARD_KEYS = ['bunker', 'water', 'ob', 'rough', 'trees'] as const;
  const CONDITION_KEYS = ['wind', 'rain', 'frost_delay', 'altitude', 'pin_position'] as const;
  const SPECIAL_KEYS = ['gimme', 'mulligan', 'provisional', 'lay_up', 'scramble'] as const;
  const MISS_KEYS = ['long', 'short', 'left', 'right'] as const;
  const SCORE_KEYS = ['eagle', 'birdie', 'par', 'bogey', 'double_bogey', 'triple_plus'] as const;
  const SPRINT_KEYS = ['feature', 'feedback', 'infra', 'bugfix', 'research', 'flow', 'test-coverage', 'audit'] as const;
  const TRAINING_KEYS = ['driving_range', 'chipping_practice', 'putting_practice', 'lessons'] as const;
  const NUTRITION_KEYS = ['hydration', 'diet', 'recovery', 'supplements', 'stretching'] as const;

  for (const metaphor of ALL_METAPHORS) {
    describe(metaphor.id, () => {
      it('has all club terms', () => {
        for (const key of CLUB_KEYS) {
          expect(metaphor.clubs[key]).toBeTruthy();
        }
      });

      it('has all shot result terms', () => {
        for (const key of SHOT_KEYS) {
          expect(metaphor.shotResults[key]).toBeTruthy();
        }
      });

      it('has all hazard terms', () => {
        for (const key of HAZARD_KEYS) {
          expect(metaphor.hazards[key]).toBeTruthy();
        }
      });

      it('has all condition terms', () => {
        for (const key of CONDITION_KEYS) {
          expect(metaphor.conditions[key]).toBeTruthy();
        }
      });

      it('has all special play terms', () => {
        for (const key of SPECIAL_KEYS) {
          expect(metaphor.specialPlays[key]).toBeTruthy();
        }
      });

      it('has all miss direction terms', () => {
        for (const key of MISS_KEYS) {
          expect(metaphor.missDirections[key]).toBeTruthy();
        }
      });

      it('has all score label terms', () => {
        for (const key of SCORE_KEYS) {
          expect(metaphor.scoreLabels[key]).toBeTruthy();
        }
      });

      it('has all sprint type terms', () => {
        for (const key of SPRINT_KEYS) {
          expect(metaphor.sprintTypes[key]).toBeTruthy();
        }
      });

      it('has all training type terms', () => {
        for (const key of TRAINING_KEYS) {
          expect(metaphor.trainingTypes[key]).toBeTruthy();
        }
      });

      it('has all nutrition terms', () => {
        for (const key of NUTRITION_KEYS) {
          expect(metaphor.nutrition[key]).toBeTruthy();
        }
      });

      it('has complete vocabulary', () => {
        expect(metaphor.vocabulary.sprint).toBeTruthy();
        expect(metaphor.vocabulary.ticket).toBeTruthy();
        expect(metaphor.vocabulary.scorecard).toBeTruthy();
        expect(metaphor.vocabulary.handicapCard).toBeTruthy();
        expect(metaphor.vocabulary.briefing).toBeTruthy();
        expect(metaphor.vocabulary.perfectScore).toBeTruthy();
        expect(metaphor.vocabulary.onTarget).toBeTruthy();
        expect(metaphor.vocabulary.review).toBeTruthy();
      });
    });
  }
});

describe('metaphor uniqueness', () => {
  it('each metaphor has a unique ID', () => {
    const ids = ALL_METAPHORS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('golf terms differ from gaming terms', () => {
    expect(golf.vocabulary.sprint).not.toBe(gaming.vocabulary.sprint);
    expect(golf.clubs.driver).not.toBe(gaming.clubs.driver);
    expect(golf.scoreLabels.eagle).not.toBe(gaming.scoreLabels.eagle);
  });
});

describe('validateMetaphor', () => {
  it('returns errors for incomplete metaphor', () => {
    const incomplete = {
      id: 'broken',
      name: 'Broken',
      description: 'Missing everything',
      vocabulary: {} as MetaphorDefinition['vocabulary'],
      clubs: {} as MetaphorDefinition['clubs'],
      shotResults: {} as MetaphorDefinition['shotResults'],
      hazards: {} as MetaphorDefinition['hazards'],
      conditions: {} as MetaphorDefinition['conditions'],
      specialPlays: {} as MetaphorDefinition['specialPlays'],
      missDirections: {} as MetaphorDefinition['missDirections'],
      scoreLabels: {} as MetaphorDefinition['scoreLabels'],
      sprintTypes: {} as MetaphorDefinition['sprintTypes'],
      trainingTypes: {} as MetaphorDefinition['trainingTypes'],
      nutrition: {} as MetaphorDefinition['nutrition'],
    } as MetaphorDefinition;

    const errors = validateMetaphor(incomplete);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('clubs'))).toBe(true);
    expect(errors.some((e) => e.includes('vocabulary'))).toBe(true);
  });

  it('returns specific missing term errors', () => {
    const partial = { ...golf, clubs: { ...golf.clubs, driver: '' } } as MetaphorDefinition;
    const errors = validateMetaphor(partial);
    expect(errors).toContain('clubs: missing term for "driver"');
  });
});

describe('config integration', () => {
  it('loadConfig includes metaphor field with default', async () => {
    const { loadConfig } = await import('../../src/cli/config.js');
    const config = loadConfig('/nonexistent/path');
    expect(config.metaphor).toBe('golf');
  });
});
