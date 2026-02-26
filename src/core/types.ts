// SLOPE — Sprint Lifecycle & Operational Performance Engine
// ════════════════════════════════════════════════════════════

// --- Core Scoring Enums ---

/** Club selection declares approach complexity before starting a ticket */
export type ClubSelection = 'driver' | 'long_iron' | 'short_iron' | 'wedge' | 'putter';

/** Shot result describes the outcome of a ticket */
export type ShotResult = 'fairway' | 'green' | 'in_the_hole' | 'missed_long' | 'missed_short' | 'missed_left' | 'missed_right';

/** Types of hazards encountered during a ticket */
export type HazardType = 'bunker' | 'water' | 'ob' | 'rough' | 'trees';

/** Severity of a hazard — maps to penalty strokes */
export type HazardSeverity = 'minor' | 'moderate' | 'major' | 'critical';

/** External conditions that affected the sprint */
export type ConditionType = 'wind' | 'rain' | 'frost_delay' | 'altitude' | 'pin_position';

/** Special plays: workarounds, retries, and shortcuts */
export type SpecialPlay = 'gimme' | 'mulligan' | 'provisional' | 'lay_up' | 'scramble';

/** Directional miss tracking for pattern analysis */
export type MissDirection = 'long' | 'short' | 'left' | 'right';

/** Golf-inspired score labels relative to par */
export type ScoreLabel = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double_bogey' | 'triple_plus';

/** Sprint type — teams can extend this with their own types */
export type SprintType = 'feature' | 'feedback' | 'infra' | 'bugfix' | 'research' | 'flow' | 'test-coverage' | 'audit';

// --- Record Types ---

/** A hazard hit during a ticket */
export interface HazardHit {
  type: HazardType;
  severity?: HazardSeverity;
  description: string;
  gotcha_id?: string;
}

/** A single ticket's outcome */
export interface ShotRecord {
  ticket_key: string;
  title: string;
  club: ClubSelection;
  result: ShotResult;
  hazards: HazardHit[];
  provisional_declared?: boolean;
  notes?: string;
}

/** An external condition affecting the sprint */
export interface ConditionRecord {
  type: ConditionType;
  description: string;
  impact: 'none' | 'minor' | 'major';
}

// --- Scoring Types ---

/** Aggregated statistics for a sprint (hole) */
export interface HoleStats {
  fairways_hit: number;
  fairways_total: number;
  greens_in_regulation: number;
  greens_total: number;
  putts: number;
  penalties: number;
  hazards_hit: number;
  hazard_penalties: number;
  miss_directions: Record<MissDirection, number>;
}

/** Core score data for a sprint */
export interface HoleScore {
  sprint_number: number;
  theme: string;
  par: 3 | 4 | 5;
  slope: number;
  score: number;
  score_label: ScoreLabel;
  shots: ShotRecord[];
  conditions: ConditionRecord[];
  special_plays: SpecialPlay[];
  stats: HoleStats;
}

// --- Training Types ---

/** Maps sprint activities to golf practice types */
export type TrainingType = 'driving_range' | 'chipping_practice' | 'putting_practice' | 'lessons';

/** A training session completed during or for the sprint */
export interface TrainingSession {
  type: TrainingType;
  description: string;
  outcome: string;
  duration_sprints?: number;
}

// --- Nutrition Types (Development Health) ---

/** Categories of development health */
export type NutritionCategory = 'hydration' | 'diet' | 'recovery' | 'supplements' | 'stretching';

/** A development health assessment entry */
export interface NutritionEntry {
  category: NutritionCategory;
  description: string;
  status: 'healthy' | 'needs_attention' | 'neglected';
}

// --- 19th Hole (Informal Reflection) ---

export interface NineteenthHole {
  how_did_it_feel?: string;
  advice_for_next_player?: string;
  what_surprised_you?: string;
  excited_about_next?: string;
}

// --- Agent Breakdown (Multi-Agent Sprints) ---

/** Per-agent scoring breakdown within a swarm sprint */
export interface AgentBreakdown {
  session_id: string;
  agent_role: string;
  shots: ShotRecord[];
  score: number;
  stats: HoleStats;
}

// --- Full Scorecard ---

/** Complete SLOPE scorecard — the primary artifact for sprint retros */
export interface GolfScorecard extends HoleScore {
  type?: SprintType;
  /** Developer who played this sprint — omit for single-player repos */
  player?: string;
  date: string;
  training?: TrainingSession[];
  nutrition?: NutritionEntry[];
  yardage_book_updates: string[];
  bunker_locations: string[];
  course_management_notes: string[];
  nineteenth_hole?: NineteenthHole;
  /** Per-agent breakdowns for multi-agent (swarm) sprints */
  agents?: AgentBreakdown[];
}

// --- Handicap Types ---

/** Rolling statistics over a window of scorecards */
export interface RollingStats {
  handicap: number;
  fairway_pct: number;
  gir_pct: number;
  avg_putts: number;
  penalties_per_round: number;
  miss_pattern: Record<MissDirection, number>;
  mulligans: number;
  gimmes: number;
}

/** Handicap card with multiple rolling windows */
export interface HandicapCard {
  last_5: RollingStats;
  last_10: RollingStats;
  all_time: RollingStats;
}

// --- Dispersion & Area Analysis Types ---

/** Shot dispersion analysis — miss pattern breakdown */
export interface DispersionReport {
  total_shots: number;
  total_misses: number;
  miss_rate_pct: number;
  by_direction: Record<MissDirection, { count: number; pct: number; interpretation: string }>;
  dominant_miss: MissDirection | null;
  systemic_issues: string[];
}

/** Area performance analysis — by sprint type, club, and par */
export interface AreaReport {
  by_sprint_type: Record<string, { count: number; avg_score_vs_par: number; fairway_pct: number; gir_pct: number }>;
  by_club: Record<string, { count: number; in_the_hole_rate: number; miss_rate: number }>;
  par_performance: Record<number, { count: number; avg_score_vs_par: number; over_par_rate: number }>;
}

// --- SLOPE Advisor Types ---

/** Execution trace for a ticket — input to classifyShot() */
export interface ExecutionTrace {
  planned_scope_paths: string[];
  modified_files: string[];
  test_results: { suite: string; passed: boolean; first_run: boolean }[];
  reverts: number;
  elapsed_minutes: number;
  hazards_encountered: HazardHit[];
}

/** Classified shot result from an execution trace */
export interface ShotClassification {
  result: ShotResult;
  miss_direction: MissDirection | null;
  confidence: number;
  reasoning: string;
}

/** Club recommendation for an upcoming ticket */
export interface ClubRecommendation {
  club: ClubSelection;
  confidence: number;
  reasoning: string;
  provisional_suggestion?: string;
}

/** Training recommendation from handicap and dispersion analysis */
export interface TrainingRecommendation {
  area: string;
  type: TrainingType;
  description: string;
  priority: 'high' | 'medium' | 'low';
  instruction_adjustment?: string;
}

// --- Sprint Claims & Registry Types ---

/** Scope of a sprint claim: individual ticket or broader area */
export type ClaimScope = 'ticket' | 'area';

/** A claim reserving a ticket or area for a player during a sprint */
export interface SprintClaim {
  id: string;
  sprint_number: number;
  player: string;
  target: string;
  scope: ClaimScope;
  claimed_at: string;
  notes?: string;
  // Store-backed claim fields
  session_id?: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

/** A conflict detected between two sprint claims */
export interface SprintConflict {
  claims: [SprintClaim, SprintClaim];
  reason: string;
  severity: 'overlap' | 'adjacent';
}

// --- Tournament Review Types ---

/** A tournament is a multi-sprint initiative tracked as a cohesive unit */
export interface TournamentReview {
  /** Initiative identifier (e.g. "M-09") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Start/end dates (from first/last scorecard) */
  dateRange: { start: string; end: string };
  /** Sprints included in this tournament */
  sprints: TournamentSprintEntry[];
  /** Aggregate scoring */
  scoring: TournamentScoring;
  /** Aggregate stats across all sprints */
  stats: TournamentStats;
  /** Hazard patterns discovered across the tournament */
  hazardIndex: TournamentHazard[];
  /** Per-club performance (which complexities went well/poorly) */
  clubPerformance: Record<string, { attempts: number; inTheHole: number; avgScore: number }>;
  /** Strategic takeaways */
  takeaways: string[];
  /** What would you do differently */
  improvements: string[];
  /** Free-form reflection */
  reflection?: string;
}

export interface TournamentSprintEntry {
  sprintNumber: number;
  theme: string;
  par: number;
  slope: number;
  score: number;
  scoreLabel: ScoreLabel;
  ticketCount: number;
  ticketsLanded: number;
}

export interface TournamentScoring {
  totalPar: number;
  totalScore: number;
  differential: number;
  avgScoreLabel: string;
  bestSprint: { sprintNumber: number; label: ScoreLabel };
  worstSprint: { sprintNumber: number; label: ScoreLabel };
  sprintCount: number;
  ticketCount: number;
  ticketsLanded: number;
  landingRate: number;
}

export interface TournamentStats {
  avgSlope: number;
  totalHazards: number;
  totalPenalties: number;
  avgPutts: number;
  fairwayRate: number;
  girRate: number;
}

export interface TournamentHazard {
  gotchaId: string;
  sprint: number;
  area: string;
  description: string;
}

// --- Event Types (Session Telemetry) ---

/** Types of events captured during a session */
export type EventType = 'failure' | 'dead_end' | 'scope_change' | 'compaction' | 'hazard' | 'decision' | 'standup';

/** CI/test runner identifier */
export type CIRunner = 'vitest' | 'jest' | 'unknown';

/** Structured test signal parsed from CI/test runner output */
export interface CISignal {
  runner: CIRunner;
  test_total: number;
  test_passed: number;
  test_failed: number;
  test_skipped: number;
  suites_total: number;
  suites_passed: number;
  suites_failed: number;
  duration_ms?: number;
  retries: number;
  coverage_pct?: number;
}

// --- PR Signal Types ---

/** Supported PR/code review platforms */
export type PRPlatform = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

/** PR review decision states */
export type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'COMMENTED' | 'NONE';

/** Structured signal parsed from PR metadata (e.g. gh pr view --json) */
export interface PRSignal {
  platform: PRPlatform;
  pr_number: number;
  review_cycles: number;
  change_request_count: number;
  time_to_merge_minutes: number | null;
  ci_checks_passed: number;
  ci_checks_failed: number;
  file_count: number;
  additions: number;
  deletions: number;
  comment_count: number;
  review_decision: PRReviewDecision;
}

/** A telemetry event captured during a session */
export interface SlopeEvent {
  id: string;
  session_id?: string;
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
  sprint_number?: number;
  ticket_key?: string;
}

// --- Review Types (Implementation Review Integration) ---

/** Types of implementation reviews that can be run on a sprint */
export type ReviewType = 'architect' | 'code' | 'ml-engineer' | 'security' | 'ux';

/** A finding from an implementation review */
export interface ReviewFinding {
  review_type: ReviewType;
  ticket_key: string;
  severity: HazardSeverity;
  description: string;
  resolved: boolean;
}

/** A recommendation to run a specific review type */
export interface ReviewRecommendation {
  review_type: ReviewType;
  reason: string;
  priority: 'required' | 'recommended' | 'optional';
}

// --- Transcript Types (Session Tool-Call Tracking) ---

/** Summary of a single tool call within a turn */
export interface ToolCallSummary {
  tool: string;
  params_summary: string;
  success: boolean;
  duration_ms?: number;
}

/** A single turn in a session transcript */
export interface TranscriptTurn {
  /** Assigned on read from line index (1-indexed), NOT written to JSONL */
  turn_number: number;
  role: 'user' | 'assistant' | 'tool_result';
  timestamp: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  tool_calls?: ToolCallSummary[];
  outcome?: 'success' | 'failure' | 'retry' | 'abandoned';
  outcome_note?: string;
  context_used_pct?: number;
  compacted?: boolean;
}

/** What's actually written per JSONL line (turn_number derived on read) */
export type TranscriptLine = Omit<TranscriptTurn, 'turn_number'>;
