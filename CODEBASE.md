---
generated_at: "2026-03-03T23:07:58.595Z"
git_sha: "6be298da3710e2962acbbca6a9eb7f4bdf87a868"
sprint: 58
source_files: 173
test_files: 128
cli_commands: 38
guards: 17
flows: 0
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->

### `src/cli`
- Source files: 79 | Test files: 45
- Key modules:
  - `config`
  - `hooks-config`
  - `interactive-init` — SLOPE — Rich Interactive Init (powered by @clack/prompts)
  - `loader`
  - `metaphor` — CLI metaphor resolution
  - `registry` — CLI Command Registry — metadata for CLI commands (map generation, documentation, slope-web)
  - `store` — Store info from config — no store connection required
  - `template-generator` — SLOPE Template Generator

### `src/core`
- Source files: 82 | Test files: 73
- Key modules:
  - `advisor` — --- Module-private constants ---
  - `briefing` — --- Input types ---
  - `builder` — --- Helpers ---
  - `ci-signals` — SLOPE — CI/Test Signal Parser
  - `config` — Write a complete SlopeConfig to .slope/config.json. Expects a full config object (use loadConfig() to read-modify-write).
  - `constants` — Maps ticket count ranges to par values
  - `context` — SLOPE — Semantic Context Retrieval
  - `dashboard` — --- Dashboard Config ---
  - `dispersion` — --- Helpers ---
  - `docs` — SLOPE — Documentation Manifest Builder
  - `embedding-client` — SLOPE — HTTP Client for OpenAI-Compatible Embedding Endpoints
  - `embedding-store` — SLOPE — EmbeddingStore Interface
  - `embedding` — SLOPE — Embedding Types & Chunking Logic (pure — no HTTP calls)
  - `enrich` — SLOPE — Backlog Enrichment
  - `escalation` — SLOPE — Escalation Rules
  - ... and 36 more

### `src/mcp`
- Source files: 3 | Test files: 5
- Key modules:
  - `registry` — ─── Core Scoring Enums ───
  - `sandbox` — SLOPE sandbox — runs agent-written JS in a node:vm context

### `src/store`
- Source files: 1 | Test files: 1

### `src/store-pg`
- Source files: 1 | Test files: 2

### `src/tokens`
- Source files: 5 | Test files: 1
- Key modules:
  - `colors` — SLOPE Design Tokens — Colors
  - `css` — SLOPE Design Tokens — CSS Variable Generator
  - `spacing` — SLOPE Design Tokens — Spacing & Radii
  - `typography` — SLOPE Design Tokens — Typography

<!-- AUTO-GENERATED: END packages -->

## API Surface (core)

Re-exports from `src/core/index.ts`:

<!-- AUTO-GENERATED: START api -->

**SLOPE — Sprint Lifecycle & Operational Performance Engine:**
**Types:**
- `ClubSelection`, `ShotResult`, `HazardType`, `ConditionType`, `SpecialPlay`, `MissDirection`, `ScoreLabel`, `SprintType`, `HazardHit`, `ShotRecord`, `ConditionRecord`, `HoleStats`, `HoleScore`, `TrainingType`, `TrainingSession`, `NutritionCategory`, `NutritionEntry`, `NineteenthHole`, `GolfScorecard`, `AgentBreakdown`, `RollingStats`, `HandicapCard`, `DispersionReport`, `AreaReport`, `ExecutionTrace`, `ShotClassification`, `ClubRecommendation`, `TrainingRecommendation`, `ClaimScope`, `SprintClaim`, `SprintConflict`, `EventType`, `SlopeEvent`, `CIRunner`, `CISignal`, `PRPlatform`, `PRReviewDecision`, `PRSignal`, `HazardSeverity`, `ReviewType`, `ReviewFinding`, `ReviewRecommendation` (types)
**Constants:**
- `PAR_THRESHOLDS`, `SLOPE_FACTORS`, `SCORE_LABELS`, `TRAINING_TYPE_MAP`, `NUTRITION_CHECKLIST`, `HAZARD_SEVERITY_PENALTIES`, `REVIEW_TYPE_HAZARD_MAP`
**Handicap:**
- `computePar`, `computeSlope`, `computeScoreLabel`, `computeHandicapCard`
**Builder:**
- `computeStatsFromShots`, `buildScorecard`, `buildAgentBreakdowns`
- `ScorecardInput`, `AgentShotInput` (types)
**Validation:**
- `validateScorecard`
- `ScorecardValidationError`, `ScorecardValidationWarning`, `ScorecardValidationResult` (types)
**Dispersion:**
- `computeDispersion`, `computeAreaPerformance`
**Advisor:**
- `recommendClub`, `classifyShot`, `classifyShotFromSignals`, `generateTrainingPlan`
- `RecommendClubInput`, `TrainingPlanInput`, `CombinedSignals` (types)
**Formatter:**
- `formatSprintReview`, `formatAdvisorReport`
- `ProjectStats`, `ProjectStatsDelta`, `ReviewMode`, `AdvisorReportInput` (types)
**Briefing:**
- `filterCommonIssues`, `extractHazardIndex`, `computeNutritionTrend`, `hazardBriefing`, `formatBriefing`
- `RecurringPattern`, `CommonIssuesFile`, `SessionEntry`, `BriefingFilter`, `HazardEntry`, `NutritionTrend` (types)
**Registry:**
- `checkConflicts`
- `SprintRegistry` (types)
**Store:**
- `SlopeStoreError`
- `SlopeStore`, `SlopeSession`, `StoreErrorCode`, `StoreStats` (types)
**Store Health:**
- `checkStoreHealth`
- `StoreHealthResult` (types)
**Tournament Review:**
- `buildTournamentReview`, `formatTournamentReview`
- `TournamentReview`, `TournamentSprintEntry`, `TournamentScoring`, `TournamentStats`, `TournamentHazard` (types)
**Roadmap:**
- `validateRoadmap`, `computeCriticalPath`, `findParallelOpportunities`, `parseRoadmap`, `formatRoadmapSummary`, `formatStrategicContext`
- `RoadmapDefinition`, `RoadmapSprint`, `RoadmapTicket`, `RoadmapPhase`, `RoadmapClub`, `RoadmapValidationResult`, `RoadmapValidationError`, `RoadmapValidationWarning`, `CriticalPathResult`, `ParallelGroup` (types)
**Config:**
- `SlopeConfig` (types)
- `loadConfig`, `createConfig`, `saveConfig`, `resolveConfigPath`
**Loader:**
- `loadScorecards`, `detectLatestSprint`, `resolveCurrentSprint`
**Metaphor:**
- `registerMetaphor`, `getMetaphor`, `listMetaphors`, `hasMetaphor`, `validateMetaphor`, `METAPHOR_SCHEMA`
- `MetaphorDefinition`, `MetaphorVocabulary`, `ClubTerms`, `ShotResultTerms`, `HazardTerms`, `ConditionTerms`, `SpecialPlayTerms`, `MissDirectionTerms`, `ScoreLabelTerms`, `SprintTypeTerms`, `TrainingTypeTerms`, `NutritionTerms` (types)
**Event Pipeline:**
- `clusterEvents`, `findPromotionCandidates`, `runPipeline`
- `EventCluster`, `PromotionCandidate`, `PipelineResult` (types)
**CI Signal Parser:**
- `detectRunner`, `parseTestOutput`, `parseVitestOutput`, `parseJestOutput`
**PR Signal Parser:**
- `GH_PR_JSON_FIELDS`, `buildGhCommand`, `parsePRJson`, `emptyPRSignal`, `mergePRChecksWithCI`, `detectCheckRetries`
**Guard Framework:**
- `GUARD_DEFINITIONS`, `formatPreToolUseOutput`, `formatPostToolUseOutput`, `formatStopOutput`, `generateClaudeCodeHooksConfig`, `registerCustomGuard`, `getAllGuardDefinitions`, `getCustomGuard`, `clearCustomGuards`
- `HookInput`, `PreToolUseOutput`, `PostToolUseOutput`, `StopOutput`, `GuardResult`, `GuardName`, `GuardDefinition`, `GuidanceConfig`, `CustomGuardDefinition`, `AnyGuardDefinition` (types)
**Harness Adapter Framework:**
- `TOOL_CATEGORIES`, `CLAUDE_CODE_TOOLS`, `ADAPTER_PRIORITY`, `registerAdapter`, `getAdapter`, `listAdapters`, `detectAdapter`, `clearAdapters`, `resolveToolMatcher`
- `HarnessId`, `ToolCategory`, `ToolNameMap`, `HarnessAdapter` (types)
**Adapters:**
- `ClaudeCodeAdapter`, `claudeCodeAdapter`
- `CursorAdapter`, `cursorAdapter`
- `WindsurfAdapter`, `windsurfAdapter`
- `ClineAdapter`, `clineAdapter`
- `GenericAdapter`, `genericAdapter`
- `GuardManifestEntry` (types)
**Report:**
- `buildReportData`, `generateHtmlReport`, `REPORT_CSS`, `escapeHtml`, `svgLine`, `svgRect`, `svgText`, `renderSummaryCards`, `renderHandicapTrendChart`, `renderDispersionChart`, `renderAreaPerformanceChart`, `renderNutritionChart`, `renderSprintTable`
- `ReportData`, `SprintTrendEntry`, `NutritionTrendEntry` (types)
**Dashboard:**
- `DEFAULT_DASHBOARD_CONFIG`, `generateDashboardHtml`, `renderSprintDetail`, `renderSprintTimeline`, `generateDashboardScript`, `computeMissHeatmap`, `renderMissHeatmap`, `computeAreaHazards`, `renderAreaHazardOverlay`
- `DashboardConfig`, `HeatmapCell`, `MissHeatmapData`, `AreaHazardEntry` (types)
**Team Handicap:**
- `extractRoleData`, `computeRoleHandicap`, `computeSwarmEfficiency`, `analyzeRoleCombinations`, `computeTeamHandicap`
- `RoleHandicap`, `SwarmEfficiency`, `RoleCombinationStats`, `TeamHandicapCard` (types)
**Roles:**
- `registerRole`, `getRole`, `hasRole`, `listRoles`, `loadCustomRoles`, `generalist`, `backend`, `frontend`, `architect`, `devops`, `ml_engineer`, `database`, `ux_designer`
- `RoleDefinition` (types)
**Escalation:**
- `resolveEscalationConfig`, `detectEscalation`, `buildEscalationEvent`
- `EscalationTrigger`, `EscalationSeverity`, `EscalationAction`, `EscalationConfig`, `EscalationResult` (types)
**Standup (Communication Protocol):**
- `generateStandup`, `formatStandup`, `parseStandup`, `extractRelevantHandoffs`, `aggregateStandups`, `formatTeamStandup`
- `StandupReport`, `HandoffEntry`, `TeamStandup` (types)
**Plugin System:**
- `validatePluginManifest`, `discoverPlugins`, `loadPlugins`, `loadPluginMetaphors`, `loadPluginGuards`, `isPluginEnabled`, `saveCustomMetaphor`
- `PluginType`, `PluginManifest`, `DiscoveredPlugin`, `PluginLoadResult`, `PluginsConfig`, `SaveMetaphorResult` (types)
**Leaderboard (Multi-Developer):**
- `buildLeaderboard`, `formatLeaderboard`, `renderLeaderboardHtml`
- `LeaderboardEntry`, `Leaderboard` (types)
**Player (Multi-Developer):**
- `DEFAULT_PLAYER`, `extractPlayers`, `filterScorecardsByPlayer`, `computePlayerHandicaps`, `computePlayerHandicap`, `computeReporterSeverity`, `mergeHazardIndices`, `filterHazardsByVisibility`
- `PlayerHandicap`, `ReporterSeverity` (types)
**Review (Implementation Review Integration):**
- `recommendReviews`, `findingToHazard`, `amendScorecardWithFindings`
- `RecommendReviewsInput`, `AmendResult` (types)
**Flows:**
- `parseFlows`, `validateFlows`, `checkFlowStaleness`, `loadFlows`
- `FlowStep`, `FlowDefinition`, `FlowsFile`, `FlowValidationResult`, `FlowStalenessResult` (types)
**Interview (Init):**
- `validateInitInput`, `initFromInterview`, `initFromAnswers`
- `InitInput`, `InitResult`, `InitFromAnswersResult` (types)
**Metaphor Preview:**
- `buildMetaphorPreview`, `buildAllPreviews`, `formatPreviewText`
- `MetaphorPreview` (types)
**Interview Steps:**
- `generateInterviewSteps`
- `StepType`, `StepOption`, `InterviewStep` (types)
**Interview Engine:**
- `runLightweightDetection`, `buildInterviewContext`, `validateInterviewAnswers`, `answersToInitInput`
- `DetectedInfo`, `InterviewContext` (types)
**Project Registry (Multi-Project):**
- `FileProjectRegistry`
- `ProjectRegistry` (types)
**GitHub (Remote Git Analysis):**
- `createGitHubClient`, `parseRepoUrl`, `GitHubApiError`
- `GitHubClient`, `GitHubCommit`, `GitHubTreeEntry`, `GitHubErrorCode`, `GitHubIssue`, `GitHubMilestone` (types)
**Webhooks (CI Integration):**
- `validateGitHubWebhookSignature`, `handleCheckRunWebhook`, `handleWorkflowRunWebhook`
- `WebhookResult` (types)
**Event Ingestion:**
- `validateEventPayload`, `ingestEvents`, `createEventHandler`
- `EventIngestionResult` (types)
**Analyzers:**
- `runAnalyzers`, `loadRepoProfile`, `saveRepoProfile`
- `analyzeStack`, `detectPackageManager`
- `RepoProfile`, `StackProfile`, `StructureProfile`, `GitProfile`, `TestProfile`, `CIProfile`, `DocsProfile`, `AnalyzerName` (types)
**Complexity:**
- `estimateComplexity`
- `ComplexityProfile` (types)
**Backlog:**
- `analyzeBacklog`
- `BacklogAnalysis`, `TodoEntry` (types)
**GitHub Backlog:**
- `analyzeGitHubBacklog`
- `GitHubBacklogAnalysis` (types)
**Merged Backlog:**
- `mergeBacklogs`
- `MergedBacklog` (types)
**Generators:**
- `generateConfig`
- `generateFirstSprint`
- `generateCommonIssues`
- `generateRoadmap`, `generateRoadmapFromVision`
- `GeneratedConfig` (types)
- `GeneratedSprint` (types)
**Vision:**
- `loadVision`, `saveVision`, `validateVision`, `createVision`, `updateVision`
- `VisionDocument` (types)
**Transcript:**
- `getTranscriptPath`, `appendTurn`, `readTranscript`, `listTranscripts`
- `ToolCallSummary`, `TranscriptTurn`, `TranscriptLine` (types)
**Initiative (Multi-Sprint Orchestration):**
- `selectSpecialists`, `getReviewChecklist`, `getNextPhase`, `canAdvance`, `loadInitiative`, `saveInitiative`, `createInitiative`, `advanceSprint`, `recordReview`, `getNextSprint`, `formatInitiativeStatus`
- `SpecialistType`, `InitiativeSprintPhase`, `ReviewGateConfig`, `ReviewRecord`, `InitiativeSprintStatus`, `InitiativeDefinition`, `ReviewChecklistItem`, `ReviewChecklistContext`, `ReviewChecklistType`, `ReviewGate` (types)
**Embedding:**
- `chunkFile`, `shouldSkipFile`, `MAX_CHUNK_FILE_SIZE`, `SKIP_EXTENSIONS`, `SKIP_FILENAMES`, `SKIP_DIRS`
- `EmbeddingConfig`, `CodeChunk`, `EmbeddingResult` (types)
- `embed`, `embedBatch`
- `hasEmbeddingSupport`
- `EmbeddingStore`, `EmbeddingEntry`, `EmbeddingSearchResult`, `EmbeddingStats`, `IndexMeta` (types)
**Context:**
- `deduplicateByFile`, `formatContextForAgent`
- `ContextQuery`, `ContextResult` (types)
**Prep (Execution Plans):**
- `generatePrepPlan`, `formatPrepPlan`, `resolveTicket`, `buildQueryText`, `collectTestFiles`, `findSimilarTickets`, `extractHazards`
- `PrepPlan`, `TicketData` (types)
**Enrich (Backlog Enrichment):**
- `enrichTicket`, `enrichBacklog`, `estimateTokens`
- `EnrichedTicket`, `EnrichedBacklog` (types)
**Docs (Documentation Manifest):**
- `buildDocsManifest`, `computeSectionChecksum`
- `DocsManifest`, `DocsManifestInput`, `ChangelogSection`, `ChangelogEntry`, `ChangelogChange` (types)
**Built-in metaphors (auto-registers on import):**
- `golf`, `tennis`, `baseball`, `gaming`, `dnd`, `matrix`, `agile`
<!-- AUTO-GENERATED: END api -->

## CLI Commands

<!-- AUTO-GENERATED: START cli -->

- `slope init` — Initialize .slope/ directory
- `slope session` — Manage live sessions
- `slope claim` — Claim a ticket or area for the sprint
- `slope release` — Release a claim by ID or target
- `slope status` — Show sprint course status and conflicts
- `slope next` — Show next sprint number (auto-detect)
- `slope card` — Display handicap card
- `slope validate` — Validate scorecard(s)
- `slope review` — Format sprint review or manage review state
- `slope auto-card` — Generate scorecard from git + CI signals
- `slope classify` — Classify a shot from execution trace
- `slope tournament` — Build tournament review from sprints
- `slope briefing` — Pre-round briefing with hazards and nutrition
- `slope plan` — Pre-shot advisor (club + training + hazards)
- `slope report` — Generate HTML performance report
- `slope dashboard` — Live local performance dashboard
- `slope standup` — Generate or ingest standup report
- `slope analyze` — Scan repo and generate profile
- `slope hook` — Manage lifecycle hooks
- `slope guard` — Run guard handler or manage guard activation
- `slope extract` — Extract events into SLOPE store
- `slope distill` — Promote event patterns to common issues
- `slope map` — Generate/update codebase map
- `slope flows` — Manage user flow definitions
- `slope metaphor` — Manage metaphor display themes
- `slope plugin` — Manage custom plugins
- `slope store` — Store diagnostics and management
- `slope escalate` — Escalate issues based on severity triggers
- `slope transcript` — View session transcript data
- `slope roadmap` — Strategic planning and roadmap tools
- `slope vision` — Display project vision document
- `slope initiative` — Multi-sprint initiative orchestration
- `slope loop` — Autonomous sprint execution loop
- `slope index-cmd` — Semantic embedding index management
- `slope context` — Semantic context search for agents
- `slope prep` — Generate execution plan for a ticket
- `slope enrich` — Batch-enrich backlog with file context
- `slope docs` — Generate documentation manifest and changelog
<!-- AUTO-GENERATED: END cli -->

## Guard Definitions

<!-- AUTO-GENERATED: START guards -->

| Guard | Hook Event | Matcher | Description |
|-------|-----------|---------|-------------|
| `explore` | PreToolUse | Read|Glob|Grep | Suggest checking codebase index before deep exploration |
| `hazard` | PreToolUse | Edit|Write | Warn about known issues in file areas being edited |
| `commit-nudge` | PostToolUse | Edit|Write | Nudge to commit/push after prolonged editing |
| `scope-drift` | PreToolUse | Edit|Write | Warn when editing files outside claimed ticket scope |
| `compaction` | PreCompact | — | Extract events before context compaction |
| `stop-check` | Stop | — | Check for uncommitted/unpushed work before session end |
| `subagent-gate` | PreToolUse | Task | Force haiku model and cap max_turns on Explore/Plan subagents |
| `push-nudge` | PostToolUse | Bash | Nudge to push after git commits when unpushed count or time is high |
| `workflow-gate` | PreToolUse | ExitPlanMode | Block ExitPlanMode until review rounds are complete |
| `review-tier` | PreToolUse | ExitPlanMode | Recommend review tier based on plan scope |
| `version-check` | PreToolUse | Bash | Block push to main when package versions have not been bumped |
| `stale-flows` | PreToolUse | Edit|Write | Warn when editing files belonging to a stale flow definition |
| `next-action` | Stop | — | Suggest next actions before session end |
| `pr-review` | PostToolUse | Bash | Prompt for review workflow after PR creation |
| `transcript` | PostToolUse | — | Append tool call metadata to session transcript |
| `branch-before-commit` | PreToolUse | Bash | Block git commit on main/master — create a feature branch first |
| `worktree-check` | PreToolUse | Edit|Write | Warn when editing in main repo instead of a worktree |
<!-- AUTO-GENERATED: END guards -->

## MCP Tools

<!-- AUTO-GENERATED: START mcp -->

- `search`
- `execute`
- `session_status`
- `acquire_claim`
- `check_conflicts`
- `store_status`
<!-- AUTO-GENERATED: END mcp -->

## Test Inventory

<!-- AUTO-GENERATED: START tests -->

| Directory | Test Files | Command |
|-----------|-----------|---------|
| tests/cli | 45 | `pnpm test` |
| tests/core | 73 | `pnpm test` |
| tests/mcp | 5 | `pnpm test` |
| tests/store | 1 | `pnpm test` |
| tests/store-pg | 2 | `pnpm test` |
| tests/tokens | 1 | `pnpm test` |

**Total test files:** 127
**Run all:** `pnpm -r test`
**Typecheck:** `pnpm -r typecheck`
<!-- AUTO-GENERATED: END tests -->

## Recent Sprint History

<!-- AUTO-GENERATED: START history -->

| Sprint | Theme | Tickets | Score |
|--------|-------|---------|-------|
| **54** | Harden top hotspot modules | 1 | eagle |
| **55** | Harden top hotspot modules | 3 | birdie |
| **56** | Harden top hotspot modules | 8 | triple_plus |
| **57** | Harden top hotspot modules | 2 | birdie |
| **58** | Harden top hotspot modules | 8 | triple_plus |
<!-- AUTO-GENERATED: END history -->

## Known Gotchas

Top recurring patterns from common-issues:

<!-- AUTO-GENERATED: START gotchas -->

- **Review-discovered hazards inflate scores** (process, 5 sprints): Every hazard since S43 was found by post-hole review, never during coding. S49: all 3 hazards in autonomous sprint caught by manual code review. The review gate works but is a trailing indicator.
- **API shape assumptions** (types, 3 sprints): Assuming property names or structure of internal APIs without reading the definition. #1 hazard source across S39-S44.
- **Shell script boundary values** (shell, 2 sprints): Shell arithmetic comparisons (-lt vs -le, -gt vs -ge) are error-prone. S48: -lt 500 excluded exactly 500 lines. S45: multiple shell hazards.
- **process.exit() inside try/finally skips cleanup** (control-flow, 2 sprints): process.exit(1) inside a try block with finally { db.close() } — exit runs before finally in Node.js. S46: original store.ts hazard. S49: autonomous agent repeated the same pattern in restore validation.
- **Threshold/constant consistency across consumers** (calibration, 1 sprint): Changing a default value (e.g. minScore) in one consumer but not all consumers of the same pipeline. S48: context.ts threshold updated to 0.4 but enrich.ts still used 0.55.
- **AI-generated code duplicates existing abstractions** (autonomous, 1 sprint): Autonomous agents (Aider/Sonnet) may reimplement logic that already exists elsewhere in the file. S49: validateSubcommand duplicated loadRoadmapFile's file-loading and error handling instead of extracting a shared helper.
<!-- AUTO-GENERATED: END gotchas -->