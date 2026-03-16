---
generated_at: "2026-03-16T20:08:02.303Z"
git_sha: "1a890174948daf614dd171630d157b5c78498add"
sprint: 66
source_files: 208
test_files: 155
cli_commands: 46
guards: 28
flows: 0
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->

### `src/cli`
- Source files: 108 | Test files: 65
- Key modules:
  - `config`
  - `hooks-config`
  - `interactive-init` — SLOPE — Rich Interactive Init (powered by @clack/prompts)
  - `loader`
  - `metaphor` — CLI metaphor resolution
  - `phase-cleanup` — Load phase cleanup state. Returns empty state if missing/corrupt.
  - `registry` — CLI Command Registry — metadata for CLI commands (map generation, documentation, slope-web)
  - `session-state` — Session ID for the briefing guard
  - `sprint-state` — Sprint lifecycle phases
  - `store` — Store info from config — no store connection required
  - `template-generator` — SLOPE Template Generator

### `src/core`
- Source files: 88 | Test files: 79
- Key modules:
  - `advisor` — --- Module-private constants ---
  - `analytics` — SLOPE — Sprint Analytics
  - `briefing` — --- Input types ---
  - `builder` — --- Helpers ---
  - `ci-signals` — SLOPE — CI/Test Signal Parser
  - `config` — Write a complete SlopeConfig to .slope/config.json. Expects a full config object (use loadConfig() to read-modify-write).
  - `constants` — Maps ticket count ranges to par values
  - `context` — SLOPE — Semantic Context Retrieval
  - `dashboard` — --- Dashboard Config ---
  - `deferred` — SLOPE — Deferred Findings Registry
  - `dispersion` — --- Helpers ---
  - `docs` — SLOPE — Documentation Manifest Builder
  - `embedding-client` — SLOPE — HTTP Client for OpenAI-Compatible Embedding Endpoints
  - `embedding-store` — SLOPE — EmbeddingStore Interface
  - `embedding` — SLOPE — Embedding Types & Chunking Logic (pure — no HTTP calls)
  - ... and 41 more

### `src/mcp`
- Source files: 3 | Test files: 6
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

**Constants:**
- `const PAR_THRESHOLDS: Record<number, [number, number]>`
- `const SLOPE_FACTORS: readonly ['cross_package', 'schema_migration', 'new_area', 'external_dep', 'concurrent_agents']`
- `const SCORE_LABELS: Record<number, ScoreLabel>`
- `const TRAINING_TYPE_MAP: Partial<Record<SprintType, TrainingType>>`
- `const NUTRITION_CHECKLIST: NutritionCategory[]`
- `HAZARD_SEVERITY_PENALTIES`
- `REVIEW_TYPE_HAZARD_MAP`
**Handicap:**
- `computePar(ticketCount: number): 3 | 4 | 5`
- `computeSlope(factors: string[]): number`
- `computeScoreLabel(score: number, par: number): ScoreLabel`
- `computeHandicapCard(scorecards: GolfScorecard[]): HandicapCard`
**Builder:**
- `computeStatsFromShots(shots: ShotRecord[], overrides?: { putts?: number; penalties?: number }): HoleStats`
- `buildScorecard(input: ScorecardInput): GolfScorecard`
- `buildAgentBreakdowns(agents: AgentShotInput[]): AgentBreakdown[]`
**Validation:**
- `validateScorecard(card: GolfScorecard): ScorecardValidationResult`
**Dispersion:**
- `computeDispersion(scorecards: GolfScorecard[]): DispersionReport`
- `computeAreaPerformance(scorecards: GolfScorecard[]): AreaReport`
**Advisor:**
- `recommendClub(input: RecommendClubInput): ClubRecommendation`
- `classifyShot(trace: ExecutionTrace): ShotClassification`
- `classifyShotFromSignals`
- `generateTrainingPlan(input: TrainingPlanInput): TrainingRecommendation[]`
**Formatter:**
- `formatSprintReview(card: GolfScorecard, projectStats?: ProjectStats, deltas?: ProjectStatsDelta, mode?: 'technical' | 'plain'): string`
- `formatAdvisorReport(input: AdvisorReportInput): string`
**Briefing:**
- `filterCommonIssues(issues: CommonIssuesFile, filter: BriefingFilter): RecurringPattern[]`
- `extractHazardIndex(scorecards: GolfScorecard[], keyword?: string): { shot_hazards: HazardEntry[]; bunker_locations: { sprint: number; location: string }[] }`
- `computeNutritionTrend(scorecards: GolfScorecard[]): NutritionTrend[]`
- `hazardBriefing(opts: { areas: string[]; scorecards: GolfScorecard[] }): string[]`
- `formatBriefing(opts: { scorecards: GolfScorecard[]; commonIssues: CommonIssuesFile; lastSession?: SessionEntry; filter?: BriefingFilter }): string`
**Registry:**
- `checkConflicts(claims: SprintClaim[]): SprintConflict[]`
**Store:**
- `SlopeStoreError`
**Store Health:**
- `checkStoreHealth`
**Tournament Review:**
- `buildTournamentReview(id: string, name: string, scorecards: GolfScorecard[], options?: { takeaways?: string[]; improvements?: string[]; reflection?: string }): TournamentReview`
- `formatTournamentReview(review: TournamentReview): string`
**Roadmap:**
- `validateRoadmap(roadmap: RoadmapDefinition): RoadmapValidationResult`
- `computeCriticalPath(roadmap: RoadmapDefinition): CriticalPathResult`
- `findParallelOpportunities(roadmap: RoadmapDefinition): ParallelGroup[]`
- `parseRoadmap(json: unknown): { roadmap: RoadmapDefinition | null; validation: RoadmapValidationResult }`
- `formatRoadmapSummary(roadmap: RoadmapDefinition): string`
- `formatStrategicContext(roadmap: RoadmapDefinition, currentSprint: number): string | null`
**Config:**
- `loadConfig(): SlopeConfig`
- `createConfig`
- `saveConfig(config: SlopeConfig): string`
- `resolveConfigPath`
**Test Plan:**
- `parseTestPlan`
- `getTestPlanSummary`
- `getAreasNeedingTest`
**Loader:**
- `loadScorecards(): GolfScorecard[]`
- `detectLatestSprint`
- `resolveCurrentSprint`
**Metaphor:**
- `registerMetaphor`
- `getMetaphor`
- `listMetaphors`
- `hasMetaphor`
- `validateMetaphor`
- `METAPHOR_SCHEMA: { vocabulary: string[], clubs: string[], shotResults: string[], hazards: string[], conditions: string[], specialPlays: string[], missDirections: string[], scoreLabels: string[], sprintTypes: string[], trainingTypes: string[], nutrition: string[] }`
**Event Pipeline:**
- `clusterEvents`
- `findPromotionCandidates`
- `runPipeline`
**CI Signal Parser:**
- `detectRunner`
- `parseTestOutput`
- `parseVitestOutput`
- `parseJestOutput`
**PR Signal Parser:**
- `GH_PR_JSON_FIELDS`
- `buildGhCommand(prNumber: number): string`
- `parsePRJson(json: Record<string, unknown>): PRSignal`
- `emptyPRSignal(prNumber?: number): PRSignal`
- `mergePRChecksWithCI(prSignal: PRSignal, existingCI?: CISignal): CISignal`
- `detectCheckRetries`
**Guard Framework:**
- `GUARD_DEFINITIONS`
- `formatPreToolUseOutput`
- `formatPostToolUseOutput`
- `formatStopOutput`
- `generateClaudeCodeHooksConfig`
- `registerCustomGuard`
- `getAllGuardDefinitions`
- `getCustomGuard`
- `clearCustomGuards`
**Harness Adapter Framework:**
- `TOOL_CATEGORIES`
- `CLAUDE_CODE_TOOLS`
- `ADAPTER_PRIORITY`
- `registerAdapter`
- `getAdapter`
- `listAdapters`
- `detectAdapter`
- `clearAdapters`
- `resolveToolMatcher`
- `SLOPE_BIN_PREAMBLE`
- `writeOrUpdateManagedScript`
**Adapters:**
- `ClaudeCodeAdapter`
- `claudeCodeAdapter`
- `CursorAdapter`
- `cursorAdapter`
- `WindsurfAdapter`
- `windsurfAdapter`
- `ClineAdapter`
- `clineAdapter`
- `GenericAdapter`
- `genericAdapter`
**Report:**
- `buildReportData`
- `generateHtmlReport`
- `REPORT_CSS`
- `escapeHtml`
- `svgLine`
- `svgRect`
- `svgText`
- `renderSummaryCards`
- `renderHandicapTrendChart`
- `renderDispersionChart`
- `renderAreaPerformanceChart`
- `renderNutritionChart`
- `renderSprintTable`
- `renderTrendTimeSeriesChart`
- `renderVelocityChart`
- `renderGuardEffectivenessChart`
**Dashboard:**
- `DEFAULT_DASHBOARD_CONFIG`
- `generateDashboardHtml`
- `renderSprintDetail`
- `renderSprintTimeline`
- `generateDashboardScript`
- `computeMissHeatmap`
- `renderMissHeatmap`
- `computeAreaHazards`
- `renderAreaHazardOverlay`
**Team Handicap:**
- `extractRoleData`
- `computeRoleHandicap(role: string, breakdowns: AgentBreakdown[]): RoleHandicap`
- `computeSwarmEfficiency(scorecards: GolfScorecard[], coordinationEvents?: number): SwarmEfficiency`
- `analyzeRoleCombinations(scorecards: GolfScorecard[]): RoleCombinationStats[]`
- `computeTeamHandicap(scorecards: GolfScorecard[], coordinationEvents?: number): TeamHandicapCard`
**Roles:**
- `registerRole(role: RoleDefinition): void`
- `getRole(id: string): RoleDefinition`
- `hasRole(id: string): boolean`
- `listRoles(): RoleDefinition[]`
- `loadCustomRoles`
- `generalist`
- `backend`
- `frontend`
- `architect`
- `devops`
- `ml_engineer`
- `database`
- `ux_designer`
**Escalation:**
- `resolveEscalationConfig(config?: EscalationConfig): Required<EscalationConfig>`
- `detectEscalation(opts: { config?: EscalationConfig; standups?: StandupReport[]; conflicts?: SprintConflict[]; events?: SlopeEvent[]; now?: number }): EscalationResult[]`
- `buildEscalationEvent(escalation: EscalationResult, sessionId: string, sprintNumber?: number): Omit<SlopeEvent, "id" | "timestamp">`
**Standup (Communication Protocol):**
- `generateStandup(opts: { sessionId: string; agent_role?: string; events: SlopeEvent[]; claims: SprintClaim[] }): StandupReport`
- `formatStandup(report: StandupReport): string`
- `parseStandup(data: Record<string, unknown>): StandupReport | null`
- `extractRelevantHandoffs(standup: StandupReport, roleId?: string): HandoffEntry[]`
- `aggregateStandups`
- `formatTeamStandup`
**Plugin System:**
- `validatePluginManifest(raw: unknown): { valid: boolean; errors: string[] }`
- `discoverPlugins(cwd: string): DiscoveredPlugin[]`
- `loadPlugins(cwd: string, config?: PluginsConfig): PluginLoadResult`
- `loadPluginMetaphors(cwd: string, config?: PluginsConfig): PluginLoadResult`
- `loadPluginGuards(cwd: string, config?: PluginsConfig): PluginLoadResult`
- `isPluginEnabled(id: string, config?: PluginsConfig): boolean`
- `saveCustomMetaphor(definition: MetaphorDefinition, setActive?: boolean): SaveMetaphorResult`
**Leaderboard (Multi-Developer):**
- `buildLeaderboard(scorecards: GolfScorecard[]): Leaderboard`
- `formatLeaderboard`
- `renderLeaderboardHtml`
**Player (Multi-Developer):**
- `DEFAULT_PLAYER`
- `extractPlayers(scorecards: GolfScorecard[]): string[]`
- `filterScorecardsByPlayer(scorecards: GolfScorecard[], player: string): GolfScorecard[]`
- `computePlayerHandicaps(scorecards: GolfScorecard[]): PlayerHandicap[]`
- `computePlayerHandicap`
- `computeReporterSeverity(reporters: string[]): 'low' | 'medium' | 'high'`
- `mergeHazardIndices(issues: CommonIssuesFile, newPatterns: RecurringPattern[], reporter: string): CommonIssuesFile`
- `filterHazardsByVisibility`
**Review (Implementation Review Integration):**
- `recommendReviews(input: RecommendReviewsInput): ReviewRecommendation[]`
- `findingToHazard(finding: ReviewFinding): HazardHit`
- `amendScorecardWithFindings(scorecard: GolfScorecard, findings: ReviewFinding[]): AmendResult`
**Flows:**
- `parseFlows(json: string): FlowsFile`
- `validateFlows(flows: FlowsFile, cwd: string): { errors: string[], warnings: string[] }`
- `checkFlowStaleness(flow: FlowDefinition, currentSha: string, cwd: string): { stale: boolean, changedFiles: string[] }`
- `loadFlows(flowsPath: string): FlowsFile | null`
**Inspirations:**
- `parseInspirations`
- `validateInspirations`
- `loadInspirations(inspirationsPath: string): InspirationsFile | null`
- `linkInspirationToSprint(path: string, id: string, sprint: number): InspirationsFile`
- `deriveId(projectName: string): string`
**Imports (blast radius):**
- `parseImports`
- `buildImportGraph(rootDir: string): Map<string, string[]>`
- `blastRadius(graph: Map<string, string[]>, targetFile: string): string[]`
**Interview (Init):**
- `validateInitInput`
- `initFromInterview`
- `initFromAnswers`
**Metaphor Preview:**
- `buildMetaphorPreview`
- `buildAllPreviews`
- `formatPreviewText`
**Interview Steps:**
- `generateInterviewSteps`
**Interview Engine:**
- `runLightweightDetection`
- `buildInterviewContext`
- `validateInterviewAnswers`
- `answersToInitInput`
**Project Registry (Multi-Project):**
- `FileProjectRegistry`
**GitHub (Remote Git Analysis):**
- `createGitHubClient`
- `parseRepoUrl`
- `GitHubApiError`
**Webhooks (CI Integration):**
- `validateGitHubWebhookSignature`
- `handleCheckRunWebhook`
- `handleWorkflowRunWebhook`
**Event Ingestion:**
- `validateEventPayload`
- `ingestEvents`
- `createEventHandler`
**Analyzers:**
- `runAnalyzers(opts?: { cwd?: string; analyzers?: AnalyzerName[] }): Promise<RepoProfile>`
- `loadRepoProfile(cwd?: string): RepoProfile | null`
- `saveRepoProfile(profile: RepoProfile, cwd?: string): void`
- `analyzeStack`
- `detectPackageManager(cwd?: string): string | null`
**Complexity:**
- `estimateComplexity(profile: RepoProfile): ComplexityProfile`
**Backlog:**
- `analyzeBacklog(cwd: string): Promise<BacklogAnalysis>`
**GitHub Backlog:**
- `analyzeGitHubBacklog(owner: string, repo: string, client: GitHubClient): Promise<GitHubBacklogAnalysis>`
**Merged Backlog:**
- `mergeBacklogs(local: BacklogAnalysis, remote?: GitHubBacklogAnalysis): MergedBacklog`
**Generators:**
- `generateConfig(profile: RepoProfile): GeneratedConfig`
- `generateFirstSprint(profile: RepoProfile, complexity: ComplexityProfile, backlog?: BacklogAnalysis): GeneratedSprint`
- `generateCommonIssues(profile: RepoProfile, backlog: BacklogAnalysis): CommonIssuesFile`
- `generateRoadmap(profile: RepoProfile, complexity: ComplexityProfile, backlog: MergedBacklog): RoadmapDefinition`
- `generateRoadmapFromVision(vision: VisionDocument, backlog: MergedBacklog, complexity?: ComplexityProfile): RoadmapDefinition`
**Vision:**
- `loadVision(cwd?: string): VisionDocument | null`
- `saveVision(vision: VisionDocument, cwd?: string): void`
- `validateVision(vision: unknown): string[]`
- `createVision(fields: { purpose: string; priorities: string[]; audience?: string; techDirection?: string; nonGoals?: string[] }, cwd?: string): VisionDocument`
- `updateVision(fields: { purpose?: string; priorities?: string[]; audience?: string; techDirection?: string; nonGoals?: string[] }, cwd?: string): VisionDocument`
**Transcript:**
- `getTranscriptPath`
- `appendTurn`
- `readTranscript(transcriptsDir: string, sessionId: string): TranscriptTurn[]`
- `listTranscripts(transcriptsDir: string): string[]`
**Initiative (Multi-Sprint Orchestration):**
- `selectSpecialists`
- `getReviewChecklist`
- `getNextPhase`
- `canAdvance`
- `loadInitiative`
- `saveInitiative`
- `createInitiative`
- `advanceSprint`
- `recordReview`
- `getNextSprint`
- `formatInitiativeStatus`
**Embedding:**
- `chunkFile`
- `shouldSkipFile`
- `MAX_CHUNK_FILE_SIZE`
- `SKIP_EXTENSIONS`
- `SKIP_FILENAMES`
- `SKIP_DIRS`
- `embed`
- `embedBatch`
- `hasEmbeddingSupport`
**Context:**
- `deduplicateByFile`
- `formatContextForAgent`
**Prep (Execution Plans):**
- `generatePrepPlan`
- `formatPrepPlan`
- `resolveTicket`
- `buildQueryText`
- `collectTestFiles`
- `findSimilarTickets`
- `extractHazards`
**Enrich (Backlog Enrichment):**
- `enrichTicket`
- `enrichBacklog`
- `estimateTokens`
**Docs (Documentation Manifest):**
- `buildDocsManifest`
- `computeSectionChecksum`
**Deferred Findings:**
- `loadDeferred`
- `saveDeferred`
- `createDeferred`
- `resolveDeferred`
- `listDeferred`
- `formatDeferredForBriefing`
- `deferredPath`
**Analytics:**
- `computeHandicapTrend`
- `computeVelocity`
- `computeGuardMetrics`
**Built-in metaphors (auto-registers on import):**
- `golf`
- `tennis`
- `baseball`
- `gaming`
- `dnd`
- `matrix`
- `agile`
<!-- AUTO-GENERATED: END api -->

## CLI Commands

<!-- AUTO-GENERATED: START cli -->

- `slope init` — Initialize .slope/ directory
- `slope help` — Show detailed per-command usage
- `slope quickstart` — Interactive tutorial for new users
- `slope doctor` — Check repo health and auto-fix issues
- `slope version` — Show version or bump with automated PR workflow
- `slope session` — Manage live sessions
- `slope claim` — Claim a ticket or area for the sprint
- `slope release` — Release a claim by ID or target
- `slope status` — Show sprint course status and conflicts
- `slope next` — Show next sprint number (auto-detect)
- `slope sprint` — Manage sprint lifecycle state and gates
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
- `slope inspirations` — Track external OSS inspiration sources
- `slope metaphor` — Manage metaphor display themes
- `slope plugin` — Manage custom plugins
- `slope store` — Store diagnostics and management
- `slope escalate` — Escalate issues based on severity triggers
- `slope transcript` — View session transcript data
- `slope roadmap` — Strategic planning and roadmap tools
- `slope vision` — Display project vision document
- `slope initiative` — Multi-sprint initiative orchestration
- `slope loop` — Autonomous sprint execution loop
- `slope worktree` — Manage git worktrees
- `slope index-cmd` — Semantic embedding index management
- `slope context` — Semantic context search for agents
- `slope prep` — Generate execution plan for a ticket
- `slope enrich` — Batch-enrich backlog with file context
- `slope stats` — Export stats JSON for slope-web live dashboard
- `slope docs` — Generate documentation manifest and changelog
<!-- AUTO-GENERATED: END cli -->

## Guard Definitions

<!-- AUTO-GENERATED: START guards -->

| Guard | Hook Event | Matcher | Description |
|-------|-----------|---------|-------------|
| `explore` | PreToolUse | Read|Glob|Grep|Edit|Write | Suggest checking codebase index before deep exploration |
| `hazard` | PreToolUse | Edit|Write | Warn about known issues in file areas being edited |
| `commit-nudge` | PostToolUse | Edit|Write | Nudge to commit/push after prolonged editing |
| `scope-drift` | PreToolUse | Edit|Write | Warn when editing files outside claimed ticket scope |
| `compaction` | PreCompact | — | Extract events before context compaction |
| `stop-check` | Stop | — | Check for uncommitted/unpushed work before session end |
| `subagent-gate` | PreToolUse | Agent | Enforce model selection on Explore/Plan subagents |
| `push-nudge` | PostToolUse | Bash | Nudge to push after git commits when unpushed count or time is high |
| `workflow-gate` | PreToolUse | ExitPlanMode | Block ExitPlanMode until review rounds are complete |
| `review-tier` | PostToolUse | Edit|Write | Suggest plan review with specialist reviewers after plan file write |
| `version-check` | PreToolUse | Bash | Block push to main when package versions have not been bumped |
| `stale-flows` | PreToolUse | Edit|Write | Warn when editing files belonging to a stale flow definition |
| `next-action` | Stop | — | Suggest next actions before session end |
| `pr-review` | PostToolUse | Bash | Prompt for review workflow after PR creation |
| `transcript` | PostToolUse | — | Append tool call metadata to session transcript |
| `branch-before-commit` | PreToolUse | Bash | Block git commit on main/master — create a feature branch first |
| `worktree-check` | PreToolUse | Edit|Write|Bash | Block concurrent sessions without worktree isolation |
| `sprint-completion` | PreToolUse | Bash | Block PR creation when sprint gates are incomplete |
| `sprint-completion` | Stop | — | Block session end when sprint gates are incomplete |
| `sprint-completion` | PostToolUse | Bash | Auto-detect test pass and mark gate complete |
| `worktree-merge` | PreToolUse | Bash | Block gh pr merge --delete-branch in worktrees (causes false failure) |
| `worktree-self-remove` | PreToolUse | Bash | Block git worktree remove when targeting own cwd |
| `phase-boundary` | PreToolUse | Bash | Block starting sprint in new phase if previous phase cleanup incomplete |
| `claim-required` | PreToolUse | Edit|Write | Warn when editing code without an active sprint claim |
| `post-push` | PostToolUse | Bash | Suggest next workflow step after git push |
| `session-briefing` | PostToolUse | — | Inject sprint context on first tool call of session |
| `review-stale` | Stop | — | Warn about scored sprints with missing reviews at session end |
| `worktree-reuse` | PreToolUse | EnterWorktree | Guide agent to reuse existing worktrees instead of recreating |
<!-- AUTO-GENERATED: END guards -->

## MCP Tools

<!-- AUTO-GENERATED: START mcp -->

- `search`
- `execute`
- `context_search`
- `session_status`
- `acquire_claim`
- `check_conflicts`
- `store_status`
- `testing_session_start`
- `testing_session_finding`
- `testing_session_end`
- `testing_session_status`
- `testing_plan_status`
<!-- AUTO-GENERATED: END mcp -->

## Test Inventory

<!-- AUTO-GENERATED: START tests -->

| Directory | Test Files | Command |
|-----------|-----------|---------|
| tests/cli | 65 | `pnpm test` |
| tests/core | 79 | `pnpm test` |
| tests/mcp | 6 | `pnpm test` |
| tests/store | 1 | `pnpm test` |
| tests/store-pg | 2 | `pnpm test` |
| tests/tokens | 1 | `pnpm test` |

**Total test files:** 154
**Run all:** `pnpm -r test`
**Typecheck:** `pnpm -r typecheck`
<!-- AUTO-GENERATED: END tests -->

## Recent Sprint History

<!-- AUTO-GENERATED: START history -->

| Sprint | Theme | Tickets | Score |
|--------|-------|---------|-------|
| **62** | The Welcome Mat v2 + Templates — Streamlined First-Run Experience & Sprint/Ticket Templates | 5 | par |
| **63** | The Handbook + Template Integration — CLI Help & Documentation Polish | 6 | eagle |
| **64** | Claim Hygiene, Worktree Safety & Loop Planner Context | 5 | par |
| **65** | The Inspiration Engine | 3 | bogey |
| **66** | The Scorekeeper — Sprint Analytics Dashboard | 4 | par |
<!-- AUTO-GENERATED: END history -->

## Known Gotchas

Top recurring patterns from common-issues:

<!-- AUTO-GENERATED: START gotchas -->

<!-- AUTO-GENERATED: END gotchas -->