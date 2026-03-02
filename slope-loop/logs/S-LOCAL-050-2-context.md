## vitest.config.ts (score: 0.557)
```
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

```

## docs/tutorial-first-sprint.md (score: 0.555)
```
| `hazard_penalties`    | number | Hazards that added to score      |
| `miss_directions`     | object | `{ long, short, left, right }`   |

### Condition Types

| Type         | Meaning                            |
|--------------|------------------------------------|
| `wind`       | External service issues            |
| `rain`       | Team/process disruptions           |
| `firm`       | Tight deadlines                    |
| `soft`       | Relaxed timeline                   |

### Special Play Types

| Type          | Meaning                              |
|---------------|--------------------------------------|
| `mulligan`    | Approach scrapped, restarted         |
| `gimme`       | Trivial fix accepted without process |
| `provisional` | Parallel approach tried              |

```

## src/core/review.ts (score: 0.554)
```
import type {
  ReviewType,
  ReviewFinding,
  ReviewRecommendation,
  HazardHit,
  HazardType,
  HazardSeverity,
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
    hazard_type: HazardType;
    severity: HazardSeverity;
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

```

## src/core/dispersion.ts (score: 0.552)
```
import type {
  GolfScorecard,
  MissDirection,
  ShotResult,
  DispersionReport,
  AreaReport,
  ClubSelection,
} from './types.js';
import { normalizeStats } from './builder.js';

// --- Helpers ---

const MISS_RESULT_TO_DIR: Partial<Record<ShotResult, MissDirection>> = {
  missed_long: 'long',
  missed_short: 'short',
  missed_left: 'left',
  missed_right: 'right',
};

const GOOD_RESULTS = new Set<ShotResult>(['fairway', 'green', 'in_the_hole']);

const DIRECTIONS: MissDirection[] = ['long', 'short', 'left', 'right'];

const DIRECTION_INTERPRETATIONS: Record<MissDirection, string> = {
  long: 'Over-scoping or over-engineering — tickets taking more work than estimated',
  short: 'Under-scoping — missing requirements or incomplete implementations',
  left: 'Wrong approach — choosing incorrect tools, patterns, or architecture',
  right: 'Scope creep — pulling in unrelated work or gold-plating',
};

// --- Dispersion Analysis ---

/**
 * Compute shot dispersion analysis from an array of scorecards.
 * Returns miss pattern breakdown, dominant direction, and systemic issues.
 */
export function computeDispersion(scorecards: GolfScorecard[]): DispersionReport {
  const zeroed: DispersionReport = {
    total_shots: 0,
    total_misses: 0,
    miss_rate_pct: 0,
    by_direction: {
      long: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.long },
      short: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.short },
      left: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.left },
      right: { count: 0, pct: 0, interpretation: DIRECTION_INTERPRETATIONS.right },
    },
    dominant_miss: null,
    systemic_issues: [],
  };

  if (scorecards.length === 0) {
    return zeroed;
  }

  let totalShots = 0;
  const dirCounts: Record<MissDirection, number> = { long: 0, short: 0, left: 0, right: 0 };

  for (const sc of scorecards) {
    for (const shot of sc.shots ?? []) {
      totalShots++;
      const dir = MISS_RESULT_TO_DIR[shot.result];
      if (dir) {
        dirCounts[dir]++;
      }
    }
  }

  const totalMisses = DIRECTIONS.reduce((sum, d) => sum + dirCounts[d], 0);
  const missRate = totalShots > 0 ? Math.round((totalMisses / totalShots) * 1000) / 10 : 0;

  const byDirection = {} as DispersionReport['by_direction'];
  let maxDir: MissDirection | null = null;
  let maxCount = 0;

  for (const dir of DIRECTIONS) {
    const count = dirCounts[dir];
    const pct = totalMisses > 0 ? Math.round((count / totalMisses) * 1000) / 10 : 0;
    byDirection[dir] = { count, pct, interpretation: DIRECTION_INTERPRETATIONS[dir] };
    if (count > maxCount) {
      maxCount = count;
      maxDir = dir;
    }
  }

  // Only report dominant if there are misses and one direction is clearly dominant (>40%)
  const dominantMiss = maxCount > 0 && totalMisses > 0 && (maxCount / totalMisses) > 0.4
    ? maxDir
    : null;

  // Systemic issues
  const systemic: string[] = [];
  if (scorecards.length < 5) {
    systemic.push(`Insufficient data — only ${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'} available (need 5+ for reliable patterns)`);
  }
  if (missRate > 30) {
    systemic.push(`High miss rate (${missRate}%) — consider reducing sprint scope or complexity`);
  }
  if (dominantMiss) {
    systemic.push(`Dominant miss direction: ${dominantMiss} — ${DIRECTION_INTERPRETATIONS[dominantMiss]}`);
  }

  return {
    total_shots: totalShots,
    total_misses: totalMisses,
    miss_rate_pct: missRate,
    by_direction: byDirection,
    dominant_miss: dominantMiss,
    systemic_issues: systemic,
  };
}

// --- Area Performance Analysis ---

/**
 * Compute area performance analysis from an array of scorecards.
 * Groups performance by sprint type, club selection, and par value.
 */
export function computeAreaPerformance(scorecards: GolfScorecard[]): AreaReport {
  const byType: Record<string, { count: number; totalDiff: number; fairwayNum: number; fairwayDen: number; girNum: number; girDen: number }> = {};
  const byClub: Record<string, { count: number; holeInOne: number; misses: number }> = {};
  const byPar: Record<number, { count: number; totalDiff: number; overPar: number }> = {};

  for (const sc of scorecards) {
    const sprintType = sc.type ?? 'feature';
    const diff = sc.score - sc.par;

    // By sprint type
    if (!byType[sprintType]) {
      byType[sprintType] = { count: 0, totalDiff: 0, fairwayNum: 0, fairwayDen: 0, girNum: 0, girDen: 0 };
    }
    const t = byType[sprintType];
    t.count++;
    t.totalDiff += diff;
    const stats = normalizeStats(sc.stats, (sc.shots ?? []).length);
    t.fairwayNum += stats.fairways_hit;
    t.fairwayDen += stats.fairways_total;
    t.girNum += stats.greens_in_regulation;
    t.girDen += stats.greens_total;

    // By par
    if (!byPar[sc.par]) {
      byPar[sc.par] = { count: 0, totalDiff: 0, overPar: 0 };
    }
    const p = byPar[sc.par];
    p.count++;
    p.totalDiff += diff;
    if (diff > 0) p.overPar++;

    // By club (per shot)
    for (const shot of sc.shots ?? []) {
      if (!byClub[shot.club]) {
        byClub[shot.club] = { count: 0, holeInOne: 0, misses: 0 };
      }
      const c = byClub[shot.club];
      c.count++;
      if (shot.result === 'in_the_hole') c.holeInOne++;
      if (!GOOD_RESULTS.has(shot.result)) c.misses++;
    }
  }

  // Build report
  const typeReport: AreaReport['by_sprint_type'] = {};
  for (const [type, data] of Object.entries(byType)) {
    typeReport[type] = {
      count: data.count,
      avg_score_vs_par: Math.round((data.totalDiff / data.count) * 10) / 10,
      fairway_pct: data.fairwayDen > 0 ? Math.round((data.fairwayNum / data.fairwayDen) * 1000) / 10 : 0,
      gir_pct: data.girDen > 0 ? Math.round((data.girNum / data.girDen) * 1000) / 10 : 0,
    };
  }

  const clubReport: AreaReport['by_club'] = {};
  for (const [club, data] of Object.entries(byClub)) {
    clubReport[club] = {
      count: data.count,
      in_the_hole_rate: data.count > 0 ? Math.round((data.holeInOne / data.count) * 1000) / 10 : 0,
      miss_rate: data.count > 0 ? Math.round((data.misses / data.count) * 1000) / 10 : 0,
    };
  }

  const parReport: AreaReport['par_performance'] = {};
  for (const [par, data] of Object.entries(byPar)) {
    parReport[Number(par)] = {
      count: data.count,
      avg_score_vs_par: Math.round((data.totalDiff / data.count) * 10) / 10,
      over_par_rate: data.count > 0 ? Math.round((data.overPar / data.count) * 1000) / 10 : 0,
    };
  }

  return {
    by_sprint_type: typeReport,
    by_club: clubReport,
    par_performance: parReport,
  };
}

```

## src/core/initiative.ts (score: 0.552)
```
import type { ReviewType } from './types.js';
// RoadmapDefinition used via parseRoadmap return type

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseRoadmap } from './roadmap.js';

// --- Specialist Types (distinct from ReviewType) ---

export type SpecialistType = 'backend' | 'ml-engineer' | 'database' | 'frontend' | 'ux-designer';

// --- Initiative Sprint Phase (state machine) ---

export type InitiativeSprintPhase =
  | 'pending'
  | 'planning'
  | 'plan_review'
  | 'executing'
  | 'scoring'
  | 'pr_review'
  | 'complete';

// --- Review Gate Config ---

export interface ReviewGateConfig {
  plan: {
    required: ReviewType[];
    specialists: 'auto' | SpecialistType[];
  };
  pr: {
    required: ReviewType[];
  };
}

// --- Review Record ---

export interface ReviewRecord {
  reviewer: SpecialistType | ReviewType;
  completed: boolean;
  findings_count: number;
  reviewer_mode: 'manual' | 'auto';
}

// --- Initiative Sprint Status ---

export interface InitiativeSprintStatus {
  sprint_number: number;
  phase: InitiativeSprintPhase;
  plan_reviews: ReviewRecord[];
  pr_reviews: ReviewRecord[];
  scorecard?: string;
  pr_url?: string;
  branch?: string;
}

// --- Initiative Definition ---

export interface InitiativeDefinition {
  name: string;
  description: string;
  roadmap: string;
  review_gates: ReviewGateConfig;
  sprints: InitiativeSprintStatus[];
}

// --- Review Checklist ---

export interface ReviewChecklistItem {
  question: string;
  category: string;
}

export interface ReviewChecklistContext {
  sprint_number: number;
  ticket_count: number;
  slope: number;
  file_patterns: string[];
  has_new_infra: boolean;
  description?: string;
}

// --- State Machine ---

const VALID_TRANSITIONS: Record<InitiativeSprintPhase, InitiativeSprintPhase | null> = {
  pending: 'planning',
  planning: 'plan_review',
  plan_review: 'executing',
  executing: 'scoring',
  scoring: 'pr_review',
  pr_review: 'complete',
  complete: null,
};

export function getNextPhase(current: InitiativeSprintPhase): InitiativeSprintPhase | null {
  return VALID_TRANSITIONS[current];
}

export function canAdvance(sprint: InitiativeSprintStatus, gates: ReviewGateConfig): { ok: true } | { ok: false; reason: string } {
  const next = getNextPhase(sprint.phase);
  if (!next) return { ok: false, reason: `Sprint is already complete` };

  // Validate prerequisites for specific transitions
  if (sprint.phase === 'plan_review') {
    // All required plan reviews + specialist reviews must be completed
    const requiredReviews = gates.plan.required;
    for (const reviewType of requiredReviews) {
      const record = sprint.plan_reviews.find(r => r.reviewer === reviewType);
      if (!record || !record.completed) {
        return { ok: false, reason: `Required plan review not complete: ${reviewType}` };
      }
    }
    // Check specialist reviews
    const specialistReviews = sprint.plan_reviews.filter(
      r => !requiredReviews.includes(r.reviewer as ReviewType),
    );
    const incompleteSpecialists = specialistReviews.filter(r => !r.completed);
    if (incompleteSpecialists.length > 0) {
      return {
        ok: false,
        reason: `Specialist reviews not complete: ${incompleteSpecialists.map(r => r.reviewer).join(', ')}`,
      };
    }
  }

  if (sprint.phase === 'pr_review') {
    // All required PR reviews must be completed
    for (const reviewType of gates.pr.required) {
      const record = sprint.pr_reviews.find(r => r.reviewer === reviewType);
      if (!record || !record.completed) {
        return { ok: false, reason: `Required PR review not complete: ${reviewType}` };
      }
    }
  }

  return { ok: true };
}

// --- Specialist Selection ---

const SPECIALIST_PATTERNS: Record<SpecialistType, RegExp> = {
  backend: /\b(store|api|server|endpoint|route|middleware|auth|cli|command|handler)\b/i,
  'ml-engineer': /\b(ml|ai|model|embedding|vector|neural|inference|llm|prompt|scoring|prediction)\b/i,
  database: /\b(sqlite|postgres|pg|migration|schema|table|index|query|store-pg|sql)\b/i,
  frontend: /\b(html|css|component|dashboard|report|chart|svg|template|render|canvas)\b/i,
  'ux-designer': /\b(onboarding|init|interview|wizard|tutorial|ux|accessibility|flow|getting-started|walkthrough)\b/i,
};

const SPECIALIST_PRIORITY: SpecialistType[] = [
  'backend',
  'database',
  'ml-engineer',
  'frontend',
  'ux-designer',
];

export function selectSpecialists(tickets: Array<{ title: string; description?: string; filePatterns?: string[] }>): SpecialistType[] {
  // Concatenate all ticket text
  const text = tickets
    .map(t => [t.title, t.description ?? '', ...(t.filePatterns ?? [])].join(' '))
    .join(' ');

  // Count keyword hits per specialist
  const counts = new Map<SpecialistType, number>();
  for (const [specialist, pattern] of Object.entries(SPECIALIST_PATTERNS)) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    counts.set(specialist as SpecialistType, matches?.length ?? 0);
  }

  // Include specialists with hit count >= 2
  const selected = SPECIALIST_PRIORITY.filter(s => (counts.get(s) ?? 0) >= 2);

  // If none meet threshold, include the top scorer (minimum 1 specialist)
  if (selected.length === 0) {
    let maxCount = 0;
    let topSpecialist: SpecialistType = 'backend';
    for (const s of SPECIALIST_PRIORITY) {
      const count = counts.get(s) ?? 0;
      if (count > maxCount) {
        maxCount = count;
        topSpecialist = s;
      }
    }
    return [topSpecialist];
  }

  return selected;
}

// --- Review Checklists ---

const ARCHITECT_PLAN_CHECKLIST: ReviewChecklistItem[] = [
  { question: 'Does the plan duplicate existing SLOPE infrastructure? (check imports, existing functions)', category: 'duplication' },
  { question: 'Are dependencies correct and ordering optimal?', category: 'dependencies' },
  { question: 'Does the approach match codebase patterns? (naming, module structure, export style)', category: 'patterns' },
  { question: 'Are there scope gaps or underscoped complexity?', category: 'scope' },
  { question: 'Does it introduce unnecessary abstractions?', category: 'complexity' },
  { question: 'Are ticket counts reasonable (3-4 per sprint)?', category: 'scope' },
];

const ARCHITECT_PR_CHECKLIST: ReviewChecklistItem[] = [
  { question: 'Design decisions align with plan', category: 'alignment' },
  { question: 'API surface changes are intentional (new exports from index.ts)', category: 'api' },
  { question: 'No breaking changes without version bump', category: 'compatibility' },
  { question: 'Cross-package dependencies use workspace:* protocol', category: 'monorepo' },
];

```

## tests/core/combined-signals.test.ts (score: 0.551)
```
import { describe, it, expect } from 'vitest';
import { classifyShotFromSignals } from '../../src/core/advisor.js';
import type { ExecutionTrace, CISignal, SlopeEvent } from '../../src/core/types.js';

function cleanTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    planned_scope_paths: ['packages/core/src/'],
    modified_files: ['packages/core/src/foo.ts'],
    test_results: [],
    reverts: 0,
    elapsed_minutes: 15,
    hazards_encountered: [],
    ...overrides,
  };
}

function passingCI(overrides: Partial<CISignal> = {}): CISignal {
  return {
    runner: 'vitest',
    test_total: 100,
    test_passed: 100,
    test_failed: 0,
    test_skipped: 0,
    suites_total: 5,
    suites_passed: 5,
    suites_failed: 0,
    retries: 0,
    ...overrides,
  };
}

function makeEvent(type: SlopeEvent['type'], data: Record<string, unknown> = {}): SlopeEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}

describe('classifyShotFromSignals — git-only (no CI, no events)', () => {
  it('defaults to green when only git signals available', () => {
    const result = classifyShotFromSignals({ trace: cleanTrace() });
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(0.7);
    expect(result.reasoning).toContain('no CI confirmation');
  });

  it('still detects misses from execution trace', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({ reverts: 2 }),
    });
    expect(result.result).toBe('missed_left');
    expect(result.reasoning).toContain('revert');
  });

  it('still detects over-scoping from execution trace', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        modified_files: ['packages/core/src/foo.ts', 'packages/cli/src/extra.ts'],
      }),
    });
    expect(result.result).toBe('missed_long');
  });
});

describe('classifyShotFromSignals — with CI signals', () => {
  it('upgrades to in_the_hole with passing CI', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI(),
    });
    expect(result.result).toBe('in_the_hole');
    expect(result.confidence).toBe(1.0);
    expect(result.reasoning).toContain('CI confirms');
    expect(result.reasoning).toContain('100/100');
  });

  it('keeps green when CI has retries', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI({ retries: 2 }),
    });
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(0.8);
    expect(result.reasoning).toContain('retry');
  });

  it('detects missed_right from CI test failures', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI({ test_failed: 3, test_passed: 97 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.miss_direction).toBe('right');
    expect(result.reasoning).toContain('3 test failure');
  });

  it('enriches trace miss with CI confirmation', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        test_results: [
          { suite: 'core', passed: false, first_run: true },
          { suite: 'cli', passed: true, first_run: true },
        ],
      }),
      ci: passingCI({ test_failed: 5 }),
    });
    expect(result.result).toBe('missed_right');
    expect(result.reasoning).toContain('CI confirms');
  });
});

describe('classifyShotFromSignals — with events', () => {
  it('detects missed_left from dead_end events', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      events: [
        makeEvent('dead_end', { approach: 'REST API v1' }),
        makeEvent('dead_end', { approach: 'GraphQL attempt' }),
      ],
    });
    expect(result.result).toBe('missed_left');
    expect(result.miss_direction).toBe('left');
    expect(result.reasoning).toContain('dead end');
  });

  it('detects missed_right from many failure events', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      events: [
        makeEvent('failure', { error: 'build' }),
        makeEvent('failure', { error: 'test' }),
        makeEvent('failure', { error: 'lint' }),
      ],
    });
    expect(result.result).toBe('missed_right');
    expect(result.reasoning).toContain('3 failure events');
  });

  it('detects missed_long from scope_change events', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      events: [
        makeEvent('scope_change', { reason: 'need to also fix related component' }),
      ],
    });
    expect(result.result).toBe('missed_long');
    expect(result.reasoning).toContain('scope change');
  });

  it('ignores non-miss event types (decision, compaction, hazard)', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI(),
      events: [
        makeEvent('decision', { choice: 'use pattern X' }),
        makeEvent('compaction', { tokens: 50000 }),
        makeEvent('hazard', { desc: 'flaky test' }),
      ],
    });
    expect(result.result).toBe('in_the_hole');
  });

  it('does not trigger failure miss with < 3 failures', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace(),
      ci: passingCI(),
      events: [
        makeEvent('failure', { error: 'build' }),
        makeEvent('failure', { error: 'test' }),
      ],
    });
    // 2 failures is not enough to trigger the miss
    expect(result.result).toBe('in_the_hole');
  });
});

describe('classifyShotFromSignals — combined enrichment', () => {
  it('enriches trace miss with event data', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({ reverts: 1 }),
      events: [
        makeEvent('failure', { error: 'test' }),
      ],
    });
    expect(result.result).toBe('missed_left');
    expect(result.reasoning).toContain('failure event');
  });

  it('boosts confidence when multiple sources agree', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        test_results: [
          { suite: 'core', passed: false, first_run: true },
          { suite: 'cli', passed: true, first_run: true },
        ],
      }),
      ci: passingCI({ test_failed: 2 }),
      events: [makeEvent('failure', { error: 'build' })],
    });
    expect(result.result).toBe('missed_right');
    // All 3 sources agree (trace, CI, events) — confidence should be high
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('preserves green when trace has hazards requiring rework', () => {
    const result = classifyShotFromSignals({
      trace: cleanTrace({
        hazards_encountered: [{ type: 'rough', description: 'flaky test' }],
        test_results: [{ suite: 'core', passed: true, first_run: false }],
      }),
      ci: passingCI(),
    });
    expect(result.result).toBe('green');
    expect(result.reasoning).toContain('hazards');
  });
});

```

## tests/core/vision.test.ts (score: 0.551)
```
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadVision, saveVision, validateVision } from '../../src/core/vision.js';
import type { VisionDocument } from '../../src/core/analyzers/types.js';

function makeVision(overrides: Partial<VisionDocument> = {}): VisionDocument {
  return {
    purpose: 'Build a sprint scoring engine',
    priorities: ['reliability', 'developer experience'],
    createdAt: '2026-02-25T00:00:00.000Z',
    updatedAt: '2026-02-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('loadVision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-vision-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no vision exists', () => {
    expect(loadVision(tmpDir)).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/vision.json'), 'bad json');
    expect(loadVision(tmpDir)).toBeNull();
  });

  it('loads a saved vision', () => {
    const vision = makeVision();
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/vision.json'), JSON.stringify(vision));
    const loaded = loadVision(tmpDir);
    expect(loaded).toEqual(vision);
  });
});

describe('saveVision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-vision-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .slope dir and writes vision', () => {
    const vision = makeVision();
    saveVision(vision, tmpDir);
    expect(existsSync(join(tmpDir, '.slope/vision.json'))).toBe(true);
    const loaded = loadVision(tmpDir);
    expect(loaded).toEqual(vision);
  });

  it('round-trips through save and load', () => {
    const vision = makeVision({ audience: 'engineering teams', nonGoals: ['project management'] });
    saveVision(vision, tmpDir);
    const loaded = loadVision(tmpDir);
    expect(loaded).toEqual(vision);
    expect(loaded!.audience).toBe('engineering teams');
    expect(loaded!.nonGoals).toEqual(['project management']);
  });
});

describe('validateVision', () => {
  it('passes for valid vision', () => {
    const errors = validateVision(makeVision());
    expect(errors).toHaveLength(0);
  });

  it('rejects non-object', () => {
    const errors = validateVision('not an object');
    expect(errors).toContain('Vision must be an object');
  });

  it('rejects null', () => {
    const errors = validateVision(null);
    expect(errors).toContain('Vision must be an object');
  });

  it('rejects missing purpose', () => {
    const errors = validateVision({ priorities: [] });
    expect(errors.some(e => e.includes('purpose'))).toBe(true);
  });

  it('rejects empty purpose', () => {
    const errors = validateVision({ purpose: '', priorities: [] });
    expect(errors.some(e => e.includes('purpose'))).toBe(true);
  });

  it('rejects non-array priorities', () => {
    const errors = validateVision({ purpose: 'test', priorities: 'not array' });
    expect(errors.some(e => e.includes('priorities must be an array'))).toBe(true);
  });

  it('rejects non-string priority items', () => {
    const errors = validateVision({ purpose: 'test', priorities: [123] });
    expect(errors.some(e => e.includes('priorities[0] must be a string'))).toBe(true);
  });

  it('rejects invalid date format', () => {
    const errors = validateVision({ purpose: 'test', priorities: [], createdAt: 'not-a-date' });
    expect(errors.some(e => e.includes('createdAt'))).toBe(true);
  });
});

```

## tests/adapters.test.ts (score: 0.550)
```
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  // Framework functions
  getAdapter,
  listAdapters,
  detectAdapter,
  clearAdapters,
  registerAdapter,
  resolveToolMatcher,
  ADAPTER_PRIORITY,
  TOOL_CATEGORIES,
  CLAUDE_CODE_TOOLS,
  // Adapter classes + singletons
  ClaudeCodeAdapter,
  claudeCodeAdapter,
  CursorAdapter,
  cursorAdapter,
  WindsurfAdapter,
  windsurfAdapter,
  ClineAdapter,
  clineAdapter,
  GenericAdapter,
  genericAdapter,
} from '../src/adapters.js';
import type { HarnessAdapter, HarnessId, ToolCategory, ToolNameMap, GuardManifestEntry } from '../src/adapters.js';

describe('adapters barrel export', () => {
  beforeEach(() => {
    clearAdapters();
    // Re-register all adapters (side-effect imports run once at module load,
    // but clearAdapters() removes them — re-register for each test)
    registerAdapter(new ClaudeCodeAdapter());
    registerAdapter(new CursorAdapter());
    registerAdapter(new WindsurfAdapter());
    registerAdapter(new ClineAdapter());
    registerAdapter(new GenericAdapter());
  });

  it('getAdapter("claude-code") returns ClaudeCodeAdapter instance', () => {
    const adapter = getAdapter('claude-code');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
  });

  it('getAdapter("cursor") returns CursorAdapter instance', () => {
    const adapter = getAdapter('cursor');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(CursorAdapter);
  });

  it('getAdapter("windsurf") returns WindsurfAdapter instance', () => {
    const adapter = getAdapter('windsurf');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(WindsurfAdapter);
  });

  it('getAdapter("cline") returns ClineAdapter instance', () => {
    const adapter = getAdapter('cline');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(ClineAdapter);
  });

  it('getAdapter("generic") returns GenericAdapter instance', () => {
    const adapter = getAdapter('generic');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(GenericAdapter);
  });

  it('getAdapter("unknown-harness") returns undefined', () => {
    expect(getAdapter('unknown-harness')).toBeUndefined();
  });

  it('listAdapters() includes all 5 built-in adapters', () => {
    const ids = listAdapters();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('windsurf');
    expect(ids).toContain('cline');
    expect(ids).toContain('generic');
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });

  it('detectAdapter() works after barrel import (side-effect registration)', () => {
    // detectAdapter with no matching dirs should fall back to generic
    const adapter = detectAdapter('/tmp/nonexistent-dir-12345');
    expect(adapter?.id).toBe('generic');
  });

  it('exports framework constants', () => {
    expect(ADAPTER_PRIORITY).toContain('claude-code');
    expect(ADAPTER_PRIORITY).toContain('cline');
    expect(ADAPTER_PRIORITY).toContain('generic');
    expect(TOOL_CATEGORIES.length).toBe(7);
    expect(CLAUDE_CODE_TOOLS.read_file).toBe('Read');
  });

  it('ADAPTER_PRIORITY has cline before generic', () => {
    const clineIdx = ADAPTER_PRIORITY.indexOf('cline');
    const genericIdx = ADAPTER_PRIORITY.indexOf('generic');
    expect(clineIdx).toBeGreaterThan(-1);
    expect(clineIdx).toBeLessThan(genericIdx);
  });

  it('exports singleton instances', () => {
    expect(claudeCodeAdapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(cursorAdapter).toBeInstanceOf(CursorAdapter);
    expect(windsurfAdapter).toBeInstanceOf(WindsurfAdapter);
    expect(clineAdapter).toBeInstanceOf(ClineAdapter);
    expect(genericAdapter).toBeInstanceOf(GenericAdapter);
  });

  it('exports resolveToolMatcher', () => {
    const adapter = getAdapter('claude-code')!;
    const result = resolveToolMatcher(adapter, ['read_file']);
    expect(result).toBe('Read');
  });

  it('detection conflict: .cursor/ + .clinerules/hooks/ → CursorAdapter wins (higher priority)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-conflict-'));
    mkdirSync(join(tmpDir, '.cursor'));
    mkdirSync(join(tmpDir, '.clinerules', 'hooks'), { recursive: true });
    const detected = detectAdapter(tmpDir);
    expect(detected).toBeDefined();
    expect(detected!.id).toBe('cursor');
  });

  it('detection: .clinerules/hooks/ only → ClineAdapter', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-only-'));
    mkdirSync(join(tmpDir, '.clinerules', 'hooks'), { recursive: true });
    const detected = detectAdapter(tmpDir);
    expect(detected).toBeDefined();
    expect(detected!.id).toBe('cline');
  });
});

```

