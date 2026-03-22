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
  ReviewType,
  ReviewFinding,
  ReviewRecommendation,
  CompletedStep,
  WorkflowExecution,
  WorkflowStepResult,
} from './types.js';

// Constants
export {
  PAR_THRESHOLDS,
  SLOPE_FACTORS,
  SCORE_LABELS,
  TRAINING_TYPE_MAP,
  NUTRITION_CHECKLIST,
  HAZARD_SEVERITY_PENALTIES,
  REVIEW_TYPE_HAZARD_MAP,
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
export type { SlopeStore, SlopeSession, StoreErrorCode, StoreStats } from './store.js';

// Store Health
export { checkStoreHealth } from './store-health.js';
export type { StoreHealthResult } from './store-health.js';

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
export { loadConfig, createConfig, saveConfig, resolveConfigPath } from './config.js';

// Test Plan
export { parseTestPlan, getTestPlanSummary, getAreasNeedingTest } from './test-plan.js';
export type { TestPlanArea, TestPlanSection, TestPlanSummary, ParsedTestPlan } from './test-plan.js';

// Loader
export { loadScorecards, detectLatestSprint, resolveCurrentSprint, normalizeScorecard } from './loader.js';

// Metaphor
export {
  registerMetaphor,
  getMetaphor,
  listMetaphors,
  hasMetaphor,
  validateMetaphor,
  METAPHOR_SCHEMA,
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
  Suggestion,
  SuggestionOption,
} from './guard.js';

// Harness Adapter Framework
export {
  TOOL_CATEGORIES,
  CLAUDE_CODE_TOOLS,
  ADAPTER_PRIORITY,
  registerAdapter,
  getAdapter,
  listAdapters,
  detectAdapter,
  clearAdapters,
  resolveToolMatcher,
  SLOPE_BIN_PREAMBLE,
  writeOrUpdateManagedScript,
} from './harness.js';
export type {
  HarnessId,
  ToolCategory,
  ToolNameMap,
  HarnessAdapter,
} from './harness.js';

// Adapters
export { ClaudeCodeAdapter, claudeCodeAdapter } from './adapters/claude-code.js';
export { CursorAdapter, cursorAdapter } from './adapters/cursor.js';
export { WindsurfAdapter, windsurfAdapter } from './adapters/windsurf.js';
export { ClineAdapter, clineAdapter } from './adapters/cline.js';
export { GenericAdapter, genericAdapter } from './adapters/generic.js';
export type { GuardManifestEntry } from './adapters/generic.js';

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
  renderTrendTimeSeriesChart,
  renderVelocityChart,
  renderGuardEffectivenessChart,
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
  ml_engineer,
  database,
  ux_designer,
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
  aggregateStandups,
  formatTeamStandup,
} from './standup.js';
export type {
  StandupReport,
  HandoffEntry,
  TeamStandup,
} from './standup.js';

// Plugin System
export {
  validatePluginManifest,
  discoverPlugins,
  loadPlugins,
  loadPluginMetaphors,
  loadPluginGuards,
  isPluginEnabled,
  saveCustomMetaphor,
} from './plugins.js';
export type {
  PluginType,
  PluginManifest,
  DiscoveredPlugin,
  PluginLoadResult,
  PluginsConfig,
  SaveMetaphorResult,
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

// Review (Implementation Review Integration)
export {
  recommendReviews,
  findingToHazard,
  amendScorecardWithFindings,
} from './review.js';
export type { RecommendReviewsInput, AmendResult } from './review.js';

// Flows
export {
  parseFlows,
  validateFlows,
  checkFlowStaleness,
  loadFlows,
} from './flows.js';
export type {
  FlowStep,
  FlowDefinition,
  FlowsFile,
  FlowValidationResult,
  FlowStalenessResult,
} from './flows.js';

// Inspirations
export {
  parseInspirations,
  validateInspirations,
  loadInspirations,
  linkInspirationToSprint,
  deriveId,
} from './inspirations.js';
export type {
  InspirationStatus,
  InspirationEntry,
  InspirationsFile,
  InspirationValidationResult,
} from './inspirations.js';

// Imports (blast radius)
export {
  parseImports,
  buildImportGraph,
  blastRadius,
} from './imports.js';

// Interview (Init)
export {
  validateInitInput,
  initFromInterview,
  initFromAnswers,
} from './interview.js';
export type {
  InitInput,
  InitResult,
  InitFromAnswersResult,
} from './interview.js';

// Metaphor Preview
export {
  buildMetaphorPreview,
  buildAllPreviews,
  formatPreviewText,
} from './metaphor-preview.js';
export type { MetaphorPreview } from './metaphor-preview.js';

// Interview Steps
export {
  generateInterviewSteps,
} from './interview-steps.js';
export type {
  StepType,
  StepOption,
  InterviewStep,
} from './interview-steps.js';

// Interview Engine
export {
  runLightweightDetection,
  buildInterviewContext,
  validateInterviewAnswers,
  answersToInitInput,
} from './interview-engine.js';
export type {
  DetectedInfo,
  InterviewContext,
} from './interview-engine.js';

// Project Registry (Multi-Project)
export { FileProjectRegistry } from './project-registry.js';
export type { ProjectRegistry } from './project-registry.js';

// GitHub (Remote Git Analysis)
export {
  createGitHubClient,
  parseRepoUrl,
  GitHubApiError,
} from './github.js';
export type {
  GitHubClient,
  GitHubCommit,
  GitHubTreeEntry,
  GitHubErrorCode,
  GitHubIssue,
  GitHubMilestone,
} from './github.js';

// Webhooks (CI Integration)
export {
  validateGitHubWebhookSignature,
  handleCheckRunWebhook,
  handleWorkflowRunWebhook,
} from './webhooks.js';
export type { WebhookResult } from './webhooks.js';

// Event Ingestion
export {
  validateEventPayload,
  ingestEvents,
  createEventHandler,
} from './event-ingestion.js';
export type { EventIngestionResult } from './event-ingestion.js';

// Analyzers
export { runAnalyzers, loadRepoProfile, saveRepoProfile } from './analyzers/index.js';
export { analyzeStack, detectPackageManager } from './analyzers/stack.js';
export type { RepoProfile, StackProfile, StructureProfile, GitProfile, TestProfile, CIProfile, DocsProfile, AnalyzerName } from './analyzers/types.js';

// Complexity
export { estimateComplexity } from './analyzers/complexity.js';
export type { ComplexityProfile } from './analyzers/complexity.js';

// Backlog
export { analyzeBacklog } from './analyzers/backlog.js';
export type { BacklogAnalysis, TodoEntry } from './analyzers/backlog.js';

// GitHub Backlog
export { analyzeGitHubBacklog } from './analyzers/github-backlog.js';
export type { GitHubBacklogAnalysis } from './analyzers/github-backlog.js';

// Merged Backlog
export { mergeBacklogs } from './analyzers/backlog-merged.js';
export type { MergedBacklog } from './analyzers/backlog-merged.js';

// Generators
export { generateConfig } from './generators/config.js';
export { generateFirstSprint } from './generators/first-sprint.js';
export { generateCommonIssues } from './generators/common-issues.js';
export { generateRoadmap, generateRoadmapFromVision } from './generators/roadmap.js';
export type { GeneratedConfig } from './generators/config.js';
export type { GeneratedSprint } from './generators/first-sprint.js';

// Vision
export { loadVision, saveVision, validateVision, createVision, updateVision } from './vision.js';
export type { VisionDocument } from './analyzers/types.js';

// Transcript
export {
  getTranscriptPath,
  appendTurn,
  readTranscript,
  listTranscripts,
} from './transcript.js';
export type {
  ToolCallSummary,
  TranscriptTurn,
  TranscriptLine,
} from './types.js';

// Initiative (Multi-Sprint Orchestration)
export {
  selectSpecialists,
  getReviewChecklist,
  getNextPhase,
  canAdvance,
  loadInitiative,
  saveInitiative,
  createInitiative,
  advanceSprint,
  recordReview,
  getNextSprint,
  formatInitiativeStatus,
} from './initiative.js';
export type {
  SpecialistType,
  InitiativeSprintPhase,
  ReviewGateConfig,
  ReviewRecord,
  InitiativeSprintStatus,
  InitiativeDefinition,
  ReviewChecklistItem,
  ReviewChecklistContext,
  ReviewChecklistType,
  ReviewGate,
} from './initiative.js';

// Embedding
export {
  chunkFile,
  shouldSkipFile,
  MAX_CHUNK_FILE_SIZE,
  SKIP_EXTENSIONS,
  SKIP_FILENAMES,
  SKIP_DIRS,
} from './embedding.js';
export type {
  EmbeddingConfig,
  CodeChunk,
  EmbeddingResult,
} from './embedding.js';

export { embed, embedBatch } from './embedding-client.js';

export { hasEmbeddingSupport } from './embedding-store.js';
export type {
  EmbeddingStore,
  EmbeddingEntry,
  EmbeddingSearchResult,
  EmbeddingStats,
  IndexMeta,
} from './embedding-store.js';

// Context
export { deduplicateByFile, formatContextForAgent } from './context.js';
export type { ContextQuery, ContextResult } from './context.js';

// Prep (Execution Plans)
export {
  generatePrepPlan,
  formatPrepPlan,
  resolveTicket,
  buildQueryText,
  collectTestFiles,
  findSimilarTickets,
  extractHazards,
} from './prep.js';
export type { PrepPlan, TicketData } from './prep.js';

// Enrich (Backlog Enrichment)
export {
  enrichTicket,
  enrichBacklog,
  estimateTokens,
} from './enrich.js';
export type { EnrichedTicket, EnrichedBacklog } from './enrich.js';

// Docs (Documentation Manifest)
export {
  buildDocsManifest,
  computeSectionChecksum,
} from './docs.js';
export type {
  DocsManifest,
  DocsManifestInput,
  ManifestSection,
  ChangelogSection,
  ChangelogEntry,
  ChangelogChange,
  McpToolParam,
  McpToolMeta,
} from './docs.js';

// Deferred Findings
export {
  loadDeferred,
  saveDeferred,
  createDeferred,
  resolveDeferred,
  listDeferred,
  formatDeferredForBriefing,
  deferredPath,
} from './deferred.js';
export type {
  DeferredFinding,
  DeferredFindingsFile,
  DeferredSeverity,
  DeferredStatus,
} from './deferred.js';

// Analytics
export {
  computeHandicapTrend,
  computeVelocity,
  computeGuardMetrics,
} from './analytics.js';
export type {
  TrendPoint,
  VelocityPoint,
  VelocityReport,
  GuardMetrics,
  GuardEffectivenessReport,
  GuardDecision,
} from './analytics.js';

// Workflow
export {
  parseWorkflow,
  resolveVariables,
} from './workflow.js';
export type {
  WorkflowDefinition,
  WorkflowPhase,
  WorkflowStep,
  WorkflowVariable,
} from './workflow.js';

// Workflow Loader
export { loadWorkflow, listWorkflows } from './workflow-loader.js';
export type { WorkflowSummary } from './workflow-loader.js';

// Workflow Validator
export { validateWorkflow } from './workflow-validator.js';
export type { ValidationIssue, WorkflowValidationResult } from './workflow-validator.js';

// Workflow Engine
export { WorkflowEngine } from './workflow-engine.js';
export type {
  StartOpts,
  NextStepInfo,
  AdvanceResult,
  StepResult,
} from './workflow-engine.js';

// Built-in metaphors (auto-registers on import)
export { golf, tennis, baseball, gaming, dnd, matrix, agile } from './metaphors/index.js';
