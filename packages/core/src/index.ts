// SLOPE — Sprint Lifecycle & Operational Performance Engine
// Core library barrel export

// Types
export type {
  ClubSelection,
  ShotResult,
  HazardType,
  ConditionType,
  SpecialPlay,
  MissDirection,
  ScoreLabel,
  SprintType,
  HazardHit,
  ShotRecord,
  ConditionRecord,
  HoleStats,
  HoleScore,
  TrainingType,
  TrainingSession,
  NutritionCategory,
  NutritionEntry,
  NineteenthHole,
  GolfScorecard,
  RollingStats,
  HandicapCard,
  DispersionReport,
  AreaReport,
  ExecutionTrace,
  ShotClassification,
  ClubRecommendation,
  TrainingRecommendation,
  ClaimScope,
  SprintClaim,
  SprintConflict,
} from './types.js';

// Constants
export {
  PAR_THRESHOLDS,
  SLOPE_FACTORS,
  SCORE_LABELS,
  TRAINING_TYPE_MAP,
  NUTRITION_CHECKLIST,
} from './constants.js';

// Handicap
export {
  computePar,
  computeSlope,
  computeScoreLabel,
  computeHandicapCard,
} from './handicap.js';

// Builder
export {
  computeStatsFromShots,
  buildScorecard,
} from './builder.js';
export type { ScorecardInput } from './builder.js';

// Validation
export {
  validateScorecard,
} from './validation.js';
export type {
  ScorecardValidationError,
  ScorecardValidationWarning,
  ScorecardValidationResult,
} from './validation.js';

// Dispersion
export {
  computeDispersion,
  computeAreaPerformance,
} from './dispersion.js';

// Advisor
export {
  recommendClub,
  classifyShot,
  generateTrainingPlan,
} from './advisor.js';
export type {
  RecommendClubInput,
  TrainingPlanInput,
} from './advisor.js';

// Formatter
export {
  formatSprintReview,
  formatAdvisorReport,
} from './formatter.js';
export type {
  ProjectStats,
  ProjectStatsDelta,
  ReviewMode,
  AdvisorReportInput,
} from './formatter.js';

// Briefing
export {
  filterCommonIssues,
  extractHazardIndex,
  computeNutritionTrend,
  hazardBriefing,
  formatBriefing,
} from './briefing.js';
export type {
  RecurringPattern,
  CommonIssuesFile,
  SessionEntry,
  BriefingFilter,
  HazardEntry,
  NutritionTrend,
} from './briefing.js';

// Registry
export { checkConflicts } from './registry.js';
export type { SprintRegistry } from './registry.js';

// Store
export { SlopeStoreError } from './store.js';
export type { SlopeStore, SlopeSession, StoreErrorCode } from './store.js';

// Tournament Review
export {
  buildTournamentReview,
  formatTournamentReview,
} from './tournament.js';
export type {
  TournamentReview,
  TournamentSprintEntry,
  TournamentScoring,
  TournamentStats,
  TournamentHazard,
} from './types.js';

// Config
export type { SlopeConfig } from './config.js';
export { loadConfig, createConfig, resolveConfigPath } from './config.js';

// Loader
export { loadScorecards, detectLatestSprint, resolveCurrentSprint } from './loader.js';
