import { describe, it, expect } from 'vitest';
import { computePar, computeSlope, computeScoreLabel, computeHandicapCard } from '../src/handicap.js';
import type { GolfScorecard } from '../src/types.js';

// --- Helper to build test scorecards ---

function makeScorecard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 167,
    theme: 'Test Sprint',
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    date: '2026-02-19',
    shots: [],
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 3,
      fairways_total: 4,
      greens_in_regulation: 3,
      greens_total: 4,
      putts: 1,
      penalties: 0,
      hazards_hit: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

// --- computePar ---

describe('computePar', () => {
  it('returns par 3 for 1 ticket', () => {
    expect(computePar(1)).toBe(3);
  });

  it('returns par 3 for 2 tickets', () => {
    expect(computePar(2)).toBe(3);
  });

  it('returns par 4 for 3 tickets', () => {
    expect(computePar(3)).toBe(4);
  });

  it('returns par 4 for 4 tickets', () => {
    expect(computePar(4)).toBe(4);
  });

  it('returns par 5 for 5 tickets', () => {
    expect(computePar(5)).toBe(5);
  });

  it('returns par 5 for 10 tickets', () => {
    expect(computePar(10)).toBe(5);
  });

  it('returns par 5 for 0 tickets (edge case)', () => {
    expect(computePar(0)).toBe(5);
  });
});

// --- computeSlope ---

describe('computeSlope', () => {
  it('returns 0 for no factors', () => {
    expect(computeSlope([])).toBe(0);
  });

  it('returns count of factors', () => {
    expect(computeSlope(['cross_package', 'schema_migration'])).toBe(2);
  });

  it('returns 5 for all factors', () => {
    expect(computeSlope([
      'cross_package', 'schema_migration', 'new_area', 'external_dep', 'concurrent_agents',
    ])).toBe(5);
  });
});

// --- computeScoreLabel ---

describe('computeScoreLabel', () => {
  it('returns eagle for 2 under par', () => {
    expect(computeScoreLabel(2, 4)).toBe('eagle');
  });

  it('returns eagle for 3+ under par', () => {
    expect(computeScoreLabel(1, 4)).toBe('eagle');
  });

  it('returns birdie for 1 under par', () => {
    expect(computeScoreLabel(3, 4)).toBe('birdie');
  });

  it('returns par for exact par', () => {
    expect(computeScoreLabel(4, 4)).toBe('par');
  });

  it('returns bogey for 1 over par', () => {
    expect(computeScoreLabel(5, 4)).toBe('bogey');
  });

  it('returns double_bogey for 2 over par', () => {
    expect(computeScoreLabel(6, 4)).toBe('double_bogey');
  });

  it('returns triple_plus for 3 over par', () => {
    expect(computeScoreLabel(7, 4)).toBe('triple_plus');
  });

  it('returns triple_plus for 5 over par', () => {
    expect(computeScoreLabel(9, 4)).toBe('triple_plus');
  });

  it('works with par 3', () => {
    expect(computeScoreLabel(3, 3)).toBe('par');
    expect(computeScoreLabel(2, 3)).toBe('birdie');
    expect(computeScoreLabel(4, 3)).toBe('bogey');
  });

  it('works with par 5', () => {
    expect(computeScoreLabel(5, 5)).toBe('par');
    expect(computeScoreLabel(3, 5)).toBe('eagle');
    expect(computeScoreLabel(7, 5)).toBe('double_bogey');
  });
});

// --- computeHandicapCard ---

describe('computeHandicapCard', () => {
  it('returns zeroed stats for 0 scorecards', () => {
    const card = computeHandicapCard([]);
    expect(card.last_5.handicap).toBe(0);
    expect(card.last_10.handicap).toBe(0);
    expect(card.all_time.handicap).toBe(0);
    expect(card.all_time.fairway_pct).toBe(0);
    expect(card.all_time.gir_pct).toBe(0);
    expect(card.all_time.avg_putts).toBe(0);
    expect(card.all_time.penalties_per_round).toBe(0);
    expect(card.all_time.miss_pattern).toEqual({ long: 0, short: 0, left: 0, right: 0 });
    expect(card.all_time.mulligans).toBe(0);
    expect(card.all_time.gimmes).toBe(0);
  });

  it('computes correctly for 1 scorecard at par', () => {
    const card = computeHandicapCard([makeScorecard()]);
    expect(card.last_5.handicap).toBe(0);
    expect(card.last_5.fairway_pct).toBe(75);
    expect(card.last_5.gir_pct).toBe(75);
    expect(card.last_5.avg_putts).toBe(1);
    expect(card.last_5.penalties_per_round).toBe(0);
  });

  it('computes handicap for bogey rounds', () => {
    const bogey = makeScorecard({ score: 5, par: 4, score_label: 'bogey' });
    const card = computeHandicapCard([bogey, bogey, bogey]);
    expect(card.all_time.handicap).toBe(1);
  });

  it('computes handicap for birdie rounds', () => {
    const birdie = makeScorecard({ score: 3, par: 4, score_label: 'birdie' });
    const card = computeHandicapCard([birdie]);
    // handicap floored at 0
    expect(card.all_time.handicap).toBe(0);
  });

  it('computes last_5 and last_10 windows correctly', () => {
    const scorecards: GolfScorecard[] = [];
    for (let i = 0; i < 20; i++) {
      const isLate = i >= 15; // last 5 are bogeys
      scorecards.push(makeScorecard({
        sprint_number: i + 1,
        score: isLate ? 5 : 4,
        par: 4,
      }));
    }

    const card = computeHandicapCard(scorecards);
    // last_5 are all bogeys (score 5, par 4 => diff +1)
    expect(card.last_5.handicap).toBe(1);
    // last_10 has 5 pars and 5 bogeys (avg diff = 0.5)
    expect(card.last_10.handicap).toBe(0.5);
    // all_time has 15 pars and 5 bogeys (avg diff = 5/20 = 0.25)
    expect(card.all_time.handicap).toBe(0.3); // rounded: 5/20 = 0.25 rounds to 0.3
  });

  it('aggregates miss patterns across scorecards', () => {
    const sc1 = makeScorecard({
      stats: {
        fairways_hit: 2, fairways_total: 3, greens_in_regulation: 2, greens_total: 3,
        putts: 1, penalties: 0, hazards_hit: 0,
        miss_directions: { long: 2, short: 0, left: 1, right: 0 },
      },
    });
    const sc2 = makeScorecard({
      stats: {
        fairways_hit: 3, fairways_total: 4, greens_in_regulation: 3, greens_total: 4,
        putts: 2, penalties: 1, hazards_hit: 1,
        miss_directions: { long: 0, short: 1, left: 0, right: 3 },
      },
    });

    const card = computeHandicapCard([sc1, sc2]);
    expect(card.all_time.miss_pattern).toEqual({ long: 2, short: 1, left: 1, right: 3 });
    // fairway: (2+3)/(3+4) = 5/7 = 71.4%
    expect(card.all_time.fairway_pct).toBe(71.4);
    // gir: (2+3)/(3+4) = 5/7 = 71.4%
    expect(card.all_time.gir_pct).toBe(71.4);
    // avg putts: (1+2)/2 = 1.5
    expect(card.all_time.avg_putts).toBe(1.5);
    // penalties: (0+1)/2 = 0.5
    expect(card.all_time.penalties_per_round).toBe(0.5);
  });

  it('counts mulligans and gimmes from special_plays', () => {
    const sc1 = makeScorecard({ special_plays: ['mulligan', 'gimme'] });
    const sc2 = makeScorecard({ special_plays: ['mulligan', 'mulligan'] });
    const sc3 = makeScorecard({ special_plays: ['provisional'] });

    const card = computeHandicapCard([sc1, sc2, sc3]);
    expect(card.all_time.mulligans).toBe(3);
    expect(card.all_time.gimmes).toBe(1);
  });

  it('handles all-bogey scorecards', () => {
    const scorecards = Array.from({ length: 10 }, (_, i) =>
      makeScorecard({ sprint_number: i + 1, score: 5, par: 4 }),
    );
    const card = computeHandicapCard(scorecards);
    expect(card.all_time.handicap).toBe(1);
    expect(card.last_5.handicap).toBe(1);
    expect(card.last_10.handicap).toBe(1);
  });

  it('handles all-par scorecards', () => {
    const scorecards = Array.from({ length: 10 }, (_, i) =>
      makeScorecard({ sprint_number: i + 1, score: 4, par: 4 }),
    );
    const card = computeHandicapCard(scorecards);
    expect(card.all_time.handicap).toBe(0);
  });

  it('handles mixed scores', () => {
    const scorecards = [
      makeScorecard({ score: 3, par: 4 }), // birdie
      makeScorecard({ score: 4, par: 4 }), // par
      makeScorecard({ score: 5, par: 4 }), // bogey
      makeScorecard({ score: 6, par: 4 }), // double bogey
      makeScorecard({ score: 4, par: 3 }), // bogey on par 3
    ];
    const card = computeHandicapCard(scorecards);
    // diffs: -1, 0, +1, +2, +1 = total 3, avg 0.6
    expect(card.all_time.handicap).toBe(0.6);
  });

  it('with fewer than 5 scorecards, last_5 and all_time match', () => {
    const scorecards = [makeScorecard(), makeScorecard()];
    const card = computeHandicapCard(scorecards);
    expect(card.last_5).toEqual(card.all_time);
    expect(card.last_10).toEqual(card.all_time);
  });

  it('with exactly 5 scorecards, last_5 equals all_time', () => {
    const scorecards = Array.from({ length: 5 }, () => makeScorecard());
    const card = computeHandicapCard(scorecards);
    expect(card.last_5).toEqual(card.all_time);
  });
});
