import type {
  ReviewType,
  ReviewFinding,
  ReviewRecommendation,
  HazardHit,
  ClubSelection,
  SprintType,
  GolfScorecard,
} from './types.js';
import { REVIEW_TYPE_HAZARD_MAP } from './constants.js';
import { buildScorecard } from './builder.js';
import type { ScorecardInput } from './builder.js';

// --- Review Recommendation ---

/** Input for recommendReviews() — sprint metadata used to determine which reviews to run */
export interface RecommendReviewsInput {
  sprintType?: SprintType;
  ticketCount: number;
  slope: number;
  clubs?: ClubSelection[];
  filePatterns?: string[];
  hasNewInfra?: boolean;
}

const SECURITY_PATTERNS = /\b(auth|crypto|token|secret|password|credential|session|oauth|jwt|certificate|ssl|tls)\b/i;
const ML_PATTERNS = /\b(ml|ai|model|neural|train|inference|embedding|llm|prompt|vector|tensor)\b/i;
const UX_PATTERNS = /\b(ui|ux|component|view|page|layout|style|css|theme|widget|modal|dialog|form|button)\b/i;

/**
 * Recommend which review types to run based on sprint characteristics.
 * Pure function — no side effects, easy to test.
 */
export function recommendReviews(input: RecommendReviewsInput): ReviewRecommendation[] {
  const recommendations: ReviewRecommendation[] = [];
  const patterns = input.filePatterns ?? [];

  // Architect review: required for complex sprints
  if (input.ticketCount >= 3 || input.slope >= 3 || input.hasNewInfra) {
    recommendations.push({
      review_type: 'architect',
      reason: input.hasNewInfra
        ? 'New infrastructure requires architectural review'
        : input.ticketCount >= 3
          ? `${input.ticketCount} tickets warrants architectural review`
          : `Slope ${input.slope} indicates high complexity`,
      priority: 'required',
    });
  } else if (input.ticketCount >= 2) {
    recommendations.push({
      review_type: 'architect',
      reason: `${input.ticketCount} tickets — architectural review recommended`,
      priority: 'recommended',
    });
  }

  // Security review: if file patterns include auth/crypto/token paths
  if (patterns.some(p => SECURITY_PATTERNS.test(p))) {
    recommendations.push({
      review_type: 'security',
      reason: 'File patterns include security-sensitive paths',
      priority: 'required',
    });
  }

  // ML engineer review: if file patterns include ML/AI paths or sprint type is research
  if (patterns.some(p => ML_PATTERNS.test(p)) || input.sprintType === 'research') {
    recommendations.push({
      review_type: 'ml-engineer',
      reason: input.sprintType === 'research'
        ? 'Research sprint benefits from ML engineer review'
        : 'File patterns include ML/AI paths',
      priority: 'recommended',
    });
  }

  // UX review: if file patterns include UI/component paths
  if (patterns.some(p => UX_PATTERNS.test(p))) {
    recommendations.push({
      review_type: 'ux',
      reason: 'File patterns include UI/UX paths',
      priority: 'recommended',
    });
  }

  // Code review: always optional baseline
  recommendations.push({
    review_type: 'code',
    reason: 'Baseline code review',
    priority: 'optional',
  });

  return recommendations;
}

// --- Finding → Hazard Conversion ---

/**
 * Convert a ReviewFinding into a HazardHit using the review type → hazard type mapping.
 * Sets gotcha_id to `review:<review_type>` for deduplication and tracking.
 */
export function findingToHazard(finding: ReviewFinding): HazardHit {
  return {
    type: REVIEW_TYPE_HAZARD_MAP[finding.review_type],
    severity: finding.severity,
    description: `[${finding.review_type} review] ${finding.description}`,
    gotcha_id: `review:${finding.review_type}`,
  };
}

// --- Scorecard Amendment ---

/** Result of amending a scorecard with review findings */
export interface AmendResult {
  scorecard: GolfScorecard;
  amendments: Array<{
    ticket_key: string;
    description: string;
    hazard_type: string;
    severity: string;
  }>;
  score_before: number;
  score_after: number;
  label_before: string;
  label_after: string;
}

/**
 * Amend a scorecard with review findings by injecting hazards into shots.
 * Idempotent: findings with `gotcha_id: "review:*"` are deduplicated.
 * Recomputes stats, score, and score_label via buildScorecard().
 */
export function amendScorecardWithFindings(
  scorecard: GolfScorecard,
  findings: ReviewFinding[],
): AmendResult {
  const scoreBefore = scorecard.score;
  const labelBefore = scorecard.score_label;
  const amendments: AmendResult['amendments'] = [];

  // Deep clone shots to avoid mutating original
  const amendedShots = scorecard.shots.map(shot => ({
    ...shot,
    hazards: [...shot.hazards],
  }));

  for (const finding of findings) {
    const shot = amendedShots.find(s => s.ticket_key === finding.ticket_key);
    if (!shot) continue;

    const hazard = findingToHazard(finding);

    // Deduplicate: skip if a hazard with the same gotcha_id and description already exists
    const duplicate = shot.hazards.some(
      h => h.gotcha_id === hazard.gotcha_id && h.description === hazard.description,
    );
    if (duplicate) continue;

    shot.hazards.push(hazard);
    amendments.push({
      ticket_key: finding.ticket_key,
      description: finding.description,
      hazard_type: hazard.type,
      severity: finding.severity,
    });
  }

  // Rebuild scorecard with amended shots to recompute stats + score
  const input: ScorecardInput = {
    sprint_number: scorecard.sprint_number,
    theme: scorecard.theme,
    par: scorecard.par,
    slope: scorecard.slope,
    date: scorecard.date,
    shots: amendedShots,
    putts: scorecard.stats.putts,
    penalties: scorecard.stats.penalties,
    type: scorecard.type,
    conditions: scorecard.conditions,
    special_plays: scorecard.special_plays,
    training: scorecard.training,
    nutrition: scorecard.nutrition,
    nineteenth_hole: scorecard.nineteenth_hole,
    bunker_locations: scorecard.bunker_locations,
    yardage_book_updates: scorecard.yardage_book_updates,
    course_management_notes: scorecard.course_management_notes,
    ...(scorecard.player ? { player: scorecard.player } : {}),
    ...(scorecard.agents ? { agents: scorecard.agents } : {}),
  };

  const amended = buildScorecard(input);

  return {
    scorecard: amended,
    amendments,
    score_before: scoreBefore,
    score_after: amended.score,
    label_before: labelBefore,
    label_after: amended.score_label,
  };
}
