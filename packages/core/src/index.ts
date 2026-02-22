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
  AgentBreakdown,
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
  EventType,
  SlopeEvent,
  CIRunner,
  CISignal,
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
  buildAgentBreakdowns,
} from './builder.js';
export type { ScorecardInput, AgentShotInput } from './builder.js';

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
  classifyShotFromSignals,
  generateTrainingPlan,
} from './advisor.js';
export type {
  RecommendClubInput,
  TrainingPlanInput,
  CombinedSignals,
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

// Roadmap
export {
  validateRoadmap,
  computeCriticalPath,
  findParallelOpportunities,
  parseRoadmap,
  formatRoadmapSummary,
  formatStrategicContext,
} from './roadmap.js';
export type {
  RoadmapDefinition,
  RoadmapSprint,
  RoadmapTicket,
  RoadmapPhase,
  RoadmapClub,
  RoadmapValidationResult,
  RoadmapValidationError,
  RoadmapValidationWarning,
  CriticalPathResult,
  ParallelGroup,
} from './roadmap.js';

// Config
export type { SlopeConfig } from './config.js';
export { loadConfig, createConfig, resolveConfigPath } from './config.js';

// Loader
export { loadScorecards, detectLatestSprint, resolveCurrentSprint } from './loader.js';

// Metaphor
export {
  registerMetaphor,
  getMetaphor,
  listMetaphors,
  hasMetaphor,
  validateMetaphor,
} from './metaphor.js';
export type {
  MetaphorDefinition,
  MetaphorVocabulary,
  ClubTerms,
  ShotResultTerms,
  HazardTerms,
  ConditionTerms,
  SpecialPlayTerms,
  MissDirectionTerms,
  ScoreLabelTerms,
  SprintTypeTerms,
  TrainingTypeTerms,
  NutritionTerms,
} from './metaphor.js';

// Event Pipeline
export {
  clusterEvents,
  findPromotionCandidates,
  runPipeline,
} from './pipeline.js';
export type {
  EventCluster,
  PromotionCandidate,
  PipelineResult,
} from './pipeline.js';

// CI Signal Parser
export {
  detectRunner,
  parseTestOutput,
  parseVitestOutput,
  parseJestOutput,
} from './ci-signals.js';

// Guard Framework
export {
  GUARD_DEFINITIONS,
  formatPreToolUseOutput,
  formatPostToolUseOutput,
  formatStopOutput,
  generateClaudeCodeHooksConfig,
} from './guard.js';
export type {
  HookInput,
  PreToolUseOutput,
  PostToolUseOutput,
  StopOutput,
  GuardResult,
  GuardName,
  GuardDefinition,
  GuidanceConfig,
} from './guard.js';

// Report
export {
  buildReportData,
  generateHtmlReport,
} from './report.js';
export type {
  ReportData,
  SprintTrendEntry,
  NutritionTrendEntry,
} from './report.js';

// Roles
export {
  registerRole,
  getRole,
  hasRole,
  listRoles,
  loadCustomRoles,
  generalist,
  backend,
  frontend,
  architect,
  devops,
} from './roles.js';
export type { RoleDefinition } from './roles.js';

// Standup (Communication Protocol)
export {
  generateStandup,
  formatStandup,
  parseStandup,
  extractRelevantHandoffs,
} from './standup.js';
export type {
  StandupReport,
  HandoffEntry,
} from './standup.js';

// Built-in metaphors (auto-registers on import)
export { golf, tennis, baseball, gaming, dnd, matrix } from './metaphors/index.js';
