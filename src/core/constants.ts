import type { ScoreLabel, TrainingType, NutritionCategory, SprintType, HazardSeverity, ReviewType, HazardType } from './types.js';

/** Maps ticket count ranges to par values */
export const PAR_THRESHOLDS: Record<number, [number, number]> = {
  3: [1, 2],
  4: [3, 4],
  5: [5, Infinity],
};

/** Factors that increase sprint slope (difficulty) */
export const SLOPE_FACTORS = [
  'cross_package',
  'schema_migration',
  'new_area',
  'external_dep',
  'concurrent_agents',
] as const;

/** Maps score relative to par to a label */
export const SCORE_LABELS: Record<number, ScoreLabel> = {
  [-2]: 'eagle',
  [-1]: 'birdie',
  [0]: 'par',
  [1]: 'bogey',
  [2]: 'double_bogey',
};

/** Maps hazard severity to penalty strokes */
export const HAZARD_SEVERITY_PENALTIES: Record<HazardSeverity, number> = {
  minor: 0,
  moderate: 0.5,
  major: 1,
  critical: 2,
};

/** Maps sprint types to training types for training log categorization */
export const TRAINING_TYPE_MAP: Partial<Record<SprintType, TrainingType>> = {
  research: 'driving_range',
  feedback: 'chipping_practice',
  'test-coverage': 'putting_practice',
};

/** Maps review types to hazard types for finding → hazard conversion */
export const REVIEW_TYPE_HAZARD_MAP: Record<ReviewType, HazardType> = {
  architect: 'bunker',
  code: 'rough',
  'ml-engineer': 'rough',
  security: 'water',
  ux: 'trees',
};

/** Stale session cleanup threshold (2 hours in ms) */
export const STALE_SESSION_THRESHOLD_MS = 7_200_000;

/** Default nutrition items to assess per sprint */
export const NUTRITION_CHECKLIST: NutritionCategory[] = [
  'hydration',
  'diet',
  'recovery',
  'supplements',
  'stretching',
];
