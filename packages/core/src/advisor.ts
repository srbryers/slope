import type {
  GolfScorecard,
  ClubSelection,
  ClubRecommendation,
  ShotClassification,
  ShotResult,
  MissDirection,
  ExecutionTrace,
  TrainingRecommendation,
  TrainingType,
  HandicapCard,
  DispersionReport,
  CISignal,
  SlopeEvent,
} from './types.js';
import { computeAreaPerformance, computeDispersion } from './dispersion.js';

// --- Module-private constants ---

const MISS_RESULT_TO_DIR: Partial<Record<ShotResult, MissDirection>> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

const GOOD_RESULTS = new Set<ShotResult>(['fairway', 'green', 'in_the_hole']);

// --- Club ordering for downgrade logic ---

const CLUB_ORDER: ClubSelection[] = ['putter', 'wedge', 'short_iron', 'long_iron', 'driver'];

const COMPLEXITY_TO_CLUB: Record<string, ClubSelection> = {
  trivial: 'putter',
  small: 'wedge',
  medium: 'short_iron',
  large: 'long_iron',
};

// ═══════════════════════════════════════════════════════════
// recommendClub()
// ═══════════════════════════════════════════════════════════

export interface RecommendClubInput {
  ticketComplexity: 'trivial' | 'small' | 'medium' | 'large';
  scorecards: GolfScorecard[];
  slopeFactors?: string[];
}

/**
 * Recommend a club (approach complexity) for an upcoming ticket.
 *
 * Logic:
 * 1. Map ticket complexity to default club
 * 2. If large + slope >= 3, upgrade to driver
 * 3. Check historical performance — if default club miss_rate > 30%, downgrade one level
 * 4. Check dispersion for dominant miss — add provisional suggestion if present
 * 5. Confidence: 1.0 with ≥5 scorecards for that club, 0.7 with 1-4, 0.5 with 0
 */
export function recommendClub(input: RecommendClubInput): ClubRecommendation {
  const { ticketComplexity, scorecards, slopeFactors = [] } = input;

  // Step 1: Default club from complexity
  let club: ClubSelection = COMPLEXITY_TO_CLUB[ticketComplexity] ?? 'short_iron';

  // Step 2: Slope-adjusted upgrade for large tickets
  if (ticketComplexity === 'large' && slopeFactors.length >= 3) {
    club = 'driver';
  }

  const reasons: string[] = [`${ticketComplexity} complexity → ${club}`];

  // Step 3: Historical performance check
  if (scorecards.length > 0) {
    const areaReport = computeAreaPerformance(scorecards);
    const clubStats = areaReport.by_club[club];

    if (clubStats && clubStats.miss_rate > 30) {
      const idx = CLUB_ORDER.indexOf(club);
      if (idx > 0) {
        const previousClub = club;
        club = CLUB_ORDER[idx - 1];
        reasons.push(`Downgraded from ${previousClub}: historical miss rate ${clubStats.miss_rate}% > 30%`);
      }
    }
  }

  // Step 4: Provisional suggestion from dispersion
  let provisional_suggestion: string | undefined;
  if (scorecards.length > 0) {
    const dispersion = computeDispersion(scorecards);
    if (dispersion.dominant_miss) {
      const missRate = dispersion.miss_rate_pct;
      provisional_suggestion = `Consider declaring provisional — this area has ${missRate}% miss rate (dominant: ${dispersion.dominant_miss})`;
    }
  }

  // Step 5: Confidence from history depth for this club
  let confidence: number;
  if (scorecards.length > 0) {
    const areaReport = computeAreaPerformance(scorecards);
    const clubStats = areaReport.by_club[club];
    const clubCount = clubStats?.count ?? 0;
    confidence = clubCount >= 5 ? 1.0 : clubCount >= 1 ? 0.7 : 0.5;
  } else {
    confidence = 0.5;
  }

  return {
    club,
    confidence,
    reasoning: reasons.join('. '),
    ...(provisional_suggestion ? { provisional_suggestion } : {}),
  };
}

// ═══════════════════════════════════════════════════════════
// classifyShot()
// ═══════════════════════════════════════════════════════════

/**
 * Classify a shot result from an execution trace.
 *
 * Rules:
 * - All files in scope, no failures, no reverts → in_the_hole
 * - Has hazards, all resolved before first green suite → in_the_hole (in-pass fix)
 * - Has hazards, resolved after initial pass → green (required rework)
 * - Files outside scope modified → missed_long (over-engineering)
 * - Planned files not modified → missed_short (under-scoping)
 * - Reverts > 0 or approach changed → missed_left (wrong approach)
 * - Some test suites fail despite others passing → missed_right (wrong execution)
 */
export function classifyShot(trace: ExecutionTrace): ShotClassification {
  const {
    planned_scope_paths,
    modified_files,
    test_results,
    reverts,
    hazards_encountered,
  } = trace;

  // Count signals
  const outOfScopeFiles = modified_files.filter(
    f => !planned_scope_paths.some(scope => f.startsWith(scope)),
  );
  const unmatchedPlanned = planned_scope_paths.filter(
    scope => !modified_files.some(f => f.startsWith(scope)),
  );
  const allTestsPassed = test_results.length === 0 || test_results.every(t => t.passed);
  const someTestsFailed = test_results.some(t => !t.passed) && test_results.some(t => t.passed);
  const hasHazards = hazards_encountered.length > 0;
  const firstRunResults = test_results.filter(t => t.first_run);
  const hazardsResolvedInPass = hasHazards && firstRunResults.length > 0 &&
    firstRunResults.every(t => t.passed);

  // Collect miss signals with weights
  const signals: { result: ShotResult; weight: number; reason: string }[] = [];

  if (reverts > 0) {
    signals.push({ result: 'missed_left', weight: reverts * 2, reason: `${reverts} revert(s) — wrong approach` });
  }
  if (outOfScopeFiles.length > 0) {
    signals.push({ result: 'missed_long', weight: outOfScopeFiles.length, reason: `${outOfScopeFiles.length} file(s) outside scope — over-engineering` });
  }
  if (unmatchedPlanned.length > 0 && planned_scope_paths.length > 0) {
    signals.push({ result: 'missed_short', weight: unmatchedPlanned.length, reason: `${unmatchedPlanned.length} planned scope(s) not touched — under-scoping` });
  }
  if (someTestsFailed) {
    const failCount = test_results.filter(t => !t.passed).length;
    signals.push({ result: 'missed_right', weight: failCount, reason: `${failCount} test suite(s) failing — wrong execution` });
  }

  // If miss signals present, pick the dominant one
  if (signals.length > 0) {
    signals.sort((a, b) => b.weight - a.weight);
    const dominant = signals[0];
    const dir = MISS_RESULT_TO_DIR[dominant.result] ?? null;
    // Confidence: high if single signal, lower if ambiguous
    const confidence = signals.length === 1 ? 1.0 : 0.7 + (0.2 * (dominant.weight / (signals.reduce((s, sig) => s + sig.weight, 0))));
    return {
      result: dominant.result,
      miss_direction: dir,
      confidence: Math.round(Math.min(confidence, 1.0) * 100) / 100,
      reasoning: dominant.reason,
    };
  }

  // No miss signals — classify as good result
  if (hasHazards && !hazardsResolvedInPass) {
    return {
      result: 'green',
      miss_direction: null,
      confidence: 1.0,
      reasoning: 'Completed with hazards that required rework after initial pass',
    };
  }

  if (hasHazards && hazardsResolvedInPass) {
    return {
      result: 'in_the_hole',
      miss_direction: null,
      confidence: 0.9,
      reasoning: 'Hazards encountered but resolved before initial test pass',
    };
  }

  return {
    result: 'in_the_hole',
    miss_direction: null,
    confidence: 1.0,
    reasoning: 'Clean execution — all files in scope, no failures, no reverts',
  };
}

// ═══════════════════════════════════════════════════════════
// classifyShotFromSignals()
// ═══════════════════════════════════════════════════════════

/** Combined signal sources for enhanced shot classification */
export interface CombinedSignals {
  trace: ExecutionTrace;
  ci?: CISignal;
  events?: SlopeEvent[];
}

/**
 * Enhanced shot classification using multiple signal sources.
 *
 * Key difference from classifyShot():
 * - Git-only (no CI, no events) defaults to `green` instead of `in_the_hole`
 * - CI signals can upgrade to `in_the_hole` (all tests pass, no retries, no failures)
 * - CI test failures add miss signals (missed_right)
 * - CI retries reduce confidence
 * - Events (failure, dead_end, scope_change) add miss signals
 */
export function classifyShotFromSignals(input: CombinedSignals): ShotClassification {
  const { trace, ci, events = [] } = input;

  // Start with base classification from execution trace
  const base = classifyShot(trace);

  // If base already detected misses, enrich with CI/event signals
  if (base.miss_direction !== null) {
    return enrichMissClassification(base, ci, events);
  }

  // Base classified as good (green or in_the_hole)
  // Now apply multi-source rules

  // Count event-based miss signals
  const failureEvents = events.filter(e => e.type === 'failure');
  const deadEndEvents = events.filter(e => e.type === 'dead_end');
  const scopeChangeEvents = events.filter(e => e.type === 'scope_change');

  const eventSignals: { result: ShotResult; weight: number; reason: string }[] = [];

  if (deadEndEvents.length > 0) {
    eventSignals.push({
      result: 'missed_left',
      weight: deadEndEvents.length * 2,
      reason: `${deadEndEvents.length} dead end(s) encountered — approach changes required`,
    });
  }

  if (failureEvents.length >= 3) {
    eventSignals.push({
      result: 'missed_right',
      weight: failureEvents.length,
      reason: `${failureEvents.length} failure events — execution difficulties`,
    });
  }

  if (scopeChangeEvents.length > 0) {
    eventSignals.push({
      result: 'missed_long',
      weight: scopeChangeEvents.length,
      reason: `${scopeChangeEvents.length} scope change(s) — scope expanded during execution`,
    });
  }

  // If event signals indicate a miss, return that
  if (eventSignals.length > 0) {
    eventSignals.sort((a, b) => b.weight - a.weight);
    const dominant = eventSignals[0];
    const dir = MISS_RESULT_TO_DIR[dominant.result] ?? null;
    const confidence = eventSignals.length === 1 ? 0.8 : 0.6;
    return {
      result: dominant.result,
      miss_direction: dir,
      confidence,
      reasoning: dominant.reason,
    };
  }

  // No miss signals from events — determine green vs in_the_hole

  // If base was green (hazards with rework), keep it
  if (base.result === 'green') {
    return base;
  }

  // Base was in_the_hole — check if we have CI confirmation
  const hasCi = ci !== undefined && ci.test_total > 0;

  if (!hasCi) {
    // Git-only: downgrade to green (need CI to confirm in_the_hole)
    return {
      result: 'green',
      miss_direction: null,
      confidence: 0.7,
      reasoning: 'Clean git signals but no CI confirmation — defaulting to green',
    };
  }

  // We have CI data — evaluate
  if (ci!.test_failed > 0) {
    return {
      result: 'missed_right',
      miss_direction: 'right',
      confidence: 0.9,
      reasoning: `CI reports ${ci!.test_failed} test failure(s) out of ${ci!.test_total}`,
    };
  }

  if (ci!.retries > 0) {
    // Tests pass but had retries — green, not in_the_hole
    return {
      result: 'green',
      miss_direction: null,
      confidence: 0.8,
      reasoning: `All ${ci!.test_passed} tests pass but ${ci!.retries} retry(s) needed — not clean enough for in_the_hole`,
    };
  }

  // CI confirms: all tests pass, no retries → in_the_hole
  return {
    result: 'in_the_hole',
    miss_direction: null,
    confidence: 1.0,
    reasoning: `CI confirms: ${ci!.test_passed}/${ci!.test_total} tests pass, 0 retries — clean execution`,
  };
}

/** Enrich an existing miss classification with CI/event data */
function enrichMissClassification(
  base: ShotClassification,
  ci?: CISignal,
  events: SlopeEvent[] = [],
): ShotClassification {
  const reasons: string[] = [base.reasoning];

  if (ci && ci.test_failed > 0) {
    reasons.push(`CI confirms: ${ci.test_failed} test failure(s)`);
  }

  const failureCount = events.filter(e => e.type === 'failure').length;
  if (failureCount > 0) {
    reasons.push(`${failureCount} failure event(s) recorded`);
  }

  // If multiple sources agree, boost confidence
  const ciAgrees = ci !== undefined && ci.test_failed > 0;
  const eventsAgree = failureCount > 0;
  const sources = 1 + (ciAgrees ? 1 : 0) + (eventsAgree ? 1 : 0);
  const confidence = Math.min(base.confidence + (sources - 1) * 0.1, 1.0);

  return {
    ...base,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: reasons.join('. '),
  };
}

// ═══════════════════════════════════════════════════════════
// generateTrainingPlan()
// ═══════════════════════════════════════════════════════════

export interface TrainingPlanInput {
  handicap: HandicapCard;
  dispersion: DispersionReport;
  recentScorecards: GolfScorecard[];
}

/**
 * Generate training recommendations from handicap trends and dispersion data.
 *
 * Checks:
 * 1. Dominant miss direction → targeted practice (high)
 * 2. Worsening trend (last_5 > all_time) → review (high)
 * 3. Club-specific issues (miss_rate > 50%) → adjustment (medium)
 * 4. Recurring hazard types in 3+ consecutive sprints → attention (medium)
 */
export function generateTrainingPlan(input: TrainingPlanInput): TrainingRecommendation[] {
  const { handicap, dispersion, recentScorecards } = input;
  const recommendations: TrainingRecommendation[] = [];

  // 1. Dominant miss pattern
  if (dispersion.dominant_miss) {
    const dir = dispersion.dominant_miss;
    const dirInfo = dispersion.by_direction[dir];
    const trainingMap: Record<MissDirection, { type: TrainingType; instruction: string }> = {
      long: { type: 'chipping_practice', instruction: 'Reduce scope per ticket. Break large tickets into smaller sub-tasks before starting.' },
      short: { type: 'putting_practice', instruction: 'Verify all spec requirements are covered before marking a ticket complete. Add a pre-completion checklist.' },
      left: { type: 'driving_range', instruction: 'Spend more time on approach selection. Research patterns before starting implementation.' },
      right: { type: 'chipping_practice', instruction: 'Strictly follow scope_paths. Review diff before commit to catch unrelated changes.' },
    };
    const training = trainingMap[dir];
    recommendations.push({
      area: `Dominant miss: ${dir} (${dirInfo.pct}% of misses)`,
      type: training.type,
      description: `${dirInfo.interpretation} — ${dirInfo.count} occurrences across recent sprints`,
      priority: 'high',
      instruction_adjustment: training.instruction,
    });
  }

  // 2. Worsening trend
  if (handicap.last_5.handicap > handicap.all_time.handicap + 0.5 && handicap.all_time.handicap > 0) {
    recommendations.push({
      area: 'Worsening trend',
      type: 'lessons',
      description: `Recent handicap (+${handicap.last_5.handicap.toFixed(1)}) worse than all-time (+${handicap.all_time.handicap.toFixed(1)})`,
      priority: 'high',
      instruction_adjustment: 'Review recent sprint retros for recurring patterns. Consider reducing sprint scope or complexity until trend stabilizes.',
    });
  }

  // 3. Club-specific issues
  if (recentScorecards.length > 0) {
    const areaReport = computeAreaPerformance(recentScorecards);
    for (const [club, stats] of Object.entries(areaReport.by_club)) {
      if (stats.miss_rate > 50 && stats.count >= 2) {
        recommendations.push({
          area: `Club: ${club}`,
          type: 'driving_range',
          description: `${club} has ${stats.miss_rate}% miss rate across ${stats.count} uses`,
          priority: 'medium',
          instruction_adjustment: `Avoid ${club}-level complexity. Downgrade to a simpler approach or break the work into smaller pieces.`,
        });
      }
    }
  }

  // 4. Recurring hazards in 3+ consecutive sprints
  if (recentScorecards.length >= 3) {
    const hazardTypesBySprint: Map<string, number[]> = new Map();
    for (const sc of recentScorecards) {
      const sprintNum = sc.sprint_number;
      for (const shot of sc.shots) {
        for (const h of shot.hazards) {
          if (!hazardTypesBySprint.has(h.type)) {
            hazardTypesBySprint.set(h.type, []);
          }
          const sprints = hazardTypesBySprint.get(h.type)!;
          if (!sprints.includes(sprintNum)) {
            sprints.push(sprintNum);
          }
        }
      }
    }

    for (const [hazardType, sprints] of hazardTypesBySprint) {
      if (sprints.length >= 3) {
        // Check if they are consecutive (sorted sprints with gap <= 2)
        const sorted = [...sprints].sort((a, b) => a - b);
        const lastThree = sorted.slice(-3);
        const isConsecutive = lastThree[2] - lastThree[0] <= 4; // within 4 sprints
        if (isConsecutive) {
          recommendations.push({
            area: `Recurring hazard: ${hazardType}`,
            type: 'lessons',
            description: `${hazardType} hazards appeared in ${sprints.length} sprints (${sorted.join(', ')})`,
            priority: 'medium',
            instruction_adjustment: `Before starting, check known ${hazardType} hazards from recent scorecards. Add explicit verification steps.`,
          });
        }
      }
    }
  }

  // Sort by priority (high first)
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
