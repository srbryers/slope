## docs/tutorial-first-sprint.md (score: 0.572)
```
      "result": "green",
      "hazards": [],
      "notes": "Redis session store worked first try"
    },
    {
      "ticket_key": "S5-4",
      "title": "Auth tests",
      "club": "wedge",
      "result": "green",
      "hazards": [
        { "type": "rough", "description": "Mock OAuth server setup was fiddly" }
      ]
    }
  ],
  "conditions": [
    { "type": "wind", "description": "OAuth provider had intermittent outages" }
  ],
  "special_plays": [],
  "stats": {
    "fairways_hit": 4,
    "fairways_total": 4,
    "greens_in_regulation": 3,
    "greens_total": 4,
    "putts": 0,
    "penalties": 1,
    "hazards_hit": 3,
    "hazard_penalties": 0,
    "miss_directions": { "long": 1, "short": 0, "left": 0, "right": 0 }
  },
  "yardage_book_updates": [
    "OAuth integrations: start with minimal token storage, iterate"
  ],
  "bunker_locations": [
    "OAuth provider documentation frequently outdated — verify against actual API"
  ],
  "course_management_notes": [
    "The OAuth ticket should have been a driver, not a long iron",
    "Session management was straightforward — good club selection there"
  ]
}
```

Save this as `docs/retros/sprint-5.json`.

> **Tip:** You can use `slope auto-card --sprint=5` to generate a draft scorecard from git commits and CI signals, then refine it manually.

### Validate

```bash
slope validate docs/retros/sprint-5.json
```

Expected output:

```
Validating docs/retros/sprint-5.json...
  ✓ Sprint 5 "User Authentication" — bogey (+1)
    4 shots, 3 hazards, 1 penalty
    Miss pattern: 1 long
```

Fix any validation errors before proceeding.

### Generate the Review

```bash
slope review docs/retros/sprint-5.json
```

This produces a markdown review with:
- Score summary (bogey — 1 over par)
- Shot-by-shot analysis
- Hazard summary
- Miss pattern analysis
- Recommendations for next sprint

### Check for Implementation Reviews

```bash
slope review recommend
```

If reviews are recommended (architect, code, security, etc.), conduct them and record findings:

```bash
slope review findings add --type=code --ticket=S5-2 --severity=medium \
  --description="Token refresh should use exponential backoff"
slope review amend --sprint=5
```

## Part 5: Performance

### View Your Handicap Card

```bash
slope card
```

Output:

```
SLOPE Handicap Card
═══════════════════

         Last 5    Last 10   All-Time
Avg       +0.6      +0.4      +0.3
Best       -1        -1        -1
Worst      +2        +2        +2
Trend      →         ↑         ↑

Miss Pattern (last 10):
  Long:  3  ████
  Short: 1  █
  Left:  1  █
  Right: 0

Hazard Index:
  Rough:  5  █████
  Bunker: 3  ███
  Water:  1  █
```

The handicap card reveals:
- **Trend direction** — are you improving (↑), stable (→), or declining (↓)?
- **Miss patterns** — do you consistently over-engineer (long) or under-scope (short)?
- **Hazard frequency** — which types of gotchas hit you most?

### Generate an HTML Report

```bash
slope report --html --output=slope-report.html
```

Opens a self-contained HTML dashboard with charts for handicap trends, dispersion patterns, area performance, and sprint-by-sprint breakdowns.

### Interactive Dashboard

```bash
slope dashboard
```

Launches a live local dashboard that auto-refreshes as you add scorecards.

## Part 6: Planning Sprint 2

### Distill Learnings

After reviewing your scorecard, promote recurring patterns to common issues:

```bash
slope distill
```

This scans your sprint data for patterns and adds them to `.slope/common-issues.json`, so they appear in future briefings.

### Brief for Next Sprint

```bash
slope briefing --sprint=6
```

The briefing now includes hazards and gotchas from Sprint 5, so you avoid the same mistakes.

### Install Guard Hooks

If you haven't already, install guidance hooks for real-time hints during coding:

```bash
slope hook add --level=full
```

Guards will:
- Remind you to check the codebase map before exploring
- Warn about known hazards in files you're editing
- Nudge you to commit and push regularly
- Alert you when editing outside your claimed scope

## Appendix: Scorecard JSON Schema

### Required Fields

| Field            | Type     | Description                                    |
|------------------|----------|------------------------------------------------|
| `sprint_number`  | number   | Sprint identifier                              |
| `theme`          | string   | Sprint theme/name                              |
| `par`            | number   | Expected baseline (3, 4, or 5)                 |
| `slope`          | number   | Difficulty rating (count of slope factors)      |
| `score`          | number   | Actual score (tickets + penalties)              |
| `score_label`    | string   | eagle/birdie/par/bogey/double_bogey/triple_plus |
| `date`           | string   | ISO date (YYYY-MM-DD)                          |
| `shots`          | array    | One entry per ticket (see below)               |
| `conditions`     | array    | External factors                               |
| `special_plays`  | array    | Mulligans, gimmes, provisionals                |
| `stats`          | object   | Computed statistics (see below)                |

### Shot Object

| Field        | Type   | Description                              |
|--------------|--------|------------------------------------------|
| `ticket_key` | string | Ticket identifier (e.g., "S5-1")        |
```

## docs/retros/sprint-4-review.md (score: 0.570)
```
## Sprint 4 Review: Code Mode MCP Refactor

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | par |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 0 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S4-1 | long_iron | in_the_hole | rough: core missing @types/node — required adding devDep | Clean copy; CLI re-exports preserve API. Added @types/node to core. |
| S4-2 | short_iron | in_the_hole | — | 33-entry SLOPE_REGISTRY + SLOPE_TYPES constant; search tool with query/module filtering |
| S4-3 | driver | in_the_hole | rough: mcp-tools resolved published core v0.3.3 instead of workspace — switched to workspace:* protocol | node:vm sandbox with full core API, path-scoped fs, 30s timeout, console capture |
| S4-4 | short_iron | in_the_hole | — | Server now exposes exactly 2 tools; 16 new tests all pass; README rewritten for code-mode pattern |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| wind | minor | cross_package refactor (CLI → core) |
| altitude | minor | new_area: node:vm sandbox |
| wind | minor | external_dep: workspace protocol resolution |

### Hazards Discovered (Bunker Locations)

| Type | Ticket | Description |
|---|---|---|
| rough | S4-1 | core missing @types/node — required adding devDep |
| rough | S4-3 | mcp-tools resolved published core v0.3.3 instead of workspace — switched to workspace:* protocol |

### Course Management Notes

- Code-mode MCP pattern: 2 tools (search + execute) replace N individual tools
- Path-scope all fs helpers with safePath() — resolve then check startsWith(cwd)

```

## templates/cursor/rules/slope-commit-discipline.mdc (score: 0.569)
```
---
description: Commit and push discipline for SLOPE-managed sprints
globs:
alwaysApply: true
---

# Commit Discipline

**Commit early, commit often.** The last push is the recovery point.

## Commit triggers:

Commit immediately after ANY of these:
1. Each new file — route, migration, config, component, test
2. Each endpoint or feature implemented
3. Each migration — commit separately
4. Each bug fix — no matter how small
5. Before switching context to a different area
6. Before risky operations — large refactor, dependency upgrade
7. Time check — if ~15 minutes since last commit, commit what works
8. Session end — never leave uncommitted changes (use `wip:` prefix if incomplete)

## Push triggers:

Push immediately after ANY of these:
1. After each completed ticket (Post-Shot Routine)
2. Every 30 minutes
3. Before switching tickets
4. Session end — never leave unpushed commits

## Commit message format:

```
<type>(<ticket>): <short summary in imperative mood>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `wip`

```

## docs/backlog/sprint-26-plan.md (score: 0.568)
```
# Sprint 26 — The Fairway Map: User Flow Tracking

**Par:** 4 | **Slope:** 2 (`new subsystem across 3 packages, but follows established patterns`) | **Type:** feature

**Theme:** Flow tracking — map user-facing workflows to code paths, queryable via MCP search.

## Tickets

### S26-1: Flow types + validation functions
- **Club:** short_iron | **Complexity:** standard
- Create `packages/core/src/flows.ts` with types and pure functions:
  - `FlowStep`, `FlowDefinition`, `FlowsFile` — typed schema
  - `parseFlows(json)` — parse + validate JSON
  - `validateFlows(flows, cwd)` — check file paths resolve, detect orphaned paths
  - `checkFlowStaleness(flow, currentSha, cwd)` — diff files between verified SHA and current
  - `loadFlows(flowsPath)` — read + parse, return null if missing
- Export types and functions from `packages/core/src/index.ts`
- Add `flowsPath` to `SlopeConfig` interface with default `.slope/flows.json`
- Tests in `packages/core/tests/flows.test.ts`

### S26-2: `slope flows` CLI command
- **Club:** short_iron | **Complexity:** standard
- Create `packages/cli/src/commands/flows.ts` with subcommands:
  - `slope flows init` — create `.slope/flows.json` with example template
  - `slope flows list` — table of flows with staleness indicators
  - `slope flows check` — validate all flows (file existence, staleness per SHA); exit 1 if any stale
- Register in `packages/cli/src/index.ts`
- Tests in `packages/cli/tests/flows.test.ts`

### S26-3: MCP search integration
- **Club:** short_iron | **Complexity:** standard
- Add `'flows'` to Zod module enum in `packages/mcp-tools/src/index.ts`
- Add `handleFlowsQuery(query?)` — reads `.slope/flows.json`, filters by id/title/tags, returns formatted definitions with staleness
- Wire into search dispatch
- Add `'flows'` to registry module type in `packages/mcp-tools/src/registry.ts`
- Add registry entries for flow functions
- Add flow type definitions to `SLOPE_TYPES`
- Tests in `packages/mcp-tools/tests/flows.test.ts`

### S26-4: CODEBASE.md flows section + stale-flows guard
- **Club:** wedge | **Complexity:** small
- Add `generateFlowsSummary()` to `packages/cli/src/commands/map.ts`
- Add `<!-- AUTO-GENERATED: START/END flows -->` markers to template
- Add `flows` count to YAML frontmatter metadata
- Add `'stale-flows'` guard to `GuardName` type union and `GUARD_DEFINITIONS` in `packages/core/src/guard.ts`

### S26-5: Docs + sprint plan artifact
- **Club:** putter | **Complexity:** trivial
- Save sprint plan to `docs/backlog/sprint-26-plan.md`
- Update `docs/backlog/README.md` with Sprint 26 row
- Update `CLAUDE.md` with Flows section

## Execution Order

```
S26-1 → S26-2 → S26-3 → S26-4 → S26-5
         ↘ S26-4 (guard part can parallel with S26-3)
```

```

## docs/retros/sprint-27-review.md (score: 0.567)
```

## Sprint 27 Review: The Clubhouse — Marketing Site & Design Tokens

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (5/5) |
| GIR % | 80% (4/5) |
| Putts | 1 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S27-1 | Short Iron | In the Hole | — | Created packages/tokens with colors, typography, spacing, and generateCssVariables(). 20 tests. Built and passed first try. |
| S27-2 | Short Iron | Green | dependency_hell: Token import `text` shadowed by `text` parameter in svgText() function — required aliasing to `textColor` | Replaced all hardcoded hex values in REPORT_CSS, DASHBOARD_CSS, and chart functions. Naming collision caught during build, fixed with import alias. One non-interpolated reference missed by replace_all. |
| S27-3 | Long Iron | Green | api_changes: GitHub GraphQL API rate limit exhausted — switched to REST API for repo creation | Created srbryers/slope-web repo, copied Astro site from caddystack, rebranded all CaddyStack references to SLOPE. 3 pages build clean. Live-stats API kept pointing at caddystack.fly.dev. |
| S27-4 | Wedge | In the Hole | — | Created Cloudflare Pages project via wrangler CLI. First deployment live at slope-web.pages.dev. Ready for slope.dev custom domain when DNS is configured. |
| S27-5 | Putter | In the Hole | — | Updated CLAUDE.md, publish.yml, backlog README. Saved sprint plan. Full build+typecheck+test green across all packages. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | none | New package + new repo + external service (Cloudflare) — high slope factor |
| Altitude | minor | GitHub GraphQL rate limit hit mid-sprint — required API fallback |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| dependency_hell | S27-2 | Token import `text` shadowed by `text` parameter in svgText() function — required aliasing to `textColor` |
| api_changes | S27-3 | GitHub GraphQL API rate limit exhausted — switched to REST API for repo creation |

**Known hazards for future sprints:**
- Token import naming collisions — `text` is a common parameter name in rendering functions
- GitHub GraphQL rate limits can exhaust mid-session if other tools (e.g., Copilot, gh CLI) consume budget

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | Full build+typecheck+test after S27-1 and S27-2, final verification before S27-5 commit |
| Diet | healthy | Commit-per-ticket discipline — 4 commits in slope repo, 1 in slope-web, pushed after each |
| Supplements | healthy | 20 new tests in tokens package. All existing 1071 tests unchanged and passing. |
| Recovery | healthy | Naming collision in S27-2 caught at build time, fixed with import alias before commit — no broken commits |

### Course Management Notes

- 5 tickets, par 4, score 4 — clean par with 2 minor hazards absorbed
- New package created (tokens), new repo created (slope-web), external deployment (Cloudflare)
- Tests grew from 1071 to 1091 (+20 in tokens package)
- 4 commits in slope repo, 1 commit in slope-web repo

### 19th Hole

- **How did it feel?** Solid sprint with good breadth — touched the monorepo (new package + refactor), created a new repo, and deployed to Cloudflare. The tokens package extraction was clean and the report refactor preserved all visual output exactly.
- **Advice for next player?** When importing token names that match common parameter names (like `text`), use import aliases immediately (e.g., `text as textColor`). The replace_all tool only catches template interpolations `${text.xxx}` — bare references like `text.muted` in function arguments need manual attention.
- **What surprised you?** The GitHub GraphQL rate limit was unexpected — it was exhausted before we even started. The REST API fallback (POST /user/repos) worked perfectly though. Always have a fallback for external APIs.
- **Excited about next?** slope-web is live and ready for content updates. Sprint 28 can focus on the fun stuff — metaphor switcher, install command toggle, and a full content audit against current SLOPE capabilities.


```

## CODEBASE.md (score: 0.567)
```
---
generated_at: "2026-03-01T22:36:10.154Z"
git_sha: "6f93a406e155e313dffc1054acf7892dd3f6401f"
sprint: 48
source_files: 157
test_files: 114
cli_commands: 36
guards: 16
flows: 0
---

# SLOPE Codebase Map

Sprint Lifecycle & Operational Performance Engine — pluggable-metaphor sprint scoring.

## Package Inventory

<!-- AUTO-GENERATED: START packages -->

### `src/cli`
- Source files: 64 | Test files: 35
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
- Source files: 81 | Test files: 69
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
  - `embedding-client` — SLOPE — HTTP Client for OpenAI-Compatible Embedding Endpoints
  - `embedding-store` — SLOPE — EmbeddingStore Interface
  - `embedding` — SLOPE — Embedding Types & Chunking Logic (pure — no HTTP calls)
  - `enrich` — SLOPE — Backlog Enrichment
  - `escalation` — SLOPE — Escalation Rules
  - `event-ingestion` — SLOPE — Real-Time Event Ingestion
  - ... and 35 more

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
```

## skills/slope-performance-analysis/SKILL.md (score: 0.566)
```
---
name: slope-performance-analysis
version: "1.0"
description: Interpreting SLOPE handicap cards, miss patterns, hazard data, and generating actionable recommendations
triggers:
  - "handicap"
  - "performance"
  - "analysis"
  - "slope card"
  - "miss pattern"
  - "hazard"
requires:
  - "@anthropic/slope-core"
context_files:
  - "CODEBASE.md"
  - ".slope/config.json"
---

# SLOPE Performance Analysis

You are a performance analysis agent for SLOPE-managed projects. You interpret handicap cards, miss patterns, hazard data, and dispersion analysis to produce actionable recommendations.

## Quick Reference

| Metric | Good | Warning | Action Needed |
|--------|------|---------|---------------|
| Handicap | 0-1 | 2-3 | 4+ |
| Trend | Improving | Stable | Worsening |
| Club success rate | >90% | 70-90% | <70% |
| Miss rate | <5% | 5-15% | >15% |
| Recurring hazards | 0-2 | 3-5 | 6+ |

## Reading a Handicap Card

Run `slope card` to generate the handicap card. Key sections:

### Rolling Stats
- **last_5 / last_10 / all_time** — handicap values at different windows
- **Trend direction:** compare last_5 vs last_10. If last_5 < last_10, trending better
- A handicap of 0 means consistently hitting par — optimal performance

### Club Performance
- Each club (driver → putter) has total shots and success rate
- **Low success rate on a club** = that complexity tier has issues
- Common pattern: driver/long_iron failures indicate over-scoping or unfamiliar territory

### Dispersion Analysis
- **Miss directions** tell you *why* tickets fail:
  - `long` — over-scoping, over-engineering, took more work than estimated
  - `short` — under-scoping, missing requirements, incomplete implementations
  - `left` — wrong approach, incorrect tools/patterns/architecture
  - `right` — scope creep, pulling in unrelated work, gold-plating
- **Dominant miss** — if one direction dominates, it's a systemic issue

## Interpreting Hazard Data

### Hazard Types
| Type | Source | Indicates |
|------|--------|-----------|
| `rough` | Code review / friction | Process issues, unclear requirements, wasted time |
| `bunker` | Architect review | Structural/design problems, wrong abstractions |
| `water` | Security review / blockers | External dependencies, infrastructure failures |
| `trees` | UX review | User flow issues, accessibility problems |

### Hotspot Analysis
Hotspots are modules with recurring hazards. Prioritize by:
1. **Risk score** — total hazard count (higher = more attention needed)
2. **Hazard diversity** — multiple hazard types = deeper structural issue
3. **Recency** — recent hazards weighted higher (temporal weighting: 0.7 recent, 0.3 historical)

### Temporal Weighting
Analysis uses weighted scoring: `weightedScore = (recentCount * 0.7) + (totalCount * 0.3)`

Recent hazards (last 10 sprints) matter more than historical ones. A module with 2 recent hazards is higher priority than one with 5 historical hazards.

## Generating Recommendations

### From Handicap Trends
- **Improving trend** → maintain current approach, reduce experimentation
- **Stable trend** → look for optimization opportunities in recurring patterns
- **Worsening trend** → investigate recent changes, check for new hazard patterns

### From Miss Patterns
- **Dominant `long`** → improve estimation; break tickets smaller; add pre-shot scope checks
- **Dominant `short`** → improve requirements gathering; add acceptance criteria to tickets
- **Dominant `left`** → improve yardage book consulting; more pre-shot research
- **Dominant `right`** → enforce ticket boundaries; flag scope additions before implementing

### From Hazard Hotspots
- **Single hazard type** → targeted fix (e.g., add tests for `rough`, refactor for `bunker`)
- **Multiple hazard types** → module needs architectural review before more changes
- **Spreading hazards** → pattern is systemic, not module-specific; review process, not code

### Backlog Strategy Selection
Based on analysis, prioritize these sprint strategies:
1. **Hardening** — fix hotspot modules with risk_score >= 2
2. **Testing** — add coverage for modules with `rough` hazards (friction during changes)
3. **Cleanup** — address recurring hazard patterns across modules
4. **Documentation** — document complex modules to prevent future `rough` hazards
5. **Meta** — improve the analysis/scoring pipeline itself

## Example Analysis Output

```
Handicap: 0.5 (improving)
Last 5: 0.2 | Last 10: 0.8 | All-time: 1.2

Top hazard: rough (weighted score: 27.0)
  → 21 recent occurrences across 15 modules
  → Recommendation: systematic rough reduction sprint

Hotspot: "Backup/restore + docs" (risk: 3)
  → 3x rough hazards — needs test hardening

Club performance: 100% across all tiers
  → No club-specific interventions needed

Dispersion: 0% miss rate
  → No systemic estimation issues
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `slope card` | Generate handicap card |
| `slope briefing` | Pre-sprint performance summary |
| `slope review recommend` | Check which reviews apply |
| `slope review findings add` | Record review finding |
| `slope review amend` | Apply findings to scorecard |

## MCP Integration

```javascript
// Full handicap card
execute({ code: "return computeHandicapCard(loadScorecards())" })

// Dispersion analysis
execute({ code: "return computeDispersion(loadScorecards())" })

// Search for specific patterns
search({ module: 'core', query: 'handicap' })
```

```

## .claude/plans/sorted-waddling-emerson.md (score: 0.566)
```
- `computeStatsFromShots` with hazard missing severity → defaults to minor (0)
- `buildScorecard` with hazards → score includes hazard penalties
- `buildScorecard` rounding: 3 shots + 1 moderate (0.5) → score 4 (rounds up from 3.5)
- `buildScorecard` with both manual penalties and hazard penalties → both contribute
- `normalizeStats` preserves hazard_penalties field

**Validation test cases:**
- Valid severity values pass
- Invalid severity value fails with `INVALID_HAZARD_SEVERITY`
- Missing severity field passes (backward compat)

---

## Execution Order

```
S25-1 (types + constants) → S25-2 (scoring logic) → S25-3 (formatter + validation) → S25-4 (tests)
```

S25-1 is foundation. S25-2 depends on it. S25-3 and S25-4 depend on S25-2.

---

## Key Files Reference

**Modified:**
- `packages/core/src/types.ts` — HazardSeverity type, HazardHit.severity field, HoleStats.hazard_penalties
- `packages/core/src/constants.ts` — HAZARD_SEVERITY_PENALTIES mapping
- `packages/core/src/builder.ts` — computeStatsFromShots, normalizeStats, buildScorecard, buildAgentBreakdowns
- `packages/core/src/formatter.ts` — review table hazard penalties row
- `packages/core/src/validation.ts` — severity enum validation rule
- `packages/core/src/index.ts` — re-export new types/constants
- `packages/core/tests/builder.test.ts` — new test cases
- `packages/core/tests/validation.test.ts` — new test cases

**Read-only reference:**
- `packages/core/src/handicap.ts` — uses stats.penalties (no change needed, hazard_penalties is separate)
- `packages/core/src/tournament.ts` — uses stats.penalties + stats.hazards_hit (no change needed)

---

## Downstream Impact

- `handicap.ts` tracks `stats.penalties` (manual) for rolling stats — **no change needed**, hazard penalties are a separate field
- `tournament.ts` sums `stats.penalties` — **no change needed**
- `team-handicap.ts` sums `stats.penalties` — **no change needed**
- `formatter.ts` displays `stats.penalties` — **add hazard_penalties row** (S25-3)
- Existing scorecards without severity → all hazards default to `minor` (0) → **scores unchanged**

---

## Verification

1. `pnpm -r build && pnpm -r test && pnpm -r typecheck` — all pass
2. `slope validate` on existing scorecards — all still valid, scores unchanged
3. Build a test scorecard with severity hazards via `buildScorecard()` — score reflects penalties
4. `slope review` on a scorecard with hazard penalties — shows hazard penalties row

```

