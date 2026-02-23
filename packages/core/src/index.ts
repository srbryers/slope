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
  PRPlatform,
  PRReviewDecision,
  PRSignal,
  HazardSeverity,
} from './types.js';

// Constants
export {
  PAR_THRESHOLDS,
  SLOPE_FACTORS,
  SCORE_LABELS,
  TRAINING_TYPE_MAP,
  NUTRITION_CHECKLIST,
  HAZARD_SEVERITY_PENALTIES,
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

// PR Signal Parser
export {
  GH_PR_JSON_FIELDS,
  buildGhCommand,
  parsePRJson,
  emptyPRSignal,
  mergePRChecksWithCI,
  detectCheckRetries,
} from './pr-signals.js';

// Guard Framework
export {
  GUARD_DEFINITIONS,
  formatPreToolUseOutput,
  formatPostToolUseOutput,
  formatStopOutput,
  generateClaudeCodeHooksConfig,
  registerCustomGuard,
  getAllGuardDefinitions,
  getCustomGuard,
  clearCustomGuards,
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
  CustomGuardDefinition,
  AnyGuardDefinition,
} from './guard.js';

// Report
export {
  buildReportData,
  generateHtmlReport,
  REPORT_CSS,
  escapeHtml,
  svgLine,
  svgRect,
  svgText,
  renderSummaryCards,
  renderHandicapTrendChart,
  renderDispersionChart,
  renderAreaPerformanceChart,
  renderNutritionChart,
  renderSprintTable,
} from './report.js';
export type {
  ReportData,
  SprintTrendEntry,
  NutritionTrendEntry,
} from './report.js';

// Dashboard
export {
  DEFAULT_DASHBOARD_CONFIG,
  generateDashboardHtml,
  renderSprintDetail,
  renderSprintTimeline,
  generateDashboardScript,
  computeMissHeatmap,
  renderMissHeatmap,
  computeAreaHazards,
  renderAreaHazardOverlay,
} from './dashboard.js';
export type {
  DashboardConfig,
  HeatmapCell,
  MissHeatmapData,
  AreaHazardEntry,
} from './dashboard.js';

// Team Handicap
export {
  extractRoleData,
  computeRoleHandicap,
  computeSwarmEfficiency,
  analyzeRoleCombinations,
  computeTeamHandicap,
} from './team-handicap.js';
export type {
  RoleHandicap,
  SwarmEfficiency,
  RoleCombinationStats,
  TeamHandicapCard,
} from './team-handicap.js';

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

// Escalation
export {
  resolveEscalationConfig,
  detectEscalation,
  buildEscalationEvent,
} from './escalation.js';
export type {
  EscalationTrigger,
  EscalationSeverity,
  EscalationAction,
  EscalationConfig,
  EscalationResult,
} from './escalation.js';

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

// Plugin System
export {
  validatePluginManifest,
  discoverPlugins,
  loadPlugins,
  loadPluginMetaphors,
  loadPluginGuards,
  isPluginEnabled,
} from './plugins.js';
export type {
  PluginType,
  PluginManifest,
  DiscoveredPlugin,
  PluginLoadResult,
  PluginsConfig,
} from './plugins.js';

// Leaderboard (Multi-Developer)
export {
  buildLeaderboard,
  formatLeaderboard,
  renderLeaderboardHtml,
} from './leaderboard.js';
export type { LeaderboardEntry, Leaderboard } from './leaderboard.js';

// Player (Multi-Developer)
export {
  DEFAULT_PLAYER,
  extractPlayers,
  filterScorecardsByPlayer,
  computePlayerHandicaps,
  computePlayerHandicap,
  computeReporterSeverity,
  mergeHazardIndices,
  filterHazardsByVisibility,
} from './player.js';
export type { PlayerHandicap, ReporterSeverity } from './player.js';

// Built-in metaphors (auto-registers on import)
export { golf, tennis, baseball, gaming, dnd, matrix } from './metaphors/index.js';
