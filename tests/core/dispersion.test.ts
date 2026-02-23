import { describe, it, expect } from 'vitest';
import { computeDispersion, computeAreaPerformance } from '../../src/core/dispersion.js';
import type { GolfScorecard, ShotRecord, HoleStats } from '../../src/core/types.js';

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

function makeStats(overrides: Partial<HoleStats> = {}): HoleStats {
  return {
    fairways_hit: 3,
    fairways_total: 4,
    greens_in_regulation: 3,
    greens_total: 4,
    putts: 1,
    penalties: 0,
    hazards_hit: 0,
    hazard_penalties: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    ...overrides,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  const shots = overrides.shots ?? [
    makeShot({ result: 'green' }),
    makeShot({ result: 'green' }),
    makeShot({ result: 'in_the_hole' }),
    makeShot({ result: 'green' }),
  ];
  return {
    sprint_number: 168,
    theme: 'Test Sprint',
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    date: '2026-02-19',
    shots,
    conditions: [],
    special_plays: [],
    stats: overrides.stats ?? makeStats({ fairways_total: shots.length }),
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

// --- computeDispersion ---

describe('computeDispersion', () => {
  it('returns zeroed report for empty array', () => {
    const report = computeDispersion([]);
    expect(report.total_shots).toBe(0);
    expect(report.total_misses).toBe(0);
    expect(report.miss_rate_pct).toBe(0);
    expect(report.dominant_miss).toBeNull();
    expect(report.by_direction.long.count).toBe(0);
  });

  it('reports no misses when all shots are good', () => {
    const report = computeDispersion([makeCard()]);
    expect(report.total_shots).toBe(4);
    expect(report.total_misses).toBe(0);
    expect(report.miss_rate_pct).toBe(0);
    expect(report.dominant_miss).toBeNull();
  });

  it('counts misses by direction', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'green' }),
    ];
    const report = computeDispersion([makeCard({ shots })]);
    expect(report.total_shots).toBe(4);
    expect(report.total_misses).toBe(3);
    expect(report.by_direction.long.count).toBe(2);
    expect(report.by_direction.short.count).toBe(1);
    expect(report.by_direction.left.count).toBe(0);
  });

  it('identifies dominant miss direction (>40%)', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'green' }),
    ];
    const report = computeDispersion([makeCard({ shots })]);
    expect(report.dominant_miss).toBe('long');
  });

  it('returns null dominant when misses are evenly distributed', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'missed_left' }),
      makeShot({ result: 'missed_right' }),
    ];
    const report = computeDispersion([makeCard({ shots })]);
    // Each at 25%, none >40%
    expect(report.dominant_miss).toBeNull();
  });

  it('calculates miss_rate_pct correctly', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'green' }),
    ];
    const report = computeDispersion([makeCard({ shots })]);
    expect(report.miss_rate_pct).toBe(25);
  });

  it('includes insufficient data warning for < 5 scorecards', () => {
    const report = computeDispersion([makeCard()]);
    expect(report.systemic_issues.some(s => s.includes('Insufficient data'))).toBe(true);
  });

  it('no insufficient data warning for 5+ scorecards', () => {
    const cards = Array.from({ length: 5 }, () => makeCard());
    const report = computeDispersion(cards);
    expect(report.systemic_issues.some(s => s.includes('Insufficient data'))).toBe(false);
  });

  it('includes high miss rate warning when > 30%', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'green' }),
    ];
    const report = computeDispersion([makeCard({ shots })]);
    // 2/3 = 66.7%
    expect(report.systemic_issues.some(s => s.includes('High miss rate'))).toBe(true);
  });

  it('aggregates across multiple scorecards', () => {
    const card1 = makeCard({ shots: [makeShot({ result: 'missed_long' }), makeShot({ result: 'green' })] });
    const card2 = makeCard({ shots: [makeShot({ result: 'missed_left' }), makeShot({ result: 'green' })] });
    const report = computeDispersion([card1, card2]);
    expect(report.total_shots).toBe(4);
    expect(report.total_misses).toBe(2);
    expect(report.by_direction.long.count).toBe(1);
    expect(report.by_direction.left.count).toBe(1);
  });
});

// --- computeAreaPerformance ---

describe('computeAreaPerformance', () => {
  it('returns empty report for empty array', () => {
    const report = computeAreaPerformance([]);
    expect(Object.keys(report.by_sprint_type)).toHaveLength(0);
    expect(Object.keys(report.by_club)).toHaveLength(0);
    expect(Object.keys(report.par_performance)).toHaveLength(0);
  });

  it('groups by sprint type', () => {
    const feature = makeCard({ type: 'feature', score: 4, par: 4 });
    const feedback = makeCard({ type: 'feedback', score: 5, par: 4 });
    const report = computeAreaPerformance([feature, feedback]);
    expect(report.by_sprint_type['feature'].count).toBe(1);
    expect(report.by_sprint_type['feature'].avg_score_vs_par).toBe(0);
    expect(report.by_sprint_type['feedback'].count).toBe(1);
    expect(report.by_sprint_type['feedback'].avg_score_vs_par).toBe(1);
  });

  it('defaults to feature when type is undefined', () => {
    const card = makeCard();
    delete (card as any).type;
    const report = computeAreaPerformance([card]);
    expect(report.by_sprint_type['feature'].count).toBe(1);
  });

  it('groups by club selection', () => {
    const shots = [
      makeShot({ club: 'wedge', result: 'in_the_hole' }),
      makeShot({ club: 'wedge', result: 'green' }),
      makeShot({ club: 'short_iron', result: 'missed_long' }),
    ];
    const report = computeAreaPerformance([makeCard({ shots })]);
    expect(report.by_club['wedge'].count).toBe(2);
    expect(report.by_club['wedge'].in_the_hole_rate).toBe(50);
    expect(report.by_club['wedge'].miss_rate).toBe(0);
    expect(report.by_club['short_iron'].count).toBe(1);
    expect(report.by_club['short_iron'].miss_rate).toBe(100);
  });

  it('groups by par value', () => {
    const par3 = makeCard({ par: 3, score: 3, score_label: 'par' });
    const par4 = makeCard({ par: 4, score: 5, score_label: 'bogey' });
    const par5 = makeCard({ par: 5, score: 5, score_label: 'par' });
    const report = computeAreaPerformance([par3, par4, par5]);
    expect(report.par_performance[3].count).toBe(1);
    expect(report.par_performance[3].avg_score_vs_par).toBe(0);
    expect(report.par_performance[3].over_par_rate).toBe(0);
    expect(report.par_performance[4].count).toBe(1);
    expect(report.par_performance[4].avg_score_vs_par).toBe(1);
    expect(report.par_performance[4].over_par_rate).toBe(100);
    expect(report.par_performance[5].count).toBe(1);
    expect(report.par_performance[5].avg_score_vs_par).toBe(0);
  });

  it('calculates fairway and GIR percentages per type', () => {
    const card = makeCard({
      type: 'feature',
      stats: makeStats({ fairways_hit: 8, fairways_total: 10, greens_in_regulation: 7, greens_total: 10 }),
    });
    const report = computeAreaPerformance([card]);
    expect(report.by_sprint_type['feature'].fairway_pct).toBe(80);
    expect(report.by_sprint_type['feature'].gir_pct).toBe(70);
  });

  it('handles multiple scorecards of same type', () => {
    const card1 = makeCard({ type: 'feature', score: 4, par: 4 });
    const card2 = makeCard({ type: 'feature', score: 6, par: 4, score_label: 'double_bogey' });
    const report = computeAreaPerformance([card1, card2]);
    expect(report.by_sprint_type['feature'].count).toBe(2);
    expect(report.by_sprint_type['feature'].avg_score_vs_par).toBe(1); // (0+2)/2
  });
});
