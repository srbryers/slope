import { describe, it, expect } from 'vitest';
import { validateScorecard } from '../src/validation.js';
import type { GolfScorecard, ShotRecord, HoleStats } from '../src/types.js';

// --- Test helpers ---

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
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    ...overrides,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  const shots = overrides.shots ?? [
    makeShot({ result: 'fairway' }),
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
    training: [{ type: 'lessons', description: 'test', outcome: 'ok' }],
    nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
    yardage_book_updates: [],
    bunker_locations: ['Test bunker'],
    course_management_notes: [],
    ...overrides,
  };
}

// --- Rule 1: score_label matches computeScoreLabel ---

describe('validateScorecard - score_label', () => {
  it('passes when score_label matches computed value', () => {
    const result = validateScorecard(makeCard({ score: 4, par: 4, score_label: 'par' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when score_label is wrong', () => {
    const result = validateScorecard(makeCard({ score: 5, par: 4, score_label: 'par' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'SCORE_LABEL_MISMATCH')).toBe(true);
  });

  it('passes for triple_plus with score 3+ over par', () => {
    const shots = Array.from({ length: 4 }, () => makeShot());
    const result = validateScorecard(makeCard({
      score: 7, par: 4, score_label: 'triple_plus', shots,
      stats: makeStats({ fairways_total: 4 }),
    }));
    expect(result.errors.filter(e => e.code === 'SCORE_LABEL_MISMATCH')).toHaveLength(0);
  });
});

// --- Rule 2: stat bounds ---

describe('validateScorecard - stat bounds', () => {
  it('fails when fairways_hit > fairways_total', () => {
    const result = validateScorecard(makeCard({
      stats: makeStats({ fairways_hit: 5, fairways_total: 4 }),
    }));
    expect(result.errors.some(e => e.code === 'FAIRWAYS_OVERFLOW')).toBe(true);
  });

  it('fails when GIR > greens_total', () => {
    const result = validateScorecard(makeCard({
      stats: makeStats({ greens_in_regulation: 5, greens_total: 4 }),
    }));
    expect(result.errors.some(e => e.code === 'GIR_OVERFLOW')).toBe(true);
  });

  it('passes when stats are within bounds', () => {
    const result = validateScorecard(makeCard());
    expect(result.errors.filter(e => e.code === 'FAIRWAYS_OVERFLOW')).toHaveLength(0);
    expect(result.errors.filter(e => e.code === 'GIR_OVERFLOW')).toHaveLength(0);
  });
});

// --- Rule 3: shots.length matches fairways_total ---

describe('validateScorecard - shots count', () => {
  it('fails when shots.length != fairways_total', () => {
    const result = validateScorecard(makeCard({
      shots: [makeShot(), makeShot()],
      stats: makeStats({ fairways_total: 4 }),
    }));
    expect(result.errors.some(e => e.code === 'SHOTS_COUNT_MISMATCH')).toBe(true);
  });

  it('passes when shots.length matches fairways_total', () => {
    const result = validateScorecard(makeCard());
    expect(result.errors.filter(e => e.code === 'SHOTS_COUNT_MISMATCH')).toHaveLength(0);
  });
});

// --- Rule 4: hazards consistency ---

describe('validateScorecard - hazards count', () => {
  it('fails when hazards_hit != total hazards from shots', () => {
    const shots = [
      makeShot({ hazards: [{ type: 'bunker', description: 'test' }] }),
      makeShot(),
    ];
    const result = validateScorecard(makeCard({
      shots,
      stats: makeStats({ fairways_total: 2, fairways_hit: 2, hazards_hit: 0 }),
    }));
    expect(result.errors.some(e => e.code === 'HAZARDS_COUNT_MISMATCH')).toBe(true);
  });

  it('passes when hazards_hit matches shot hazards', () => {
    const shots = [
      makeShot({ hazards: [{ type: 'bunker', description: 'test' }] }),
      makeShot(),
      makeShot(),
    ];
    const result = validateScorecard(makeCard({
      shots,
      stats: makeStats({ fairways_total: 3, hazards_hit: 1 }),
    }));
    expect(result.errors.filter(e => e.code === 'HAZARDS_COUNT_MISMATCH')).toHaveLength(0);
  });
});

// --- Rule 5: miss_directions consistency ---

describe('validateScorecard - miss directions', () => {
  it('fails when miss_directions dont match shot results', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'green' }),
    ];
    const result = validateScorecard(makeCard({
      shots,
      stats: makeStats({ fairways_total: 3, miss_directions: { long: 1, short: 0, left: 0, right: 0 } }),
    }));
    expect(result.errors.some(e => e.code === 'MISS_DIRECTION_MISMATCH' && e.field === 'stats.miss_directions.long')).toBe(true);
  });

  it('passes when miss_directions match shot results', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'in_the_hole' }),
    ];
    const result = validateScorecard(makeCard({
      shots,
      stats: makeStats({ fairways_total: 4, miss_directions: { long: 1, short: 1, left: 0, right: 0 } }),
    }));
    expect(result.errors.filter(e => e.code === 'MISS_DIRECTION_MISMATCH')).toHaveLength(0);
  });

  it('validates all four miss directions independently', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'missed_left' }),
      makeShot({ result: 'missed_right' }),
    ];
    const result = validateScorecard(makeCard({
      shots,
      stats: makeStats({ fairways_total: 4, miss_directions: { long: 1, short: 1, left: 1, right: 1 } }),
    }));
    expect(result.errors.filter(e => e.code === 'MISS_DIRECTION_MISMATCH')).toHaveLength(0);
  });
});

// --- Rule 6: basic field validation ---

describe('validateScorecard - basic fields', () => {
  it('fails for invalid par value', () => {
    const result = validateScorecard(makeCard({ par: 2 as any }));
    expect(result.errors.some(e => e.code === 'INVALID_PAR')).toBe(true);
  });

  it('fails for score <= 0', () => {
    const result = validateScorecard(makeCard({ score: 0 }));
    expect(result.errors.some(e => e.code === 'INVALID_SCORE')).toBe(true);
  });

  it('fails for invalid date', () => {
    const result = validateScorecard(makeCard({ date: 'not-a-date' }));
    expect(result.errors.some(e => e.code === 'INVALID_DATE')).toBe(true);
  });

  it('passes for valid basic fields', () => {
    const result = validateScorecard(makeCard());
    const basicCodes = ['INVALID_PAR', 'INVALID_SCORE', 'INVALID_DATE', 'MISSING_SPRINT'];
    expect(result.errors.filter(e => basicCodes.includes(e.code))).toHaveLength(0);
  });
});

// --- Sprint field normalization ---

describe('validateScorecard - sprint field normalization', () => {
  it('accepts sprint_number field', () => {
    const result = validateScorecard(makeCard({ sprint_number: 167 }));
    expect(result.errors.filter(e => e.code === 'MISSING_SPRINT')).toHaveLength(0);
  });

  it('accepts sprint field from retro JSON', () => {
    const card = makeCard();
    // Simulate retro JSON that uses "sprint" instead of "sprint_number"
    const retroCard = { ...card, sprint: 167, sprint_number: undefined as any };
    delete retroCard.sprint_number;
    const result = validateScorecard(retroCard);
    expect(result.errors.filter(e => e.code === 'MISSING_SPRINT')).toHaveLength(0);
  });
});

// --- Rule 7: warnings ---

describe('validateScorecard - warnings', () => {
  it('warns on empty bunker_locations', () => {
    const result = validateScorecard(makeCard({ bunker_locations: [] }));
    expect(result.warnings.some(w => w.code === 'EMPTY_BUNKERS')).toBe(true);
  });

  it('warns on missing training', () => {
    const result = validateScorecard(makeCard({ training: [] }));
    expect(result.warnings.some(w => w.code === 'NO_TRAINING')).toBe(true);
  });

  it('warns on missing nutrition', () => {
    const result = validateScorecard(makeCard({ nutrition: [] }));
    expect(result.warnings.some(w => w.code === 'NO_NUTRITION')).toBe(true);
  });

  it('warns on missing player', () => {
    const result = validateScorecard(makeCard());
    expect(result.warnings.some(w => w.code === 'NO_PLAYER')).toBe(true);
  });

  it('no warnings when all optional fields present', () => {
    const result = validateScorecard(makeCard({ player: 'alice' }));
    expect(result.warnings).toHaveLength(0);
  });
});

// --- Full valid scorecard ---

describe('validateScorecard - integration', () => {
  it('validates a complete valid scorecard with no errors or warnings', () => {
    const result = validateScorecard(makeCard({ player: 'alice' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns multiple errors for a badly formed scorecard', () => {
    const result = validateScorecard(makeCard({
      par: 7 as any,
      score: 0,
      score_label: 'eagle',
      date: 'bad',
      shots: [],
      stats: makeStats({ fairways_total: 4, fairways_hit: 5, greens_in_regulation: 5, greens_total: 4 }),
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
