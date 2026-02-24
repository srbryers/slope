---
generated_at: "2026-02-24T21:37:22.095Z"
git_sha: "38fd775bb8a8072e86f1b060a9e28d167c67cbf2"
sprint: 29
source_files: 98
test_files: 50
cli_commands: 27
guards: 13
flows: 0
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->

### `src/cli`
- Source files: 49 | Test files: 14
- Key modules:
  - `config`
  - `hooks-config`
  - `loader`
  - `metaphor` — CLI metaphor resolution
  - `store`
  - `template-generator` — SLOPE Template Generator

### `src/core`
- Source files: 39 | Test files: 30
- Key modules:
  - `advisor` — --- Module-private constants ---
  - `briefing` — --- Input types ---
  - `builder` — --- Helpers ---
  - `ci-signals` — SLOPE — CI/Test Signal Parser
  - `config`
  - `constants` — Maps ticket count ranges to par values
  - `dashboard` — --- Dashboard Config ---
  - `dispersion` — --- Helpers ---
  - `escalation` — SLOPE — Escalation Rules
  - `flows` — Flow tracking — map user-facing workflows to code paths.
  - `formatter` — --- Input types ---
  - `guard` — SLOPE Guard Framework
  - `handicap` — Compute par value from ticket count.
  - `leaderboard` — A single entry in the team leaderboard
  - `loader` — Load SLOPE scorecards from the configured directory.
  - ... and 15 more

### `src/mcp`
- Source files: 3 | Test files: 4
- Key modules:
  - `registry` — ─── Core Scoring Enums ───
  - `sandbox` — SLOPE sandbox — runs agent-written JS in a node:vm context

### `src/store`
- Source files: 1 | Test files: 1

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
- `ClubSelection`, `ShotResult`, `HazardType`, `ConditionType`, `SpecialPlay`, `MissDirection`, `ScoreLabel`, `SprintType`, `HazardHit`, `ShotRecord`, `ConditionRecord`, `HoleStats`, `HoleScore`, `TrainingType`, `TrainingSession`, `NutritionCategory`, `NutritionEntry`, `NineteenthHole`, `GolfScorecard`, `AgentBreakdown`, `RollingStats`, `HandicapCard`, `DispersionReport`, `AreaReport`, `ExecutionTrace`, `ShotClassification`, `ClubRecommendation`, `TrainingRecommendation`, `ClaimScope`, `SprintClaim`, `SprintConflict`, `EventType`, `SlopeEvent`, `CIRunner`, `CISignal`, `PRPlatform`, `PRReviewDecision`, `PRSignal`, `HazardSeverity` (types)
**Constants:**
- `PAR_THRESHOLDS`, `SLOPE_FACTORS`, `SCORE_LABELS`, `TRAINING_TYPE_MAP`, `NUTRITION_CHECKLIST`, `HAZARD_SEVERITY_PENALTIES`
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
- `SlopeStore`, `SlopeSession`, `StoreErrorCode` (types)
**Tournament Review:**
- `buildTournamentReview`, `formatTournamentReview`
- `TournamentReview`, `TournamentSprintEntry`, `TournamentScoring`, `TournamentStats`, `TournamentHazard` (types)
**Roadmap:**
- `validateRoadmap`, `computeCriticalPath`, `findParallelOpportunities`, `parseRoadmap`, `formatRoadmapSummary`, `formatStrategicContext`
- `RoadmapDefinition`, `RoadmapSprint`, `RoadmapTicket`, `RoadmapPhase`, `RoadmapClub`, `RoadmapValidationResult`, `RoadmapValidationError`, `RoadmapValidationWarning`, `CriticalPathResult`, `ParallelGroup` (types)
**Config:**
- `SlopeConfig` (types)
- `loadConfig`, `createConfig`, `resolveConfigPath`
**Loader:**
- `loadScorecards`, `detectLatestSprint`, `resolveCurrentSprint`
**Metaphor:**
- `registerMetaphor`, `getMetaphor`, `listMetaphors`, `hasMetaphor`, `validateMetaphor`
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
- `registerRole`, `getRole`, `hasRole`, `listRoles`, `loadCustomRoles`, `generalist`, `backend`, `frontend`, `architect`, `devops`
- `RoleDefinition` (types)
**Escalation:**
- `resolveEscalationConfig`, `detectEscalation`, `buildEscalationEvent`
- `EscalationTrigger`, `EscalationSeverity`, `EscalationAction`, `EscalationConfig`, `EscalationResult` (types)
**Standup (Communication Protocol):**
- `generateStandup`, `formatStandup`, `parseStandup`, `extractRelevantHandoffs`
- `StandupReport`, `HandoffEntry` (types)
**Plugin System:**
- `validatePluginManifest`, `discoverPlugins`, `loadPlugins`, `loadPluginMetaphors`, `loadPluginGuards`, `isPluginEnabled`
- `PluginType`, `PluginManifest`, `DiscoveredPlugin`, `PluginLoadResult`, `PluginsConfig` (types)
**Leaderboard (Multi-Developer):**
- `buildLeaderboard`, `formatLeaderboard`, `renderLeaderboardHtml`
- `LeaderboardEntry`, `Leaderboard` (types)
**Player (Multi-Developer):**
- `DEFAULT_PLAYER`, `extractPlayers`, `filterScorecardsByPlayer`, `computePlayerHandicaps`, `computePlayerHandicap`, `computeReporterSeverity`, `mergeHazardIndices`, `filterHazardsByVisibility`
- `PlayerHandicap`, `ReporterSeverity` (types)
**Flows:**
- `parseFlows`, `validateFlows`, `checkFlowStaleness`, `loadFlows`
- `FlowStep`, `FlowDefinition`, `FlowsFile`, `FlowValidationResult`, `FlowStalenessResult` (types)
**Built-in metaphors (auto-registers on import):**
- `golf`, `tennis`, `baseball`, `gaming`, `dnd`, `matrix`, `agile`
<!-- AUTO-GENERATED: END api -->

## CLI Commands

<!-- AUTO-GENERATED: START cli -->

- `slope auto-card` — Build per-agent breakdowns by mapping commits to swarm sessions via branch.
- `slope briefing`
- `slope card`
- `slope claim`
- `slope classify`
- `slope dashboard`
- `slope distill`
- `slope escalate`
- `slope extract`
- `slope flows` — slope flows — Manage user flow definitions
- `slope guard` — Registry of guard handler implementations
- `slope hook`
- `slope init` — Detect platforms present in the project directory
- `slope map` — ── Helpers ─────────────────────────────────────────────────────
- `slope next`
- `slope plan`
- `slope plugin`
- `slope release`
- `slope report`
- `slope review-state`
- `slope review`
- `slope roadmap` — --- Helpers ---
- `slope session`
- `slope standup`
- `slope status`
- `slope tournament`
- `slope validate`
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
<!-- AUTO-GENERATED: END guards -->

## MCP Tools

<!-- AUTO-GENERATED: START mcp -->

- `search`
- `execute`
- `session_status`
- `acquire_claim`
- `check_conflicts`
<!-- AUTO-GENERATED: END mcp -->

## Test Inventory

<!-- AUTO-GENERATED: START tests -->

| Directory | Test Files | Command |
|-----------|-----------|---------|
| tests/cli | 14 | `pnpm test` |
| tests/core | 30 | `pnpm test` |
| tests/mcp | 4 | `pnpm test` |
| tests/store | 1 | `pnpm test` |
| tests/tokens | 1 | `pnpm test` |

**Total test files:** 50
**Run all:** `pnpm -r test`
**Typecheck:** `pnpm -r typecheck`
<!-- AUTO-GENERATED: END tests -->

## Recent Sprint History

<!-- AUTO-GENERATED: START history -->

| Sprint | Theme | Tickets | Score |
|--------|-------|---------|-------|
| **25** | Hazard Severity Scoring | 4 | par |
| **26** | The Fairway Map — User Flow Tracking | 5 | bogey |
| **27** | The Clubhouse — Marketing Site & Design Tokens | 5 | par |
| **28** | The Pro Tour — Content & Interactive Features | 4 | par |
| **29** | Fix NPM Publishing Pipeline | 6 | par |
<!-- AUTO-GENERATED: END history -->

## Known Gotchas

Top recurring patterns from common-issues:

<!-- AUTO-GENERATED: START gotchas -->

- **Example pattern** (general, 1 sprint): This is an example recurring pattern. Replace with your own.
- **Run full Post-Hole routine after every sprint** (general, 1 sprint): After filing the scorecard, it's easy to skip validate + review + common-issues.
- **Workspace packages must use workspace:* protocol for local deps** (monorepo, 1 sprint): mcp-tools had @srbryers/core pinned to ^0.3.3 (npm), so TypeScript resolved the published version instead of the local workspace version with new exports.
- **Core package needs @types/node when importing node: modules** (monorepo, 1 sprint): Moving config.ts/loader.ts to core failed to compile because core didn't have @types/node — it had been a pure-logic package until now.
- **better-sqlite3 native build requires pnpm onlyBuiltDependencies approval** (monorepo, 1 sprint): pnpm ignores native build scripts by default. better-sqlite3 silently fails to compile, causing runtime errors. pnpm approve-builds is interactive and unusable in CI/agent contexts.
- **Making sync functions async breaks callers that don't await** (general, 1 sprint): Changing initCommand from sync to async caused 5 CLI tests to fail — they called initCommand() without await, so assertions ran before the async work completed.
- **tsconfig.json must exclude *.test.ts when tests live alongside source** (monorepo, 1 sprint): store-sqlite had tests in src/index.test.ts. The default include: ['src/**/*.ts'] pulled test files into the build, causing type errors from test-only types to surface during tsc.
- **TypeScript strict mode rejects interface-to-Record<string,unknown> cast** (typescript, 1 sprint): SlopeConfig interface has no index signature, so TypeScript strict mode rejects `config as Record<string, unknown>`. The workaround is double-cast via unknown, but the real fix is adding the field to the interface.
- **Async CLI commands need await/rejects in tests, not sync toThrow** (testing, 1 sprint): When a CLI command is async and mocks process.exit, using `expect(() => fn()).toThrow()` silently passes because the promise rejection is unhandled. Tests appear to pass but assertions never execute.
- **Telemetry tables should not have FK constraints to session tables** (database, 1 sprint): Events table initially had REFERENCES sessions(session_id). This prevented inserting events with session IDs that don't exist in the sessions table (e.g., from external tools or after session cleanup).
<!-- AUTO-GENERATED: END gotchas -->