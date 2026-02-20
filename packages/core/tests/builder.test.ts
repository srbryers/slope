import { describe, it, expect } from 'vitest';
import { computeStatsFromShots, buildScorecard } from '../src/builder.js';
import type { ShotRecord } from '../src/types.js';

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

// --- computeStatsFromShots ---

describe('computeStatsFromShots', () => {
  it('returns zeroed stats for empty shots array', () => {
    const stats = computeStatsFromShots([]);
    expect(stats.fairways_hit).toBe(0);
    expect(stats.fairways_total).toBe(0);
    expect(stats.greens_in_regulation).toBe(0);
    expect(stats.greens_total).toBe(0);
    expect(stats.hazards_hit).toBe(0);
    expect(stats.putts).toBe(0);
    expect(stats.penalties).toBe(0);
    expect(stats.miss_directions).toEqual({ long: 0, short: 0, left: 0, right: 0 });
  });

  it('counts fairway results as fairways_hit', () => {
    const shots = [
      makeShot({ result: 'fairway' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'in_the_hole' }),
      makeShot({ result: 'missed_long' }),
    ];
    const stats = computeStatsFromShots(shots);
    expect(stats.fairways_hit).toBe(3);
    expect(stats.fairways_total).toBe(4);
  });

  it('counts green and in_the_hole as GIR', () => {
    const shots = [
      makeShot({ result: 'fairway' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'in_the_hole' }),
    ];
    const stats = computeStatsFromShots(shots);
    expect(stats.greens_in_regulation).toBe(2);
    expect(stats.greens_total).toBe(3);
  });

  it('counts hazards across all shots', () => {
    const shots = [
      makeShot({ hazards: [{ type: 'bunker', description: 'test' }, { type: 'water', description: 'test2' }] }),
      makeShot({ hazards: [{ type: 'rough', description: 'test3' }] }),
      makeShot(),
    ];
    const stats = computeStatsFromShots(shots);
    expect(stats.hazards_hit).toBe(3);
  });

  it('counts miss directions from shot results', () => {
    const shots = [
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'missed_short' }),
      makeShot({ result: 'missed_left' }),
      makeShot({ result: 'missed_right' }),
      makeShot({ result: 'green' }),
    ];
    const stats = computeStatsFromShots(shots);
    expect(stats.miss_directions).toEqual({ long: 2, short: 1, left: 1, right: 1 });
  });

  it('applies putts and penalties overrides', () => {
    const stats = computeStatsFromShots([makeShot()], { putts: 3, penalties: 1 });
    expect(stats.putts).toBe(3);
    expect(stats.penalties).toBe(1);
  });

  it('defaults putts and penalties to 0', () => {
    const stats = computeStatsFromShots([makeShot()]);
    expect(stats.putts).toBe(0);
    expect(stats.penalties).toBe(0);
  });

  it('matches Sprint 167 actual data', () => {
    // 11 shots, all fairway/green/in_the_hole, 2 hazards, 0 misses
    const shots: ShotRecord[] = [
      makeShot({ result: 'in_the_hole' }),
      makeShot({ result: 'green', hazards: [{ type: 'bunker', description: 'migration conflict' }] }),
      makeShot({ result: 'green', hazards: [{ type: 'rough', description: 'expo nav' }] }),
      makeShot({ result: 'in_the_hole' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'in_the_hole' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'in_the_hole' }),
      makeShot({ result: 'green' }),
      makeShot({ result: 'green' }),
    ];
    const stats = computeStatsFromShots(shots, { putts: 2 });
    expect(stats.fairways_hit).toBe(11);
    expect(stats.fairways_total).toBe(11);
    expect(stats.greens_in_regulation).toBe(11);  // all green or in_the_hole
    expect(stats.greens_total).toBe(11);
    expect(stats.hazards_hit).toBe(2);
    expect(stats.miss_directions).toEqual({ long: 0, short: 0, left: 0, right: 0 });
    expect(stats.putts).toBe(2);
  });
});

// --- buildScorecard ---

describe('buildScorecard', () => {
  it('computes score as shots.length + penalties', () => {
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 4,
      slope: 1,
      date: '2026-02-19',
      shots: [makeShot(), makeShot(), makeShot(), makeShot()],
      penalties: 1,
    });
    expect(card.score).toBe(5); // 4 shots + 1 penalty
  });

  it('computes score_label from score and par', () => {
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 4,
      slope: 1,
      date: '2026-02-19',
      shots: [makeShot(), makeShot(), makeShot(), makeShot()],
    });
    expect(card.score).toBe(4);
    expect(card.score_label).toBe('par');
  });

  it('computes stats from shots automatically', () => {
    const shots = [
      makeShot({ result: 'fairway' }),
      makeShot({ result: 'missed_long' }),
      makeShot({ result: 'in_the_hole', hazards: [{ type: 'bunker', description: 'test' }] }),
    ];
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 3,
      slope: 0,
      date: '2026-02-19',
      shots,
    });
    expect(card.stats.fairways_hit).toBe(2);
    expect(card.stats.fairways_total).toBe(3);
    expect(card.stats.greens_in_regulation).toBe(1);
    expect(card.stats.hazards_hit).toBe(1);
    expect(card.stats.miss_directions.long).toBe(1);
  });

  it('returns bogey score_label for 1-over', () => {
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 3,
      slope: 0,
      date: '2026-02-19',
      shots: [makeShot(), makeShot(), makeShot(), makeShot()],
    });
    expect(card.score).toBe(4);
    expect(card.score_label).toBe('bogey');
  });

  it('returns birdie score_label for 1-under (penalties offset)', () => {
    // 2 shots on a par 3 = birdie
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 3,
      slope: 0,
      date: '2026-02-19',
      shots: [makeShot(), makeShot()],
    });
    expect(card.score).toBe(2);
    expect(card.score_label).toBe('birdie');
  });

  it('defaults optional fields', () => {
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 4,
      slope: 0,
      date: '2026-02-19',
      shots: [makeShot()],
    });
    expect(card.conditions).toEqual([]);
    expect(card.special_plays).toEqual([]);
    expect(card.bunker_locations).toEqual([]);
    expect(card.yardage_book_updates).toEqual([]);
    expect(card.course_management_notes).toEqual([]);
    expect(card.training).toBeUndefined();
    expect(card.nutrition).toBeUndefined();
    expect(card.nineteenth_hole).toBeUndefined();
  });

  it('passes through optional fields when provided', () => {
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 4,
      slope: 0,
      date: '2026-02-19',
      shots: [makeShot()],
      type: 'feedback',
      conditions: [{ type: 'wind', description: 'test', impact: 'minor' }],
      special_plays: ['mulligan'],
      training: [{ type: 'lessons', description: 'test', outcome: 'ok' }],
      nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
      nineteenth_hole: { how_did_it_feel: 'Good' },
      bunker_locations: ['test bunker'],
      yardage_book_updates: ['map needs update'],
      course_management_notes: ['note'],
    });
    expect(card.type).toBe('feedback');
    expect(card.conditions).toHaveLength(1);
    expect(card.special_plays).toEqual(['mulligan']);
    expect(card.training).toHaveLength(1);
    expect(card.nutrition).toHaveLength(1);
    expect(card.nineteenth_hole?.how_did_it_feel).toBe('Good');
    expect(card.bunker_locations).toEqual(['test bunker']);
  });

  it('produces a valid scorecard that passes validation', async () => {
    // Import validator
    const { validateScorecard } = await import('../src/validation.js');
    const shots = [
      makeShot({ result: 'green' }),
      makeShot({ result: 'in_the_hole' }),
      makeShot({ result: 'fairway' }),
      makeShot({ result: 'missed_long' }),
    ];
    const card = buildScorecard({
      sprint_number: 168,
      theme: 'Test',
      par: 4,
      slope: 1,
      date: '2026-02-19',
      shots,
      training: [{ type: 'lessons', description: 'test', outcome: 'ok' }],
      nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
      bunker_locations: ['test bunker'],
    });
    const result = validateScorecard(card);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('matches Sprint 167 scorecard when given same shots', () => {
    const shots: ShotRecord[] = [
      makeShot({ ticket_key: 'S167-1a', result: 'in_the_hole' }),
      makeShot({ ticket_key: 'S167-2a', result: 'green', hazards: [{ type: 'bunker', description: 'migration' }] }),
      makeShot({ ticket_key: 'S167-3a', result: 'green', hazards: [{ type: 'rough', description: 'expo nav' }] }),
      makeShot({ ticket_key: 'S167-1', result: 'in_the_hole' }),
      makeShot({ ticket_key: 'S167-2', result: 'green' }),
      makeShot({ ticket_key: 'S167-3', result: 'green' }),
      makeShot({ ticket_key: 'S167-4', result: 'in_the_hole' }),
      makeShot({ ticket_key: 'S167-5', result: 'green' }),
      makeShot({ ticket_key: 'S167-6', result: 'in_the_hole' }),
      makeShot({ ticket_key: 'S167-7', result: 'green' }),
      makeShot({ ticket_key: 'S167-8', result: 'green' }),
    ];
    const card = buildScorecard({
      sprint_number: 167,
      theme: 'SLOPE — Sprint Lifecycle & Operational Performance Engine',
      par: 5,
      slope: 2,
      date: '2026-02-19',
      shots,
      putts: 2,
    });
    expect(card.score).toBe(11);
    expect(card.score_label).toBe('triple_plus');
    expect(card.stats.fairways_hit).toBe(11);
    expect(card.stats.greens_in_regulation).toBe(11);
    expect(card.stats.hazards_hit).toBe(2);
    expect(card.stats.miss_directions).toEqual({ long: 0, short: 0, left: 0, right: 0 });
  });
});
