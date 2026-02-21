/**
 * SLOPE function registry — discoverable API surface for the search() tool.
 */

export interface FunctionRegistryEntry {
  name: string;
  module: 'core' | 'fs' | 'constants';
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
    description: 'Builds a complete GolfScorecard from minimal ScorecardInput, auto-computing stats and score.',
    signature: 'buildScorecard(input: ScorecardInput): GolfScorecard',
    example: 'return buildScorecard({ sprint_number: 4, theme: "Code Mode", par: 4, slope: 3, date: "2026-02-21", shots: [...] });',
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
type SprintType = 'feature' | 'feedback' | 'infra' | 'bugfix' | 'research' | 'flow' | 'test-coverage';

// ─── Record Types ───
interface HazardHit { type: HazardType; description: string; gotcha_id?: string; }
interface ShotRecord { ticket_key: string; title: string; club: ClubSelection; result: ShotResult; hazards: HazardHit[]; provisional_declared?: boolean; notes?: string; }
interface ConditionRecord { type: ConditionType; description: string; impact: 'none' | 'minor' | 'major'; }

// ─── Scoring Types ───
interface HoleStats { fairways_hit: number; fairways_total: number; greens_in_regulation: number; greens_total: number; putts: number; penalties: number; hazards_hit: number; miss_directions: Record<MissDirection, number>; }
interface HoleScore { sprint_number: number; theme: string; par: 3 | 4 | 5; slope: number; score: number; score_label: ScoreLabel; shots: ShotRecord[]; conditions: ConditionRecord[]; special_plays: SpecialPlay[]; stats: HoleStats; }

// ─── Full Scorecard ───
interface GolfScorecard extends HoleScore { type?: SprintType; date: string; training?: TrainingSession[]; nutrition?: NutritionEntry[]; yardage_book_updates: string[]; bunker_locations: string[]; course_management_notes: string[]; nineteenth_hole?: NineteenthHole; }

// ─── Handicap ───
interface RollingStats { handicap: number; fairway_pct: number; gir_pct: number; avg_putts: number; penalties_per_round: number; miss_pattern: Record<MissDirection, number>; mulligans: number; gimmes: number; }
interface HandicapCard { last_5: RollingStats; last_10: RollingStats; all_time: RollingStats; }

// ─── Dispersion ───
interface DispersionReport { total_shots: number; total_misses: number; miss_rate_pct: number; by_direction: Record<MissDirection, { count: number; pct: number; interpretation: string }>; dominant_miss: MissDirection | null; systemic_issues: string[]; }
interface AreaReport { by_sprint_type: Record<string, { count: number; avg_score_vs_par: number; fairway_pct: number; gir_pct: number }>; by_club: Record<string, { count: number; in_the_hole_rate: number; miss_rate: number }>; par_performance: Record<number, { count: number; avg_score_vs_par: number; over_par_rate: number }>; }

// ─── Config & Loader ───
interface SlopeConfig { scorecardDir: string; scorecardPattern: string; minSprint: number; commonIssuesPath: string; sessionsPath: string; registry: 'file' | 'api'; claimsPath: string; registryApiUrl?: string; currentSprint?: number; }

// ─── Builder Input ───
interface ScorecardInput { sprint_number: number; theme: string; par: 3 | 4 | 5; slope: number; date: string; shots: ShotRecord[]; putts?: number; penalties?: number; type?: SprintType; conditions?: ConditionRecord[]; special_plays?: SpecialPlay[]; training?: TrainingSession[]; nutrition?: NutritionEntry[]; nineteenth_hole?: NineteenthHole; bunker_locations?: string[]; yardage_book_updates?: string[]; course_management_notes?: string[]; }

// ─── Advisor ───
interface ExecutionTrace { planned_scope_paths: string[]; modified_files: string[]; test_results: { suite: string; passed: boolean; first_run: boolean }[]; reverts: number; elapsed_minutes: number; hazards_encountered: HazardHit[]; }
interface ShotClassification { result: ShotResult; miss_direction: MissDirection | null; confidence: number; reasoning: string; }
interface ClubRecommendation { club: ClubSelection; confidence: number; reasoning: string; provisional_suggestion?: string; }
interface TrainingRecommendation { area: string; type: TrainingType; description: string; priority: 'high' | 'medium' | 'low'; instruction_adjustment?: string; }
interface RecommendClubInput { ticketComplexity: 'trivial' | 'small' | 'medium' | 'large'; scorecards: GolfScorecard[]; slopeFactors?: string[]; }
interface TrainingPlanInput { handicap: HandicapCard; dispersion: DispersionReport; recentScorecards: GolfScorecard[]; }

// ─── Briefing ───
interface RecurringPattern { id: number; title: string; category: string; sprints_hit: number[]; gotcha_refs: string[]; description: string; prevention: string; }
interface CommonIssuesFile { recurring_patterns: RecurringPattern[]; }
interface SessionEntry { id: number; date: string; sprint: string; summary: string; where_left_off: string; }
interface BriefingFilter { categories?: string[]; keywords?: string[]; }

// ─── Tournament ───
interface TournamentReview { id: string; name: string; dateRange: { start: string; end: string }; sprints: TournamentSprintEntry[]; scoring: TournamentScoring; stats: TournamentStats; hazardIndex: TournamentHazard[]; clubPerformance: Record<string, { attempts: number; inTheHole: number; avgScore: number }>; takeaways: string[]; improvements: string[]; reflection?: string; }
interface TournamentSprintEntry { sprintNumber: number; theme: string; par: number; slope: number; score: number; scoreLabel: ScoreLabel; ticketCount: number; ticketsLanded: number; }
interface TournamentScoring { totalPar: number; totalScore: number; differential: number; avgScoreLabel: string; bestSprint: { sprintNumber: number; label: ScoreLabel }; worstSprint: { sprintNumber: number; label: ScoreLabel }; sprintCount: number; ticketCount: number; ticketsLanded: number; landingRate: number; }
`;
