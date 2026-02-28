/**
 * SLOPE function registry — discoverable API surface for the search() tool.
 */

export interface FunctionRegistryEntry {
  name: string;
  module: 'core' | 'fs' | 'constants' | 'store' | 'flows';
  description: string;
  signature: string;
  example: string;
}

export const SLOPE_REGISTRY: FunctionRegistryEntry[] = [
  // ─── Handicap ───
  {
    name: 'computePar',
    module: 'core',
    description: 'Maps ticket count to par value (1-2 → 3, 3-4 → 4, 5+ → 5).',
    signature: 'computePar(ticketCount: number): 3 | 4 | 5',
    example: 'return computePar(3); // → 4',
  },
  {
    name: 'computeSlope',
    module: 'core',
    description: 'Calculates slope difficulty modifier from an array of factor names.',
    signature: 'computeSlope(factors: string[]): number',
    example: 'return computeSlope(["cross_package", "new_area"]); // → 2',
  },
  {
    name: 'computeScoreLabel',
    module: 'core',
    description: 'Classifies a score relative to par (eagle, birdie, par, bogey, etc.).',
    signature: 'computeScoreLabel(score: number, par: number): ScoreLabel',
    example: 'return computeScoreLabel(3, 4); // → "birdie"',
  },
  {
    name: 'computeHandicapCard',
    module: 'core',
    description: 'Computes rolling stats across last-5, last-10, and all-time windows.',
    signature: 'computeHandicapCard(scorecards: GolfScorecard[]): HandicapCard',
    example: 'const cards = loadScorecards(); return computeHandicapCard(cards);',
  },

  // ─── Builder ───
  {
    name: 'computeStatsFromShots',
    module: 'core',
    description: 'Derives fairways, GIR, hazards, and miss directions from shot data.',
    signature: 'computeStatsFromShots(shots: ShotRecord[], overrides?: { putts?: number; penalties?: number }): HoleStats',
    example: 'return computeStatsFromShots(scorecard.shots);',
  },
  {
    name: 'buildScorecard',
    module: 'core',
    description: 'Builds a complete GolfScorecard from minimal ScorecardInput, auto-computing stats and score. Supports optional agents field for swarm sprints.',
    signature: 'buildScorecard(input: ScorecardInput): GolfScorecard',
    example: 'return buildScorecard({ sprint_number: 4, theme: "Code Mode", par: 4, slope: 3, date: "2026-02-21", shots: [...] });',
  },
  {
    name: 'buildAgentBreakdowns',
    module: 'core',
    description: 'Builds per-agent scoring breakdowns from swarm session shot data. Each agent gets independent score and stats.',
    signature: 'buildAgentBreakdowns(agents: AgentShotInput[]): AgentBreakdown[]',
    example: 'return buildAgentBreakdowns([{ session_id: "s1", agent_role: "backend", shots: [...] }]);',
  },

  // ─── Validation ───
  {
    name: 'validateScorecard',
    module: 'core',
    description: 'Validates scorecard internal consistency (score labels, stat bounds, shot counts).',
    signature: 'validateScorecard(card: GolfScorecard): ScorecardValidationResult',
    example: 'const cards = loadScorecards(); return validateScorecard(cards[0]);',
  },

  // ─── Dispersion ───
  {
    name: 'computeDispersion',
    module: 'core',
    description: 'Analyzes shot miss patterns by direction with systemic issue detection.',
    signature: 'computeDispersion(scorecards: GolfScorecard[]): DispersionReport',
    example: 'const cards = loadScorecards(); return computeDispersion(cards);',
  },
  {
    name: 'computeAreaPerformance',
    module: 'core',
    description: 'Groups performance metrics by sprint type, club selection, and par value.',
    signature: 'computeAreaPerformance(scorecards: GolfScorecard[]): AreaReport',
    example: 'const cards = loadScorecards(); return computeAreaPerformance(cards);',
  },

  // ─── Advisor ───
  {
    name: 'recommendClub',
    module: 'core',
    description: 'Recommends club complexity for an upcoming ticket based on history and slope factors.',
    signature: 'recommendClub(input: RecommendClubInput): ClubRecommendation',
    example: 'return recommendClub({ ticketComplexity: "medium", scorecards: loadScorecards() });',
  },
  {
    name: 'classifyShot',
    module: 'core',
    description: 'Classifies an execution trace as in_the_hole, green, or a specific miss type.',
    signature: 'classifyShot(trace: ExecutionTrace): ShotClassification',
    example: 'return classifyShot({ planned_scope_paths: ["src/"], modified_files: ["src/index.ts"], test_results: [{ suite: "unit", passed: true, first_run: true }], reverts: 0, elapsed_minutes: 30, hazards_encountered: [] });',
  },
  {
    name: 'generateTrainingPlan',
    module: 'core',
    description: 'Generates training recommendations from handicap trends and dispersion data.',
    signature: 'generateTrainingPlan(input: TrainingPlanInput): TrainingRecommendation[]',
    example: 'const cards = loadScorecards(); return generateTrainingPlan({ handicap: computeHandicapCard(cards), dispersion: computeDispersion(cards), recentScorecards: cards.slice(-3) });',
  },

  // ─── Formatter ───
  {
    name: 'formatSprintReview',
    module: 'core',
    description: 'Formats a scorecard into a markdown sprint review.',
    signature: "formatSprintReview(card: GolfScorecard, projectStats?: ProjectStats, deltas?: ProjectStatsDelta, mode?: 'technical' | 'plain'): string",
    example: 'const cards = loadScorecards(); return formatSprintReview(cards[cards.length - 1]);',
  },
  {
    name: 'formatAdvisorReport',
    module: 'core',
    description: 'Formats club recommendation, training plan, and hazard warnings into markdown.',
    signature: 'formatAdvisorReport(input: AdvisorReportInput): string',
    example: 'return formatAdvisorReport({ clubRecommendation: recommendClub(...), trainingPlan: generateTrainingPlan(...) });',
  },

  // ─── Briefing ───
  {
    name: 'filterCommonIssues',
    module: 'core',
    description: 'Filters common issues by category and/or keyword, returning top 10.',
    signature: 'filterCommonIssues(issues: CommonIssuesFile, filter: BriefingFilter): RecurringPattern[]',
    example: 'const issues = loadCommonIssues(); return filterCommonIssues(issues, { keywords: ["deploy"] });',
  },
  {
    name: 'extractHazardIndex',
    module: 'core',
    description: 'Extracts all hazards from scorecards into a flat searchable index.',
    signature: 'extractHazardIndex(scorecards: GolfScorecard[], keyword?: string): { shot_hazards: HazardEntry[]; bunker_locations: { sprint: number; location: string }[] }',
    example: 'const cards = loadScorecards(); return extractHazardIndex(cards, "deploy");',
  },
  {
    name: 'computeNutritionTrend',
    module: 'core',
    description: 'Computes dev-health nutrition trends across categories.',
    signature: 'computeNutritionTrend(scorecards: GolfScorecard[]): NutritionTrend[]',
    example: 'const cards = loadScorecards(); return computeNutritionTrend(cards);',
  },
  {
    name: 'hazardBriefing',
    module: 'core',
    description: 'Generates hazard warnings for specific areas.',
    signature: 'hazardBriefing(opts: { areas: string[]; scorecards: GolfScorecard[] }): string[]',
    example: 'const cards = loadScorecards(); return hazardBriefing({ areas: ["mcp-tools"], scorecards: cards });',
  },
  {
    name: 'formatBriefing',
    module: 'core',
    description: 'Formats a complete pre-round briefing with handicap, hazards, issues, and training.',
    signature: 'formatBriefing(opts: { scorecards: GolfScorecard[]; commonIssues: CommonIssuesFile; lastSession?: SessionEntry; filter?: BriefingFilter }): string',
    example: 'return formatBriefing({ scorecards: loadScorecards(), commonIssues: loadCommonIssues() });',
  },

  // ─── Roadmap ───
  {
    name: 'validateRoadmap',
    module: 'core',
    description: 'Validates a roadmap definition for structural correctness (cycles, numbering, ticket counts).',
    signature: 'validateRoadmap(roadmap: RoadmapDefinition): RoadmapValidationResult',
    example: 'const roadmap = JSON.parse(readFile("docs/backlog/roadmap.json")); return validateRoadmap(roadmap);',
  },
  {
    name: 'computeCriticalPath',
    module: 'core',
    description: 'Computes the critical path (longest dependency chain) through the roadmap.',
    signature: 'computeCriticalPath(roadmap: RoadmapDefinition): CriticalPathResult',
    example: 'const roadmap = loadRoadmap(); return computeCriticalPath(roadmap);',
  },
  {
    name: 'findParallelOpportunities',
    module: 'core',
    description: 'Finds sprints that can run in parallel (no mutual dependencies).',
    signature: 'findParallelOpportunities(roadmap: RoadmapDefinition): ParallelGroup[]',
    example: 'const roadmap = loadRoadmap(); return findParallelOpportunities(roadmap);',
  },
  {
    name: 'parseRoadmap',
    module: 'core',
    description: 'Parses and validates a roadmap from a JSON object.',
    signature: 'parseRoadmap(json: unknown): { roadmap: RoadmapDefinition | null; validation: RoadmapValidationResult }',
    example: 'return parseRoadmap(JSON.parse(readFile("docs/backlog/roadmap.json")));',
  },
  {
    name: 'formatRoadmapSummary',
    module: 'core',
    description: 'Formats a roadmap summary as markdown (phases, critical path, parallel opportunities).',
    signature: 'formatRoadmapSummary(roadmap: RoadmapDefinition): string',
    example: 'const roadmap = loadRoadmap(); return formatRoadmapSummary(roadmap);',
  },
  {
    name: 'formatStrategicContext',
    module: 'core',
    description: 'Formats concise strategic context for a sprint (3-5 lines for briefings).',
    signature: 'formatStrategicContext(roadmap: RoadmapDefinition, currentSprint: number): string | null',
    example: 'const roadmap = loadRoadmap(); return formatStrategicContext(roadmap, 8);',
  },

  // ─── Registry ───
  {
    name: 'checkConflicts',
    module: 'core',
    description: 'Detects overlapping and adjacent conflicts among sprint claims.',
    signature: 'checkConflicts(claims: SprintClaim[]): SprintConflict[]',
    example: 'return checkConflicts(claims);',
  },

  // ─── Tournament ───
  {
    name: 'buildTournamentReview',
    module: 'core',
    description: 'Aggregates multiple scorecards into an initiative-level tournament review.',
    signature: 'buildTournamentReview(id: string, name: string, scorecards: GolfScorecard[], options?: { takeaways?: string[]; improvements?: string[]; reflection?: string }): TournamentReview',
    example: 'return buildTournamentReview("M-09", "Q1 Initiative", loadScorecards());',
  },
  {
    name: 'formatTournamentReview',
    module: 'core',
    description: 'Formats a tournament review into detailed markdown.',
    signature: 'formatTournamentReview(review: TournamentReview): string',
    example: 'return formatTournamentReview(buildTournamentReview("M-09", "Q1", loadScorecards()));',
  },

  // ─── Roles ───
  {
    name: 'registerRole',
    module: 'core',
    description: 'Registers a custom role definition in the role registry.',
    signature: 'registerRole(role: RoleDefinition): void',
    example: 'registerRole({ id: "qa", name: "QA", description: "Quality assurance", focusAreas: ["tests"], clubPreferences: {}, briefingFilter: { emphasize: ["testing"], deemphasize: [] } });',
  },
  {
    name: 'getRole',
    module: 'core',
    description: 'Returns a registered role by ID. Throws if not found.',
    signature: 'getRole(id: string): RoleDefinition',
    example: 'return getRole("backend");',
  },
  {
    name: 'hasRole',
    module: 'core',
    description: 'Checks if a role ID is registered.',
    signature: 'hasRole(id: string): boolean',
    example: 'return hasRole("frontend"); // → true',
  },
  {
    name: 'listRoles',
    module: 'core',
    description: 'Returns all registered role definitions.',
    signature: 'listRoles(): RoleDefinition[]',
    example: 'return listRoles().map(r => r.id);',
  },

  // ─── Standup (Communication Protocol) ───
  {
    name: 'generateStandup',
    module: 'core',
    description: 'Generate a standup report from session events and claims. Extracts progress, blockers, decisions, and handoffs.',
    signature: 'generateStandup(opts: { sessionId: string; agent_role?: string; events: SlopeEvent[]; claims: SprintClaim[] }): StandupReport',
    example: 'return generateStandup({ sessionId: "sess-1", events: [...], claims: [...] });',
  },
  {
    name: 'formatStandup',
    module: 'core',
    description: 'Formats a standup report as human-readable markdown with status icons [ACTIVE]/[BLOCKED]/[DONE].',
    signature: 'formatStandup(report: StandupReport): string',
    example: 'return formatStandup(generateStandup({ sessionId: "s1", events: [], claims: [] }));',
  },
  {
    name: 'parseStandup',
    module: 'core',
    description: 'Parse a standup report from JSON event data. Used when ingesting another agent standup.',
    signature: 'parseStandup(data: Record<string, unknown>): StandupReport | null',
    example: 'return parseStandup({ sessionId: "s1", status: "working", progress: "Active" });',
  },
  {
    name: 'extractRelevantHandoffs',
    module: 'core',
    description: 'Extract handoffs from a standup that are relevant to a given role. Returns all when no role specified.',
    signature: 'extractRelevantHandoffs(standup: StandupReport, roleId?: string): HandoffEntry[]',
    example: 'return extractRelevantHandoffs(standup, "frontend");',
  },

  // ─── Escalation ───
  {
    name: 'detectEscalation',
    module: 'core',
    description: 'Detects escalation conditions from swarm state: blocker timeouts, claim conflicts, test failure cascades.',
    signature: 'detectEscalation(opts: { config?: EscalationConfig; standups?: StandupReport[]; conflicts?: SprintConflict[]; events?: SlopeEvent[]; now?: number }): EscalationResult[]',
    example: 'return detectEscalation({ standups: [...], conflicts: [...], events: [...] });',
  },
  {
    name: 'buildEscalationEvent',
    module: 'core',
    description: 'Creates a hazard event from an escalation result, suitable for store.insertEvent().',
    signature: 'buildEscalationEvent(escalation: EscalationResult, sessionId: string, sprintNumber?: number): Omit<SlopeEvent, "id" | "timestamp">',
    example: 'const event = buildEscalationEvent(escalation, "sess-1", 15);',
  },
  {
    name: 'resolveEscalationConfig',
    module: 'core',
    description: 'Merges partial escalation config with defaults (blocker_timeout: 15, claim_conflict: true, test_failure_cascade: 10).',
    signature: 'resolveEscalationConfig(config?: EscalationConfig): Required<EscalationConfig>',
    example: 'return resolveEscalationConfig({ blocker_timeout: 30 });',
  },

  // ─── Team Handicap ───
  {
    name: 'computeTeamHandicap',
    module: 'core',
    description: 'Builds a complete team handicap card: overall stats, per-role handicap, swarm efficiency, and role combination analysis.',
    signature: 'computeTeamHandicap(scorecards: GolfScorecard[], coordinationEvents?: number): TeamHandicapCard',
    example: 'return computeTeamHandicap(loadScorecards());',
  },
  {
    name: 'computeRoleHandicap',
    module: 'core',
    description: 'Computes per-role handicap stats from agent breakdowns across sprints.',
    signature: 'computeRoleHandicap(role: string, breakdowns: AgentBreakdown[]): RoleHandicap',
    example: 'return computeRoleHandicap("backend", breakdowns);',
  },
  {
    name: 'computeSwarmEfficiency',
    module: 'core',
    description: 'Computes swarm efficiency: agent counts, score vs par, and efficiency ratio (productive shots / total + coordination overhead).',
    signature: 'computeSwarmEfficiency(scorecards: GolfScorecard[], coordinationEvents?: number): SwarmEfficiency',
    example: 'return computeSwarmEfficiency(loadScorecards(), 5);',
  },
  {
    name: 'analyzeRoleCombinations',
    module: 'core',
    description: 'Analyzes which role combinations produce the best sprint results.',
    signature: 'analyzeRoleCombinations(scorecards: GolfScorecard[]): RoleCombinationStats[]',
    example: 'return analyzeRoleCombinations(loadScorecards());',
  },

  // ─── PR Signals ───
  {
    name: 'parsePRJson',
    module: 'core',
    description: 'Parses raw `gh pr view --json` output into a structured PRSignal object.',
    signature: 'parsePRJson(json: Record<string, unknown>): PRSignal',
    example: 'const raw = JSON.parse(readFile("pr-data.json")); return parsePRJson(raw);',
  },
  {
    name: 'buildGhCommand',
    module: 'core',
    description: 'Builds the `gh pr view --json` CLI command string for a given PR number.',
    signature: 'buildGhCommand(prNumber: number): string',
    example: 'return buildGhCommand(42); // → "gh pr view 42 --json number,additions,..."',
  },
  {
    name: 'mergePRChecksWithCI',
    module: 'core',
    description: 'Merges PR check data with an existing CISignal. Derives CISignal from PR when no CI exists; detects retry scenarios.',
    signature: 'mergePRChecksWithCI(prSignal: PRSignal, existingCI?: CISignal): CISignal',
    example: 'const prSignal = parsePRJson(json); return mergePRChecksWithCI(prSignal, ciSignal);',
  },
  {
    name: 'emptyPRSignal',
    module: 'core',
    description: 'Returns a PRSignal with safe defaults for graceful degradation when PR data is unavailable.',
    signature: 'emptyPRSignal(prNumber?: number): PRSignal',
    example: 'return emptyPRSignal(42);',
  },

  // ─── Plugins ───
  {
    name: 'discoverPlugins',
    module: 'core',
    description: 'Scans .slope/plugins/metaphors/ and .slope/plugins/guards/ for plugin JSON files. Returns discovered plugins with manifest and file path.',
    signature: 'discoverPlugins(cwd: string): DiscoveredPlugin[]',
    example: 'return discoverPlugins(process.cwd());',
  },
  {
    name: 'loadPlugins',
    module: 'core',
    description: 'Discovers, validates, and registers all custom plugins (metaphors + guards). Returns loaded plugins and any errors.',
    signature: 'loadPlugins(cwd: string, config?: PluginsConfig): PluginLoadResult',
    example: 'return loadPlugins(process.cwd());',
  },
  {
    name: 'loadPluginMetaphors',
    module: 'core',
    description: 'Loads and registers custom metaphor plugins from .slope/plugins/metaphors/. Each JSON file is a full MetaphorDefinition.',
    signature: 'loadPluginMetaphors(cwd: string, config?: PluginsConfig): PluginLoadResult',
    example: 'return loadPluginMetaphors(process.cwd());',
  },
  {
    name: 'loadPluginGuards',
    module: 'core',
    description: 'Loads and registers custom guard plugins from .slope/plugins/guards/. Each JSON has name, hookEvent, command, and level.',
    signature: 'loadPluginGuards(cwd: string, config?: PluginsConfig): PluginLoadResult',
    example: 'return loadPluginGuards(process.cwd());',
  },
  {
    name: 'validatePluginManifest',
    module: 'core',
    description: 'Validates a plugin manifest object for required fields (type, id, name).',
    signature: 'validatePluginManifest(raw: unknown): { valid: boolean; errors: string[] }',
    example: 'return validatePluginManifest({ type: "metaphor", id: "custom", name: "Custom" });',
  },
  {
    name: 'isPluginEnabled',
    module: 'core',
    description: 'Checks if a plugin is enabled based on the PluginsConfig disabled/enabled lists.',
    signature: 'isPluginEnabled(id: string, config?: PluginsConfig): boolean',
    example: 'return isPluginEnabled("my-plugin", { disabled: ["other"] });',
  },

  // ─── Player (Multi-Developer) ───
  {
    name: 'extractPlayers',
    module: 'core',
    description: 'Extracts unique sorted player names from scorecards. Undefined player maps to DEFAULT_PLAYER.',
    signature: 'extractPlayers(scorecards: GolfScorecard[]): string[]',
    example: 'return extractPlayers(loadScorecards());',
  },
  {
    name: 'filterScorecardsByPlayer',
    module: 'core',
    description: 'Filters scorecards to those belonging to a specific player.',
    signature: 'filterScorecardsByPlayer(scorecards: GolfScorecard[], player: string): GolfScorecard[]',
    example: 'return filterScorecardsByPlayer(loadScorecards(), "alice");',
  },
  {
    name: 'computePlayerHandicaps',
    module: 'core',
    description: 'Computes independent handicap cards for all players found in scorecards.',
    signature: 'computePlayerHandicaps(scorecards: GolfScorecard[]): PlayerHandicap[]',
    example: 'return computePlayerHandicaps(loadScorecards());',
  },
  {
    name: 'buildLeaderboard',
    module: 'core',
    description: 'Builds a ranked team leaderboard by handicap. Ties get same rank, secondary sort by improvement trend.',
    signature: 'buildLeaderboard(scorecards: GolfScorecard[]): Leaderboard',
    example: 'return buildLeaderboard(loadScorecards());',
  },
  {
    name: 'computeReporterSeverity',
    module: 'core',
    description: 'Computes hazard severity from reporter count: 1→low, 2→medium, 3+→high.',
    signature: "computeReporterSeverity(reporters: string[]): 'low' | 'medium' | 'high'",
    example: 'return computeReporterSeverity(["alice", "bob"]); // → "medium"',
  },
  {
    name: 'mergeHazardIndices',
    module: 'core',
    description: 'Merges new patterns into existing common issues, accumulating reporters and unioning sprints_hit.',
    signature: 'mergeHazardIndices(issues: CommonIssuesFile, newPatterns: RecurringPattern[], reporter: string): CommonIssuesFile',
    example: 'return mergeHazardIndices(loadCommonIssues(), newPatterns, "alice");',
  },

  // ─── Filesystem helpers (injected into sandbox) ───
  {
    name: 'loadConfig',
    module: 'fs',
    description: 'Loads .slope/config.json from the project root, returning SlopeConfig.',
    signature: 'loadConfig(): SlopeConfig',
    example: 'const config = loadConfig();',
  },
  {
    name: 'loadScorecards',
    module: 'fs',
    description: 'Loads all sprint scorecards from the configured scorecardDir.',
    signature: 'loadScorecards(): GolfScorecard[]',
    example: 'const cards = loadScorecards();',
  },
  {
    name: 'loadCommonIssues',
    module: 'fs',
    description: 'Loads the common-issues.json file from the configured path.',
    signature: 'loadCommonIssues(): CommonIssuesFile',
    example: 'const issues = loadCommonIssues();',
  },
  {
    name: 'loadSessions',
    module: 'fs',
    description: 'Loads the sessions.json file from the configured path.',
    signature: 'loadSessions(): SessionEntry[]',
    example: 'const sessions = loadSessions();',
  },
  {
    name: 'saveScorecard',
    module: 'fs',
    description: 'Writes a scorecard to {scorecardDir}/sprint-{N}.json.',
    signature: 'saveScorecard(card: GolfScorecard): string',
    example: 'const path = saveScorecard(buildScorecard({ ... }));',
  },
  {
    name: 'loadRoadmap',
    module: 'fs',
    description: 'Loads and parses the roadmap JSON from the configured path (default: docs/backlog/roadmap.json). Returns null if no roadmap file exists.',
    signature: 'loadRoadmap(): RoadmapDefinition | null',
    example: 'const roadmap = loadRoadmap(); if (roadmap) return formatRoadmapSummary(roadmap);',
  },
  {
    name: 'readFile',
    module: 'fs',
    description: 'Reads a file as UTF-8 text (path scoped to project root).',
    signature: 'readFile(path: string): string',
    example: 'return readFile("package.json");',
  },
  {
    name: 'writeFile',
    module: 'fs',
    description: 'Writes a string to a file (path scoped to project root).',
    signature: 'writeFile(path: string, content: string): void',
    example: 'writeFile("output.json", JSON.stringify(data, null, 2));',
  },
  {
    name: 'listFiles',
    module: 'fs',
    description: 'Lists files in a directory with optional glob pattern (scoped to project root).',
    signature: 'listFiles(dir?: string, pattern?: string): string[]',
    example: 'return listFiles("docs/retros", "sprint-*.json");',
  },

  // ─── Flows ───
  {
    name: 'parseFlows',
    module: 'flows',
    description: 'Parse and validate a flows JSON string into a FlowsFile object.',
    signature: 'parseFlows(json: string): FlowsFile',
    example: 'return parseFlows(readFile(".slope/flows.json"));',
  },
  {
    name: 'validateFlows',
    module: 'flows',
    description: 'Validate flows against the filesystem — check file paths resolve, detect orphaned paths and duplicates.',
    signature: 'validateFlows(flows: FlowsFile, cwd: string): { errors: string[], warnings: string[] }',
    example: 'const flows = parseFlows(readFile(".slope/flows.json")); return validateFlows(flows, process.cwd());',
  },
  {
    name: 'checkFlowStaleness',
    module: 'flows',
    description: 'Check if files in a flow have changed since last_verified_sha. Returns stale boolean and list of changed files.',
    signature: 'checkFlowStaleness(flow: FlowDefinition, currentSha: string, cwd: string): { stale: boolean, changedFiles: string[] }',
    example: 'return checkFlowStaleness(flow, "abc123", process.cwd());',
  },
  {
    name: 'loadFlows',
    module: 'flows',
    description: 'Load and parse flows from a file path. Returns null if file does not exist.',
    signature: 'loadFlows(flowsPath: string): FlowsFile | null',
    example: 'return loadFlows(".slope/flows.json");',
  },

  // ─── Constants ───
  {
    name: 'PAR_THRESHOLDS',
    module: 'constants',
    description: 'Maps ticket count ranges to par values: { 3: [1,2], 4: [3,4], 5: [5,Infinity] }.',
    signature: 'const PAR_THRESHOLDS: Record<number, [number, number]>',
    example: 'return PAR_THRESHOLDS;',
  },
  {
    name: 'SLOPE_FACTORS',
    module: 'constants',
    description: 'Factor names that increase sprint slope: cross_package, schema_migration, new_area, external_dep, concurrent_agents.',
    signature: "const SLOPE_FACTORS: readonly ['cross_package', 'schema_migration', 'new_area', 'external_dep', 'concurrent_agents']",
    example: 'return SLOPE_FACTORS;',
  },
  {
    name: 'SCORE_LABELS',
    module: 'constants',
    description: 'Maps score-minus-par to label: { -2: eagle, -1: birdie, 0: par, 1: bogey, 2: double_bogey }.',
    signature: 'const SCORE_LABELS: Record<number, ScoreLabel>',
    example: 'return SCORE_LABELS;',
  },
  {
    name: 'TRAINING_TYPE_MAP',
    module: 'constants',
    description: 'Maps sprint types to training types (research → driving_range, etc.).',
    signature: 'const TRAINING_TYPE_MAP: Partial<Record<SprintType, TrainingType>>',
    example: 'return TRAINING_TYPE_MAP;',
  },
  {
    name: 'NUTRITION_CHECKLIST',
    module: 'constants',
    description: 'Default nutrition categories to assess: hydration, diet, recovery, supplements, stretching.',
    signature: 'const NUTRITION_CHECKLIST: NutritionCategory[]',
    example: 'return NUTRITION_CHECKLIST;',
  },

  // ─── Store (MCP tools) ───
  {
    name: 'session_status',
    module: 'store',
    description: 'MCP tool: Returns active sessions and claims from the SlopeStore.',
    signature: 'session_status(): { sessions: SlopeSession[]; claims: SprintClaim[] }',
    example: '// Called via MCP tool, not directly',
  },
  {
    name: 'acquire_claim',
    module: 'store',
    description: 'MCP tool: Claims a ticket or area for the current sprint via SlopeStore.',
    signature: 'acquire_claim(sessionId: string, target: string, scope: ClaimScope, sprintNumber: number, player: string): SprintClaim',
    example: '// Called via MCP tool, not directly',
  },
  {
    name: 'check_conflicts',
    module: 'store',
    description: 'MCP tool: Detects overlapping and adjacent conflicts among active claims.',
    signature: 'check_conflicts(sprintNumber?: number): { claims: number; conflicts: SprintConflict[] }',
    example: '// Called via MCP tool, not directly',
  },
  {
    name: 'store_status',
    module: 'store',
    description: 'MCP tool: Check store health — schema version, row counts, and error status.',
    signature: 'store_status(): StoreHealthResult',
    example: '// Called via MCP tool, not directly',
  },

  // ─── Transcript ───
  {
    name: 'readTranscript',
    module: 'core',
    description: 'Read all turns from a session transcript JSONL file. Assigns turn_number from line index (1-indexed).',
    signature: 'readTranscript(transcriptsDir: string, sessionId: string): TranscriptTurn[]',
    example: 'return readTranscript(".slope/transcripts", "sess-abc-123");',
  },
  {
    name: 'listTranscripts',
    module: 'core',
    description: 'List session IDs that have transcripts, sorted by modification time (newest first).',
    signature: 'listTranscripts(transcriptsDir: string): string[]',
    example: 'return listTranscripts(".slope/transcripts");',
  },

  // ─── Review (Implementation Review Integration) ───
  {
    name: 'recommendReviews',
    module: 'core',
    description: 'Recommend which review types to run based on sprint characteristics (ticket count, slope, file patterns).',
    signature: 'recommendReviews(input: RecommendReviewsInput): ReviewRecommendation[]',
    example: 'return recommendReviews({ ticketCount: 4, slope: 2, filePatterns: ["src/core/review.ts"] });',
  },
  {
    name: 'findingToHazard',
    module: 'core',
    description: 'Convert a ReviewFinding into a HazardHit using the review type → hazard type mapping.',
    signature: 'findingToHazard(finding: ReviewFinding): HazardHit',
    example: 'return findingToHazard({ review_type: "architect", ticket_key: "S33-1", severity: "moderate", description: "issue", resolved: true });',
  },
  {
    name: 'amendScorecardWithFindings',
    module: 'core',
    description: 'Amend a scorecard by injecting review findings as hazards and recomputing score. Idempotent.',
    signature: 'amendScorecardWithFindings(scorecard: GolfScorecard, findings: ReviewFinding[]): AmendResult',
    example: 'const scorecard = loadScorecards()[0]; return amendScorecardWithFindings(scorecard, findings);',
  },

  // ─── Analyzers ───
  {
    name: 'runAnalyzers',
    module: 'core',
    description: 'Runs repo profile analyzers (stack, structure, git, testing) and returns a RepoProfile.',
    signature: 'runAnalyzers(opts?: { cwd?: string; analyzers?: AnalyzerName[] }): Promise<RepoProfile>',
    example: 'return await runAnalyzers({ analyzers: ["stack", "git"] });',
  },
  {
    name: 'loadRepoProfile',
    module: 'core',
    description: 'Loads cached RepoProfile from .slope/repo-profile.json.',
    signature: 'loadRepoProfile(cwd?: string): RepoProfile | null',
    example: 'return loadRepoProfile();',
  },
  {
    name: 'saveRepoProfile',
    module: 'core',
    description: 'Saves a RepoProfile to .slope/repo-profile.json.',
    signature: 'saveRepoProfile(profile: RepoProfile, cwd?: string): void',
    example: 'const p = await runAnalyzers(); saveRepoProfile(p); return "saved";',
  },

  // ─── Complexity ───
  {
    name: 'estimateComplexity',
    module: 'core',
    description: 'Estimates par, slope, risk areas, and bus factor from a RepoProfile.',
    signature: 'estimateComplexity(profile: RepoProfile): ComplexityProfile',
    example: 'const p = loadRepoProfile(); return p ? estimateComplexity(p) : "no profile";',
  },

  // ─── Backlog ───
  {
    name: 'analyzeBacklog',
    module: 'core',
    description: 'Scans source files for TODO/FIXME/HACK/XXX comments and parses CHANGELOG unreleased section.',
    signature: 'analyzeBacklog(cwd: string): Promise<BacklogAnalysis>',
    example: 'return await analyzeBacklog(".");',
  },
  {
    name: 'analyzeGitHubBacklog',
    module: 'core',
    description: 'Fetches open GitHub issues and milestones, groups by label/milestone, detects high-priority items.',
    signature: 'analyzeGitHubBacklog(owner: string, repo: string, client: GitHubClient): Promise<GitHubBacklogAnalysis>',
    example: 'const c = createGitHubClient(); return await analyzeGitHubBacklog("owner", "repo", c);',
  },
  {
    name: 'mergeBacklogs',
    module: 'core',
    description: 'Combines local TODO/FIXME backlog with optional remote GitHub issue data into a unified MergedBacklog.',
    signature: 'mergeBacklogs(local: BacklogAnalysis, remote?: GitHubBacklogAnalysis): MergedBacklog',
    example: 'const local = await analyzeBacklog("."); return mergeBacklogs(local);',
  },

  // ─── Generators ───
  {
    name: 'generateConfig',
    module: 'core',
    description: 'Generates a SLOPE config (project name, cadence, team, stack) from a RepoProfile.',
    signature: 'generateConfig(profile: RepoProfile): GeneratedConfig',
    example: 'const p = loadRepoProfile(); return p ? generateConfig(p) : "no profile";',
  },
  {
    name: 'generateFirstSprint',
    module: 'core',
    description: 'Generates a starter roadmap and first sprint from repo analysis, complexity, and backlog data.',
    signature: 'generateFirstSprint(profile: RepoProfile, complexity: ComplexityProfile, backlog?: BacklogAnalysis): GeneratedSprint',
    example: 'const p = loadRepoProfile(); const c = estimateComplexity(p); return generateFirstSprint(p, c);',
  },
  {
    name: 'generateCommonIssues',
    module: 'core',
    description: 'Seeds common-issues.json from HACK/FIXME clusters and structural warnings.',
    signature: 'generateCommonIssues(profile: RepoProfile, backlog: BacklogAnalysis): CommonIssuesFile',
    example: 'const p = loadRepoProfile(); const b = await analyzeBacklog("."); return generateCommonIssues(p, b);',
  },
  {
    name: 'generateRoadmap',
    module: 'core',
    description: 'Generates a RoadmapDefinition from repo profile, complexity, and merged backlog. Falls back: milestones → labels → local TODOs.',
    signature: 'generateRoadmap(profile: RepoProfile, complexity: ComplexityProfile, backlog: MergedBacklog): RoadmapDefinition',
    example: 'const p = loadRepoProfile(); const c = estimateComplexity(p); const b = mergeBacklogs(await analyzeBacklog(".")); return generateRoadmap(p, c, b);',
  },

  // ─── Vision ───
  {
    name: 'loadVision',
    module: 'core',
    description: 'Loads the VisionDocument from .slope/vision.json.',
    signature: 'loadVision(cwd?: string): VisionDocument | null',
    example: 'return loadVision();',
  },
  {
    name: 'saveVision',
    module: 'core',
    description: 'Saves a VisionDocument to .slope/vision.json.',
    signature: 'saveVision(vision: VisionDocument, cwd?: string): void',
    example: 'saveVision({ purpose: "Build X", priorities: ["speed"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); return "saved";',
  },
  {
    name: 'validateVision',
    module: 'core',
    description: 'Validates a VisionDocument, returning an array of error strings.',
    signature: 'validateVision(vision: unknown): string[]',
    example: 'return validateVision({ purpose: "", priorities: [] });',
  },

  // ─── Custom Metaphor ───
  {
    name: 'saveCustomMetaphor',
    module: 'core',
    description: 'Validate, save, register, and optionally activate a custom metaphor.',
    signature: 'saveCustomMetaphor(definition: MetaphorDefinition, setActive?: boolean): SaveMetaphorResult',
    example: 'return saveCustomMetaphor({ id: "cooking", name: "Cooking", description: "Meals, courses, ingredients", vocabulary: { sprint: "meal", ticket: "course", scorecard: "menu", handicapCard: "nutrition label", briefing: "mise en place", perfectScore: "Michelin star", onTarget: "well done", review: "tasting notes" }, clubs: { driver: "Flambé", long_iron: "Braise", short_iron: "Sauté", wedge: "Dice", putter: "Garnish" }, shotResults: { fairway: "Prep", green: "Plated", in_the_hole: "Chef Kiss", missed_long: "Overcooked", missed_short: "Raw", missed_left: "Burnt", missed_right: "Bland" }, hazards: { bunker: "Grease Fire", water: "Boil Over", ob: "Food Poisoning", rough: "Soggy", trees: "Wrong Ingredient" }, conditions: { wind: "Rush Hour", rain: "Power Outage", frost_delay: "Cold Kitchen", altitude: "Altitude Baking", pin_position: "Picky Eater" }, specialPlays: { gimme: "Shortcut", mulligan: "Do Over", provisional: "Plan B", lay_up: "Slow Cook", scramble: "Potluck" }, missDirections: { long: "Over-seasoned", short: "Under-seasoned", left: "Wrong recipe", right: "Substituted" }, scoreLabels: { eagle: "Michelin 2-Star", birdie: "Michelin 1-Star", par: "Solid Meal", bogey: "Leftovers", double_bogey: "Takeout", triple_plus: "Dumpster Fire" }, sprintTypes: { feature: "New Dish", feedback: "Tasting Menu", infra: "Kitchen Remodel", bugfix: "Fix Recipe", research: "R&D", flow: "Catering", "test-coverage": "Quality Control", audit: "Health Inspection" }, trainingTypes: { driving_range: "Knife Skills", chipping_practice: "Plating Practice", putting_practice: "Seasoning Drills", lessons: "Cooking Class" }, nutrition: { hydration: "Water", diet: "Ingredients", recovery: "Break", supplements: "Spices", stretching: "Warm-up" } }, true);',
  },
  {
    name: 'METAPHOR_SCHEMA',
    module: 'constants',
    description: 'Schema showing all required keys for each MetaphorDefinition category. Use search({ module: "metaphor" }) for full details.',
    signature: 'METAPHOR_SCHEMA: { vocabulary: string[], clubs: string[], shotResults: string[], hazards: string[], conditions: string[], specialPlays: string[], missDirections: string[], scoreLabels: string[], sprintTypes: string[], trainingTypes: string[], nutrition: string[] }',
    example: 'return METAPHOR_SCHEMA;',
  },
  {
    name: 'saveConfig',
    module: 'fs',
    description: 'Write a complete SlopeConfig to .slope/config.json. Use loadConfig() first for read-modify-write.',
    signature: 'saveConfig(config: SlopeConfig): string',
    example: 'const config = loadConfig(); config.metaphor = "gaming"; return saveConfig(config);',
  },
];

/**
 * Key TypeScript type definitions for agent reference.
 * Agents call search({ module: 'types' }) to retrieve this.
 */
export const SLOPE_TYPES = `\
// ─── Core Scoring Enums ───
type ClubSelection = 'driver' | 'long_iron' | 'short_iron' | 'wedge' | 'putter';
type ShotResult = 'fairway' | 'green' | 'in_the_hole' | 'missed_long' | 'missed_short' | 'missed_left' | 'missed_right';
type HazardType = 'bunker' | 'water' | 'ob' | 'rough' | 'trees';
type ConditionType = 'wind' | 'rain' | 'frost_delay' | 'altitude' | 'pin_position';
type SpecialPlay = 'gimme' | 'mulligan' | 'provisional' | 'lay_up' | 'scramble';
type MissDirection = 'long' | 'short' | 'left' | 'right';
type ScoreLabel = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double_bogey' | 'triple_plus';
type SprintType = 'feature' | 'feedback' | 'infra' | 'bugfix' | 'research' | 'flow' | 'test-coverage' | 'audit';

// ─── Record Types ───
interface HazardHit { type: HazardType; description: string; gotcha_id?: string; }
interface ShotRecord { ticket_key: string; title: string; club: ClubSelection; result: ShotResult; hazards: HazardHit[]; provisional_declared?: boolean; notes?: string; }
interface ConditionRecord { type: ConditionType; description: string; impact: 'none' | 'minor' | 'major'; }

// ─── Scoring Types ───
interface HoleStats { fairways_hit: number; fairways_total: number; greens_in_regulation: number; greens_total: number; putts: number; penalties: number; hazards_hit: number; hazard_penalties: number; miss_directions: Record<MissDirection, number>; }
interface HoleScore { sprint_number: number; theme: string; par: 3 | 4 | 5; slope: number; score: number; score_label: ScoreLabel; shots: ShotRecord[]; conditions: ConditionRecord[]; special_plays: SpecialPlay[]; stats: HoleStats; }

// ─── Full Scorecard ───
interface GolfScorecard extends HoleScore { type?: SprintType; player?: string; date: string; training?: TrainingSession[]; nutrition?: NutritionEntry[]; yardage_book_updates: string[]; bunker_locations: string[]; course_management_notes: string[]; nineteenth_hole?: NineteenthHole; }

// ─── Handicap ───
interface RollingStats { handicap: number; fairway_pct: number; gir_pct: number; avg_putts: number; penalties_per_round: number; miss_pattern: Record<MissDirection, number>; mulligans: number; gimmes: number; }
interface HandicapCard { last_5: RollingStats; last_10: RollingStats; all_time: RollingStats; }

// ─── Dispersion ───
interface DispersionReport { total_shots: number; total_misses: number; miss_rate_pct: number; by_direction: Record<MissDirection, { count: number; pct: number; interpretation: string }>; dominant_miss: MissDirection | null; systemic_issues: string[]; }
interface AreaReport { by_sprint_type: Record<string, { count: number; avg_score_vs_par: number; fairway_pct: number; gir_pct: number }>; by_club: Record<string, { count: number; in_the_hole_rate: number; miss_rate: number }>; par_performance: Record<number, { count: number; avg_score_vs_par: number; over_par_rate: number }>; }

// ─── Config & Loader ───
interface SlopeConfig { scorecardDir: string; scorecardPattern: string; minSprint: number; commonIssuesPath: string; sessionsPath: string; registry: 'file' | 'api'; claimsPath: string; registryApiUrl?: string; currentSprint?: number; store?: string; store_path?: string; }

// ─── Store ───
interface SlopeSession { session_id: string; role: 'primary' | 'secondary' | 'observer'; ide: string; worktree_path?: string; branch?: string; started_at: string; last_heartbeat_at: string; metadata?: Record<string, unknown>; agent_role?: string; swarm_id?: string; }
interface SprintClaim { id: string; sprint_number: number; player: string; target: string; scope: ClaimScope; claimed_at: string; notes?: string; session_id?: string; expires_at?: string; metadata?: Record<string, unknown>; }

// ─── Standup ───
interface StandupReport { sessionId: string; agent_role?: string; ticketKey?: string; status: 'working' | 'blocked' | 'complete'; progress: string; blockers: string[]; decisions: string[]; handoffs: HandoffEntry[]; timestamp: string; }
interface HandoffEntry { target: string; description: string; for_role?: string; }

// ─── Roles ───
interface RoleDefinition { id: string; name: string; description: string; focusAreas: string[]; clubPreferences: Partial<Record<string, ClubSelection>>; briefingFilter: { emphasize: string[]; deemphasize: string[] }; }

// ─── Builder Input ───
interface AgentBreakdown { session_id: string; agent_role: string; shots: ShotRecord[]; score: number; stats: HoleStats; }
interface AgentShotInput { session_id: string; agent_role: string; shots: ShotRecord[]; }
interface ScorecardInput { sprint_number: number; theme: string; par: 3 | 4 | 5; slope: number; date: string; shots: ShotRecord[]; putts?: number; penalties?: number; type?: SprintType; conditions?: ConditionRecord[]; special_plays?: SpecialPlay[]; training?: TrainingSession[]; nutrition?: NutritionEntry[]; nineteenth_hole?: NineteenthHole; bunker_locations?: string[]; yardage_book_updates?: string[]; course_management_notes?: string[]; agents?: AgentBreakdown[]; }

// ─── Escalation ───
type EscalationTrigger = 'blocker_timeout' | 'claim_conflict' | 'test_failure_cascade' | 'manual';
type EscalationSeverity = 'warning' | 'critical';
type EscalationAction = 'log_event' | 'mark_blocked' | 'notify_standup';
interface EscalationConfig { blocker_timeout?: number; claim_conflict?: boolean; test_failure_cascade?: number; actions?: EscalationAction[]; }
interface EscalationResult { trigger: EscalationTrigger; severity: EscalationSeverity; description: string; session_id?: string; agent_role?: string; actions: EscalationAction[]; }

// ─── Team Handicap ───
interface RoleHandicap { role: string; sprints_participated: number; total_shots: number; stats: RollingStats; }
interface SwarmEfficiency { total_sprints: number; total_agents: number; avg_agents_per_sprint: number; total_shots: number; total_score: number; avg_score_vs_par: number; coordination_events: number; efficiency_ratio: number; }
interface RoleCombinationStats { roles: string[]; sprint_count: number; avg_score_vs_par: number; total_hazards: number; }
interface TeamHandicapCard { overall: RollingStats; by_role: RoleHandicap[]; swarm_efficiency: SwarmEfficiency; role_combinations: RoleCombinationStats[]; }

// ─── PR Signals ───
type PRPlatform = 'github' | 'gitlab' | 'bitbucket' | 'unknown';
type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'COMMENTED' | 'NONE';
interface PRSignal { platform: PRPlatform; pr_number: number; review_cycles: number; change_request_count: number; time_to_merge_minutes: number | null; ci_checks_passed: number; ci_checks_failed: number; file_count: number; additions: number; deletions: number; comment_count: number; review_decision: PRReviewDecision; }

// ─── Advisor ───
interface ExecutionTrace { planned_scope_paths: string[]; modified_files: string[]; test_results: { suite: string; passed: boolean; first_run: boolean }[]; reverts: number; elapsed_minutes: number; hazards_encountered: HazardHit[]; }
interface ShotClassification { result: ShotResult; miss_direction: MissDirection | null; confidence: number; reasoning: string; }
interface CombinedSignals { trace: ExecutionTrace; ci?: CISignal; pr?: PRSignal; events?: SlopeEvent[]; }
interface ClubRecommendation { club: ClubSelection; confidence: number; reasoning: string; provisional_suggestion?: string; }
interface TrainingRecommendation { area: string; type: TrainingType; description: string; priority: 'high' | 'medium' | 'low'; instruction_adjustment?: string; }
interface RecommendClubInput { ticketComplexity: 'trivial' | 'small' | 'medium' | 'large'; scorecards: GolfScorecard[]; slopeFactors?: string[]; }
interface TrainingPlanInput { handicap: HandicapCard; dispersion: DispersionReport; recentScorecards: GolfScorecard[]; }

// ─── Roadmap ───
type RoadmapClub = 'driver' | 'long_iron' | 'short_iron' | 'wedge' | 'putter';
interface RoadmapTicket { key: string; title: string; club: RoadmapClub; complexity: 'trivial' | 'small' | 'standard' | 'moderate'; depends_on?: string[]; }
interface RoadmapSprint { id: number; theme: string; par: 3 | 4 | 5; slope: number; type: string; tickets: RoadmapTicket[]; depends_on?: number[]; }
interface RoadmapPhase { name: string; sprints: number[]; }
interface RoadmapDefinition { name: string; description?: string; phases: RoadmapPhase[]; sprints: RoadmapSprint[]; }
interface RoadmapValidationResult { valid: boolean; errors: RoadmapValidationError[]; warnings: RoadmapValidationWarning[]; }
interface RoadmapValidationError { type: 'error'; sprint?: number; ticket?: string; message: string; }
interface RoadmapValidationWarning { type: 'warning'; sprint?: number; ticket?: string; message: string; }
interface CriticalPathResult { path: number[]; length: number; totalPar: number; }
interface ParallelGroup { sprints: number[]; reason: string; }

// ─── Player (Multi-Developer) ───
interface PlayerHandicap { player: string; scorecardCount: number; handicapCard: HandicapCard; }
interface LeaderboardEntry { rank: number; player: string; handicap: number; scorecardCount: number; improvementTrend: number; fairwayPct: number; girPct: number; }
interface Leaderboard { entries: LeaderboardEntry[]; generatedAt: string; }

// ─── Flows ───
interface FlowStep { name: string; description: string; file_paths: string[]; notes?: string; }
interface FlowDefinition { id: string; title: string; description: string; entry_point: string; steps: FlowStep[]; files: string[]; tags: string[]; last_verified_sha: string; last_verified_at: string; }
interface FlowsFile { version: '1'; last_generated: string; flows: FlowDefinition[]; }

// ─── Briefing ───
interface RecurringPattern { id: number; title: string; category: string; sprints_hit: number[]; gotcha_refs: string[]; description: string; prevention: string; reported_by?: string[]; }
interface CommonIssuesFile { recurring_patterns: RecurringPattern[]; }
interface SessionEntry { id: number; date: string; sprint: string; summary: string; where_left_off: string; }
interface BriefingFilter { categories?: string[]; keywords?: string[]; }

// ─── Tournament ───
interface TournamentReview { id: string; name: string; dateRange: { start: string; end: string }; sprints: TournamentSprintEntry[]; scoring: TournamentScoring; stats: TournamentStats; hazardIndex: TournamentHazard[]; clubPerformance: Record<string, { attempts: number; inTheHole: number; avgScore: number }>; takeaways: string[]; improvements: string[]; reflection?: string; }
interface TournamentSprintEntry { sprintNumber: number; theme: string; par: number; slope: number; score: number; scoreLabel: ScoreLabel; ticketCount: number; ticketsLanded: number; }
interface TournamentScoring { totalPar: number; totalScore: number; differential: number; avgScoreLabel: string; bestSprint: { sprintNumber: number; label: ScoreLabel }; worstSprint: { sprintNumber: number; label: ScoreLabel }; sprintCount: number; ticketCount: number; ticketsLanded: number; landingRate: number; }

// ─── Analyzers ───
type AnalyzerName = 'stack' | 'structure' | 'git' | 'testing' | 'ci' | 'docs';
interface StackProfile { primaryLanguage: string; languages: Record<string, number>; frameworks: string[]; packageManager?: string; runtime?: string; buildTool?: string; }
interface StructureProfile { totalFiles: number; sourceFiles: number; testFiles: number; maxDepth: number; isMonorepo: boolean; modules: Array<{ name: string; path: string; fileCount: number }>; largeFiles: Array<{ path: string; lines: number }>; }
interface GitProfile { totalCommits: number; commitsLast90d: number; commitsPerWeek: number; contributors: Array<{ name: string; email: string; commits: number }>; activeBranches: string[]; lastRelease?: { tag: string; date: string }; inferredCadence: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'sporadic'; }
interface TestProfile { framework?: string; testFileCount: number; hasTestScript: boolean; hasCoverage: boolean; testDirs: string[]; }
interface CIProfile { system?: 'github-actions' | 'circleci' | 'gitlab-ci' | 'jenkins' | 'travis'; configFiles: string[]; hasTestStage: boolean; hasBuildStage: boolean; hasDeployStage: boolean; }
interface DocsProfile { hasReadme: boolean; readmeSummary?: string; hasContributing: boolean; hasChangelog: boolean; hasAdr: boolean; hasApiDocs: boolean; }
interface RepoProfile { analyzedAt: string; analyzersRun: AnalyzerName[]; stack: StackProfile; structure: StructureProfile; git: GitProfile; testing: TestProfile; ci: CIProfile; docs: DocsProfile; }

// ─── Complexity ───
interface ComplexityProfile { estimatedPar: 3 | 4 | 5; estimatedSlope: number; slopeFactors: string[]; riskAreas: Array<{ module: string; reason: string }>; busFactor: Array<{ module: string; topContributor: string; pct: number }>; }

// ─── Backlog ───
interface TodoEntry { type: 'TODO' | 'FIXME' | 'HACK' | 'XXX'; text: string; file: string; line: number; }
interface BacklogAnalysis { todos: TodoEntry[]; todosByModule: Record<string, TodoEntry[]>; changelogUnreleased?: string[]; }

// ─── GitHub Backlog ───
interface GitHubIssue { number: number; title: string; state: 'open' | 'closed'; labels: string[]; milestone?: { number: number; title: string }; body?: string; createdAt: string; }
interface GitHubMilestone { number: number; title: string; description?: string; state: 'open' | 'closed'; openIssues: number; closedIssues: number; dueOn?: string; }
interface GitHubBacklogAnalysis { issues: GitHubIssue[]; issuesByLabel: Record<string, GitHubIssue[]>; issuesByMilestone: Record<string, GitHubIssue[]>; highPriority: GitHubIssue[]; milestones: GitHubMilestone[]; }
interface MergedBacklog { local: BacklogAnalysis; remote?: GitHubBacklogAnalysis; totalItems: number; }

// ─── Generators ───
interface GeneratedConfig { projectName: string; metaphor: string; techStack: string[]; sprintCadence: 'weekly' | 'biweekly' | 'monthly'; team: Record<string, string>; }
interface GeneratedSprint { roadmap: RoadmapDefinition; sprint: RoadmapSprint; }

// ─── Vision ───
interface VisionDocument { purpose: string; audience?: string; priorities: string[]; techDirection?: string; nonGoals?: string[]; createdAt: string; updatedAt: string; }
`;
