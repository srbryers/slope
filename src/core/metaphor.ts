// SLOPE — Metaphor Engine
// ════════════════════════════════════════════════════════════
// Metaphors are display-only — they affect output strings, not the type system.
// Internal types (GolfScorecard, HoleScore, ClubSelection, etc.) remain golf-derived.

import type {
  ClubSelection,
  ShotResult,
  HazardType,
  ConditionType,
  SpecialPlay,
  MissDirection,
  ScoreLabel,
  SprintType,
  TrainingType,
  NutritionCategory,
} from './types.js';

// --- Term Maps ---

/** Display names for club selections (approach complexity) */
export type ClubTerms = Record<ClubSelection, string>;

/** Display names for shot results (ticket outcomes) */
export type ShotResultTerms = Record<ShotResult, string>;

/** Display names for hazard types */
export type HazardTerms = Record<HazardType, string>;

/** Display names for external conditions */
export type ConditionTerms = Record<ConditionType, string>;

/** Display names for special plays */
export type SpecialPlayTerms = Record<SpecialPlay, string>;

/** Display names for miss directions */
export type MissDirectionTerms = Record<MissDirection, string>;

/** Display names for score labels */
export type ScoreLabelTerms = Record<ScoreLabel, string>;

/** Display names for sprint types */
export type SprintTypeTerms = Record<SprintType, string>;

/** Display names for training types */
export type TrainingTypeTerms = Record<TrainingType, string>;

/** Display names for nutrition categories */
export type NutritionTerms = Record<NutritionCategory, string>;

// --- Vocabulary ---

/** Metaphor-specific vocabulary for framework concepts */
export interface MetaphorVocabulary {
  /** What a sprint is called (e.g., "hole", "set", "inning") */
  sprint: string;
  /** What a ticket is called (e.g., "shot", "point", "at-bat") */
  ticket: string;
  /** What the scorecard is called (e.g., "scorecard", "match report") */
  scorecard: string;
  /** What the handicap card is called (e.g., "handicap card", "player stats") */
  handicapCard: string;
  /** What the briefing is called (e.g., "pre-round briefing", "pre-match scouting") */
  briefing: string;
  /** What a perfect score is called (e.g., "hole-in-one", "ace") */
  perfectScore: string;
  /** What par means (e.g., "par", "expected", "baseline") */
  onTarget: string;
  /** What the review is called (e.g., "19th hole", "post-match") */
  review: string;
}

// --- MetaphorDefinition ---

/** A complete metaphor definition — all display terms for SLOPE output */
export interface MetaphorDefinition {
  /** Unique identifier (e.g., "golf", "tennis", "gaming") */
  id: string;
  /** Human-readable name (e.g., "Golf", "Tennis", "Gaming") */
  name: string;
  /** Brief description of the metaphor */
  description: string;

  /** Framework vocabulary */
  vocabulary: MetaphorVocabulary;

  /** Term maps for all enum types */
  clubs: ClubTerms;
  shotResults: ShotResultTerms;
  hazards: HazardTerms;
  conditions: ConditionTerms;
  specialPlays: SpecialPlayTerms;
  missDirections: MissDirectionTerms;
  scoreLabels: ScoreLabelTerms;
  sprintTypes: SprintTypeTerms;
  trainingTypes: TrainingTypeTerms;
  nutrition: NutritionTerms;
}

// --- Registry ---

const registry = new Map<string, MetaphorDefinition>();

/** Register a metaphor definition */
export function registerMetaphor(metaphor: MetaphorDefinition): void {
  registry.set(metaphor.id, metaphor);
}

/** Get a metaphor by ID. Returns the golf metaphor as fallback if not found. */
export function getMetaphor(id: string): MetaphorDefinition {
  const metaphor = registry.get(id);
  if (metaphor) return metaphor;
  const golf = registry.get('golf');
  if (golf) return golf;
  throw new Error(`Metaphor "${id}" not found and no default registered`);
}

/** List all registered metaphors */
export function listMetaphors(): MetaphorDefinition[] {
  return Array.from(registry.values());
}

/** Check if a metaphor ID is registered */
export function hasMetaphor(id: string): boolean {
  return registry.has(id);
}

// --- Validation ---

/** Required keys for each term map — used to validate metaphor completeness */
const REQUIRED_CLUBS: ClubSelection[] = ['driver', 'long_iron', 'short_iron', 'wedge', 'putter'];
const REQUIRED_SHOTS: ShotResult[] = ['fairway', 'green', 'in_the_hole', 'missed_long', 'missed_short', 'missed_left', 'missed_right'];
const REQUIRED_HAZARDS: HazardType[] = ['bunker', 'water', 'ob', 'rough', 'trees'];
const REQUIRED_CONDITIONS: ConditionType[] = ['wind', 'rain', 'frost_delay', 'altitude', 'pin_position'];
const REQUIRED_SPECIALS: SpecialPlay[] = ['gimme', 'mulligan', 'provisional', 'lay_up', 'scramble'];
const REQUIRED_MISS: MissDirection[] = ['long', 'short', 'left', 'right'];
const REQUIRED_SCORES: ScoreLabel[] = ['eagle', 'birdie', 'par', 'bogey', 'double_bogey', 'triple_plus'];
const REQUIRED_SPRINT_TYPES: SprintType[] = ['feature', 'feedback', 'infra', 'bugfix', 'research', 'flow', 'test-coverage', 'audit'];
const REQUIRED_TRAINING: TrainingType[] = ['driving_range', 'chipping_practice', 'putting_practice', 'lessons'];
const REQUIRED_NUTRITION: NutritionCategory[] = ['hydration', 'diet', 'recovery', 'supplements', 'stretching'];

/** Schema describing all required keys for each MetaphorDefinition category. Agents use this to generate valid custom metaphors. */
export const METAPHOR_SCHEMA = {
  vocabulary: ['sprint', 'ticket', 'scorecard', 'handicapCard', 'briefing', 'perfectScore', 'onTarget', 'review'] as const,
  clubs: REQUIRED_CLUBS,
  shotResults: REQUIRED_SHOTS,
  hazards: REQUIRED_HAZARDS,
  conditions: REQUIRED_CONDITIONS,
  specialPlays: REQUIRED_SPECIALS,
  missDirections: REQUIRED_MISS,
  scoreLabels: REQUIRED_SCORES,
  sprintTypes: REQUIRED_SPRINT_TYPES,
  trainingTypes: REQUIRED_TRAINING,
  nutrition: REQUIRED_NUTRITION,
};

/** Validate that a metaphor definition covers every required term */
export function validateMetaphor(metaphor: MetaphorDefinition): string[] {
  const errors: string[] = [];

  function checkKeys<T extends string>(mapName: string, map: Record<T, string>, required: T[]): void {
    for (const key of required) {
      if (!map[key]) {
        errors.push(`${mapName}: missing term for "${key}"`);
      }
    }
  }

  checkKeys('clubs', metaphor.clubs, REQUIRED_CLUBS);
  checkKeys('shotResults', metaphor.shotResults, REQUIRED_SHOTS);
  checkKeys('hazards', metaphor.hazards, REQUIRED_HAZARDS);
  checkKeys('conditions', metaphor.conditions, REQUIRED_CONDITIONS);
  checkKeys('specialPlays', metaphor.specialPlays, REQUIRED_SPECIALS);
  checkKeys('missDirections', metaphor.missDirections, REQUIRED_MISS);
  checkKeys('scoreLabels', metaphor.scoreLabels, REQUIRED_SCORES);
  checkKeys('sprintTypes', metaphor.sprintTypes, REQUIRED_SPRINT_TYPES);
  checkKeys('trainingTypes', metaphor.trainingTypes, REQUIRED_TRAINING);
  checkKeys('nutrition', metaphor.nutrition, REQUIRED_NUTRITION);

  // Check vocabulary completeness
  const vocabKeys: (keyof MetaphorVocabulary)[] = [
    'sprint', 'ticket', 'scorecard', 'handicapCard', 'briefing',
    'perfectScore', 'onTarget', 'review',
  ];
  for (const key of vocabKeys) {
    if (!metaphor.vocabulary[key]) {
      errors.push(`vocabulary: missing "${key}"`);
    }
  }

  return errors;
}
