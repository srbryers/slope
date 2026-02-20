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
