import { describe, it, expect } from 'vitest';
import { formatSprintReview, formatAdvisorReport } from '../src/formatter.js';
import type { GolfScorecard, ShotRecord, ClubRecommendation, TrainingRecommendation } from '../src/types.js';
import type { ProjectStats, ProjectStatsDelta } from '../src/formatter.js';
import { golf, gaming } from '../src/metaphors/index.js';

// --- Helpers ---

function makeShot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    ticket_key: 'S168-1',
    title: 'Test ticket',
    club: 'short_iron',
    result: 'green',
    hazards: [],
    ...overrides,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 168,
    theme: 'Test Sprint',
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    date: '2026-02-19',
    shots: [makeShot(), makeShot(), makeShot(), makeShot()],
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 4,
      fairways_total: 4,
      greens_in_regulation: 4,
      greens_total: 4,
      putts: 0,
      penalties: 0,
      hazards_hit: 0,
      hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

function makeProjectStats(overrides: ProjectStats = {}): ProjectStats {
  return {
    Endpoints: 168,
    Rules: 21,
    'Job Queues': 5,
    'Mobile Screens': 50,
    'Bootstrap Phases': 11,
    Tests: { orchestrator: 1184, mobile: 1588, shared: 74, bootstrap: 121 },
    Migrations: 44,
    'Sprints Completed': 168,
    ...overrides,
  };
}

// --- Tests ---

describe('formatSprintReview', () => {
  it('includes header with sprint number and theme', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats());
    expect(output).toContain('## Sprint 168 Review: Test Sprint');
  });

  it('includes SLOPE scorecard summary table', () => {
    const output = formatSprintReview(makeCard({ par: 4, score: 5, score_label: 'bogey' }), makeProjectStats());
    expect(output).toContain('| Par | 4 |');
    expect(output).toContain('| Score | 5 |');
    expect(output).toContain('| Label | bogey |');
  });

  it('includes project stats counts', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats({ Endpoints: 170, Rules: 22 }));
    expect(output).toContain('| Endpoints | 170 |');
    expect(output).toContain('| Rules | 22 |');
  });

  it('shows deltas when provided', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats(), { Endpoints: 2, Tests: 42 });
    expect(output).toContain('| Endpoints | 168 | +2 |');
    expect(output).toContain('| Tests | 2967 | +42 |');
  });

  it('shows dash for missing deltas', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats());
    expect(output).toContain('| Endpoints | 168 | \u2014 |');
  });

  it('includes shot-by-shot table', () => {
    const shots = [
      makeShot({ ticket_key: 'S168-1', club: 'wedge', result: 'in_the_hole', notes: 'Clean' }),
      makeShot({ ticket_key: 'S168-2', club: 'short_iron', result: 'green' }),
    ];
    const output = formatSprintReview(makeCard({ shots }), makeProjectStats());
    expect(output).toContain('| S168-1 | wedge | in_the_hole | \u2014 | Clean |');
    expect(output).toContain('| S168-2 | short_iron | green | \u2014 | \u2014 |');
  });

  it('includes hazards in shot-by-shot table', () => {
    const shots = [
      makeShot({ hazards: [{ type: 'bunker', description: 'migration conflict' }] }),
    ];
    const output = formatSprintReview(makeCard({ shots }), makeProjectStats());
    expect(output).toContain('bunker: migration conflict');
  });

  it('includes miss pattern section when misses exist', () => {
    const card = makeCard({
      stats: {
        fairways_hit: 2, fairways_total: 4, greens_in_regulation: 2, greens_total: 4,
        putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
        miss_directions: { long: 2, short: 0, left: 1, right: 0 },
      },
    });
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('### Miss Pattern');
    expect(output).toContain('Long (over-engineered) | 2');
    expect(output).toContain('Left (wrong approach) | 1');
    expect(output).not.toContain('Short (under-scoped)');
  });

  it('omits miss pattern section when no misses', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats());
    expect(output).not.toContain('### Miss Pattern');
  });

  it('includes conditions when present', () => {
    const card = makeCard({
      conditions: [{ type: 'wind', description: 'Scope expanded', impact: 'minor' }],
    });
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('### Conditions');
    expect(output).toContain('| wind | minor | Scope expanded |');
  });

  it('includes bunker locations', () => {
    const card = makeCard({ bunker_locations: ['Watch out for X', 'Be careful with Y'] });
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('- Watch out for X');
    expect(output).toContain('- Be careful with Y');
  });

  it('includes training log', () => {
    const card = makeCard({
      training: [{ type: 'lessons', description: 'Studied specs', outcome: 'Learned things' }],
    });
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('### Training Log');
    expect(output).toContain('| lessons | Studied specs | Learned things |');
  });

  it('includes nutrition check', () => {
    const card = makeCard({
      nutrition: [{ category: 'hydration', description: 'Deps updated', status: 'healthy' }],
    });
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('### Nutrition Check');
    expect(output).toContain('| hydration | healthy | Deps updated |');
  });

  it('includes 19th hole', () => {
    const card = makeCard({
      nineteenth_hole: { how_did_it_feel: 'Great', advice_for_next_player: 'Do X' },
    });
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('### 19th Hole');
    expect(output).toContain('**How did it feel?** Great');
    expect(output).toContain('**Advice for next player?** Do X');
  });

  it('produces technical output by default (unchanged)', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats());
    expect(output).toContain('### SLOPE Scorecard Summary');
    expect(output).toContain('| Par | 4 |');
  });

  it('produces technical output with explicit mode', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats(), undefined, 'technical');
    expect(output).toContain('### SLOPE Scorecard Summary');
  });

  it('produces plain mode output', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats(), undefined, 'plain');
    expect(output).not.toContain('SLOPE Scorecard');
    expect(output).toContain('## Sprint 168: Test Sprint');
    expect(output).toContain('On schedule');
  });

  it('translates shot results in plain mode', () => {
    const shots = [
      makeShot({ ticket_key: 'S168-1', result: 'in_the_hole' }),
      makeShot({ ticket_key: 'S168-2', result: 'missed_long' }),
    ];
    const output = formatSprintReview(makeCard({ shots }), makeProjectStats(), undefined, 'plain');
    expect(output).toContain('Completed perfectly');
    expect(output).toContain('Over-engineered');
    expect(output).not.toContain('in_the_hole');
    expect(output).not.toContain('missed_long');
  });

  it('translates club names in plain mode', () => {
    const shots = [
      makeShot({ club: 'driver' }),
      makeShot({ club: 'putter' }),
    ];
    const output = formatSprintReview(makeCard({ shots }), makeProjectStats(), undefined, 'plain');
    expect(output).toContain('High-risk approach');
    expect(output).toContain('Trivial fix');
    expect(output).not.toContain('| driver |');
    expect(output).not.toContain('| putter |');
  });

  it('translates score labels in plain mode', () => {
    const output = formatSprintReview(
      makeCard({ score_label: 'bogey' }),
      makeProjectStats(),
      undefined,
      'plain',
    );
    expect(output).toContain('Took longer than expected');
    expect(output).not.toContain('bogey');
  });

  it('hides internal fields in plain mode', () => {
    const shots = [
      makeShot({ hazards: [{ type: 'bunker', description: 'issue', gotcha_id: 'g-042' }] }),
    ];
    const output = formatSprintReview(makeCard({ shots }), makeProjectStats(), undefined, 'plain');
    expect(output).not.toContain('gotcha_id');
    expect(output).not.toContain('g-042');
    expect(output).not.toContain('scope_paths');
  });

  it('includes reflection in plain mode', () => {
    const card = makeCard({
      nineteenth_hole: { how_did_it_feel: 'Great sprint', excited_about_next: 'More advisor work' },
    });
    const output = formatSprintReview(card, makeProjectStats(), undefined, 'plain');
    expect(output).toContain('### Reflection');
    expect(output).toContain('Great sprint');
  });

  it('handles retro JSON with sprint field instead of sprint_number', () => {
    const card = { ...makeCard(), sprint: 167, sprint_number: undefined } as any;
    delete card.sprint_number;
    const output = formatSprintReview(card, makeProjectStats());
    expect(output).toContain('## Sprint 167 Review:');
  });

  it('includes test count breakdown', () => {
    const output = formatSprintReview(makeCard(), makeProjectStats());
    expect(output).toContain('1184 orchestrator + 1588 mobile + 74 shared + 121 bootstrap');
  });

  it('skips project stats section when not provided', () => {
    const output = formatSprintReview(makeCard());
    expect(output).toContain('### SLOPE Scorecard Summary');
    expect(output).not.toContain('### Project Stats');
    expect(output).toContain('### Shot-by-Shot');
  });
});

// --- formatAdvisorReport ---

describe('formatAdvisorReport', () => {
  it('formats club recommendation with high confidence', () => {
    const rec: ClubRecommendation = {
      club: 'short_iron',
      confidence: 1.0,
      reasoning: 'medium complexity \u2192 short_iron',
    };
    const output = formatAdvisorReport({ clubRecommendation: rec });
    expect(output).toContain('### CLUB RECOMMENDATION');
    expect(output).toContain('**Club:** short_iron');
    expect(output).toContain('**Confidence:** 100%');
    expect(output).toContain('medium complexity \u2192 short_iron');
  });

  it('formats club recommendation with low confidence', () => {
    const rec: ClubRecommendation = {
      club: 'wedge',
      confidence: 0.5,
      reasoning: 'small complexity \u2192 wedge',
    };
    const output = formatAdvisorReport({ clubRecommendation: rec });
    expect(output).toContain('**Confidence:** 50%');
  });

  it('includes provisional suggestion when present', () => {
    const rec: ClubRecommendation = {
      club: 'long_iron',
      confidence: 0.7,
      reasoning: 'large complexity \u2192 long_iron',
      provisional_suggestion: 'Consider declaring provisional \u2014 this area has 40% miss rate',
    };
    const output = formatAdvisorReport({ clubRecommendation: rec });
    expect(output).toContain('> Consider declaring provisional');
  });

  it('omits provisional suggestion when absent', () => {
    const rec: ClubRecommendation = {
      club: 'short_iron',
      confidence: 1.0,
      reasoning: 'medium complexity \u2192 short_iron',
    };
    const output = formatAdvisorReport({ clubRecommendation: rec });
    expect(output).not.toContain('>');
  });

  it('formats multi-item training plan', () => {
    const plan: TrainingRecommendation[] = [
      { area: 'Dominant miss: long', type: 'chipping_practice', description: 'Over-eng', priority: 'high', instruction_adjustment: 'Reduce scope per ticket.' },
      { area: 'Club: driver', type: 'driving_range', description: '60% miss', priority: 'medium', instruction_adjustment: 'Avoid driver complexity.' },
    ];
    const output = formatAdvisorReport({ trainingPlan: plan });
    expect(output).toContain('### TRAINING RECOMMENDATIONS');
    expect(output).toContain('| high | Dominant miss: long | chipping_practice | Reduce scope per ticket. |');
    expect(output).toContain('| medium | Club: driver | driving_range | Avoid driver complexity. |');
  });

  it('omits training section for empty plan', () => {
    const output = formatAdvisorReport({ trainingPlan: [] });
    expect(output).not.toContain('### TRAINING RECOMMENDATIONS');
  });

  it('filters out low-priority training items', () => {
    const plan: TrainingRecommendation[] = [
      { area: 'Minor thing', type: 'lessons', description: 'Low pri', priority: 'low' },
    ];
    const output = formatAdvisorReport({ trainingPlan: plan });
    expect(output).not.toContain('### TRAINING RECOMMENDATIONS');
  });

  it('formats hazard warnings', () => {
    const warnings = [
      'WARNING: bunker \u2014 migration DDL is tricky (seen in S170)',
      'WARNING: rough \u2014 WebSocket timing (seen in S171)',
    ];
    const output = formatAdvisorReport({ hazardWarnings: warnings });
    expect(output).toContain('### HAZARD WARNINGS');
    expect(output).toContain('- WARNING: bunker \u2014 migration DDL is tricky (seen in S170)');
    expect(output).toContain('- WARNING: rough \u2014 WebSocket timing (seen in S171)');
  });

  it('formats all sections combined', () => {
    const output = formatAdvisorReport({
      clubRecommendation: { club: 'short_iron', confidence: 0.7, reasoning: 'medium complexity \u2192 short_iron' },
      trainingPlan: [{ area: 'Trend', type: 'lessons', description: 'Getting worse', priority: 'high', instruction_adjustment: 'Review retros.' }],
      hazardWarnings: ['WARNING: bunker \u2014 tricky area'],
    });
    expect(output).toContain('### CLUB RECOMMENDATION');
    expect(output).toContain('### TRAINING RECOMMENDATIONS');
    expect(output).toContain('### HAZARD WARNINGS');
  });

  it('returns empty string when all inputs empty/undefined', () => {
    const output = formatAdvisorReport({});
    expect(output).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════
// Metaphor-aware formatting
// ═══════════════════════════════════════════════════════════

describe('formatSprintReview — metaphor-aware', () => {
  it('golf metaphor uses golf display terms', () => {
    const card = makeCard({
      shots: [makeShot({ club: 'short_iron', result: 'in_the_hole' })],
      stats: {
        fairways_hit: 1, fairways_total: 1,
        greens_in_regulation: 1, greens_total: 1,
        putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
        miss_directions: { long: 0, short: 0, left: 0, right: 0 },
      },
      nineteenth_hole: { how_did_it_feel: 'Great' },
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', golf);
    expect(output).toContain('Short Iron');
    expect(output).toContain('In the Hole');
    expect(output).toContain('### 19th Hole');
    expect(output).toContain('| Label | Par |');
  });

  it('gaming metaphor uses gaming display terms', () => {
    const card = makeCard({
      shots: [makeShot({ club: 'driver', result: 'in_the_hole' })],
      stats: {
        fairways_hit: 1, fairways_total: 1,
        greens_in_regulation: 1, greens_total: 1,
        putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
        miss_directions: { long: 0, short: 0, left: 0, right: 0 },
      },
      nineteenth_hole: { how_did_it_feel: 'Epic' },
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', gaming);
    expect(output).toContain('Boss Fight');
    expect(output).toContain('S-Rank');
    expect(output).toContain('### Save Point');
    expect(output).toContain('| Label | B-Rank |');
  });

  it('no metaphor uses raw enum values (backward compat)', () => {
    const card = makeCard({
      shots: [makeShot({ club: 'short_iron', result: 'green' })],
      stats: {
        fairways_hit: 1, fairways_total: 1,
        greens_in_regulation: 1, greens_total: 1,
        putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
        miss_directions: { long: 0, short: 0, left: 0, right: 0 },
      },
    });
    const output = formatSprintReview(card);
    expect(output).toContain('| short_iron |');
    expect(output).toContain('| green |');
  });

  it('gaming metaphor translates hazard types', () => {
    const card = makeCard({
      shots: [makeShot({
        club: 'short_iron',
        result: 'green',
        hazards: [{ type: 'rough', description: 'Bad timing' }],
      })],
      stats: {
        fairways_hit: 1, fairways_total: 1,
        greens_in_regulation: 1, greens_total: 1,
        putts: 0, penalties: 0, hazards_hit: 1, hazard_penalties: 0,
        miss_directions: { long: 0, short: 0, left: 0, right: 0 },
      },
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', gaming);
    expect(output).toContain('Lag: Bad timing');
    expect(output).toContain('| Lag |');
  });

  it('gaming metaphor translates condition types', () => {
    const card = makeCard({
      conditions: [{ type: 'wind', description: 'Changing reqs', impact: 'minor' as const }],
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', gaming);
    expect(output).toContain('| RNG |');
  });

  it('gaming metaphor translates miss directions', () => {
    const card = makeCard({
      shots: [makeShot({ result: 'missed_long' })],
      stats: {
        fairways_hit: 0, fairways_total: 1,
        greens_in_regulation: 0, greens_total: 1,
        putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
        miss_directions: { long: 1, short: 0, left: 0, right: 0 },
      },
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', gaming);
    expect(output).toContain('Over-leveled (too much scope)');
  });

  it('gaming metaphor translates nutrition categories', () => {
    const card = makeCard({
      nutrition: [{ category: 'hydration', description: 'Good', status: 'healthy' }],
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', gaming);
    expect(output).toContain('| Mana |');
  });

  it('gaming metaphor translates training types', () => {
    const card = makeCard({
      training: [{ type: 'driving_range', description: 'Research', outcome: 'Found pattern' }],
    });
    const output = formatSprintReview(card, undefined, undefined, 'technical', gaming);
    expect(output).toContain('| Exploration |');
  });
});

describe('formatAdvisorReport — metaphor-aware', () => {
  it('gaming metaphor translates club name', () => {
    const output = formatAdvisorReport(
      { clubRecommendation: { club: 'driver', confidence: 0.8, reasoning: 'High complexity' } },
      gaming,
    );
    expect(output).toContain('**Club:** Boss Fight');
  });

  it('gaming metaphor translates training types', () => {
    const plan: TrainingRecommendation[] = [
      { area: 'Scope', type: 'chipping_practice', description: 'Practice', priority: 'high' },
    ];
    const output = formatAdvisorReport({ trainingPlan: plan }, gaming);
    expect(output).toContain('Combo Practice');
  });

  it('no metaphor uses raw values (backward compat)', () => {
    const output = formatAdvisorReport(
      { clubRecommendation: { club: 'driver', confidence: 0.8, reasoning: 'High complexity' } },
    );
    expect(output).toContain('**Club:** driver');
  });
});
