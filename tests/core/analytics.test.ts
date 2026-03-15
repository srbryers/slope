import { describe, it, expect } from 'vitest';
import { computeHandicapTrend, computeVelocity, computeGuardMetrics } from '../../src/core/analytics.js';
import type { GolfScorecard } from '../../src/core/types.js';

// --- Helpers ---

function makeScorecard(overrides: Partial<GolfScorecard> & { sprint_number: number; par: 3 | 4 | 5; score: number }): GolfScorecard {
  const { sprint_number, par, score, ...rest } = overrides;
  return {
    sprint_number,
    theme: `Sprint ${sprint_number}`,
    par,
    slope: rest.slope ?? 1,
    score,
    score_label: score < par ? 'birdie' : score === par ? 'par' : 'bogey',
    shots: rest.shots ?? [],
    conditions: [],
    special_plays: [],
    stats: rest.stats ?? {
      fairways_hit: 0,
      fairways_total: 0,
      greens_in_regulation: 0,
      greens_total: 0,
      putts: 0,
      penalties: 0,
      hazards_hit: 0,
      hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    date: '2025-01-01',
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...rest,
  };
}

// ═══════════════════════════════════════════════════════════════
// T1: computeHandicapTrend
// ═══════════════════════════════════════════════════════════════

describe('computeHandicapTrend', () => {
  it('returns empty array for empty scorecards', () => {
    expect(computeHandicapTrend([])).toEqual([]);
  });

  it('returns single point for one scorecard', () => {
    const sc = makeScorecard({ sprint_number: 1, par: 4, score: 5 });
    const result = computeHandicapTrend([sc]);
    expect(result).toHaveLength(1);
    expect(result[0].sprint).toBe(1);
    expect(result[0].handicap).toBe(1); // score - par = 1
  });

  it('computes cumulative handicap correctly for multiple scorecards', () => {
    const scorecards = [
      makeScorecard({ sprint_number: 1, par: 4, score: 5 }),  // diff = +1
      makeScorecard({ sprint_number: 2, par: 4, score: 3 }),  // diff = -1, avg = 0
      makeScorecard({ sprint_number: 3, par: 4, score: 6 }),  // diff = +2, avg = 0.67
    ];
    const result = computeHandicapTrend(scorecards);
    expect(result).toHaveLength(3);
    expect(result[0].handicap).toBe(1);    // 1/1
    expect(result[1].handicap).toBe(0);    // (1-1)/2
    expect(result[2].handicap).toBe(0.67); // (1-1+2)/3
  });

  it('computes cumulative fairway% and GIR% correctly', () => {
    const scorecards = [
      makeScorecard({
        sprint_number: 1, par: 4, score: 4,
        stats: {
          fairways_hit: 3, fairways_total: 4,
          greens_in_regulation: 2, greens_total: 4,
          putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
          miss_directions: { long: 0, short: 0, left: 0, right: 0 },
        },
      }),
      makeScorecard({
        sprint_number: 2, par: 4, score: 4,
        stats: {
          fairways_hit: 1, fairways_total: 4,
          greens_in_regulation: 4, greens_total: 4,
          putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
          miss_directions: { long: 0, short: 0, left: 0, right: 0 },
        },
      }),
    ];
    const result = computeHandicapTrend(scorecards);
    expect(result[0].fairway_pct).toBe(75);   // 3/4
    expect(result[0].gir_pct).toBe(50);       // 2/4
    expect(result[1].fairway_pct).toBe(50);   // 4/8
    expect(result[1].gir_pct).toBe(75);       // 6/8
  });

  it('sorts by sprint_number', () => {
    const scorecards = [
      makeScorecard({ sprint_number: 3, par: 4, score: 4 }),
      makeScorecard({ sprint_number: 1, par: 4, score: 5 }),
      makeScorecard({ sprint_number: 2, par: 4, score: 3 }),
    ];
    const result = computeHandicapTrend(scorecards);
    expect(result.map(r => r.sprint)).toEqual([1, 2, 3]);
  });
});

// ═══════════════════════════════════════════════════════════════
// T2: computeVelocity
// ═══════════════════════════════════════════════════════════════

describe('computeVelocity', () => {
  it('returns zeroed report for empty scorecards', () => {
    const result = computeVelocity([]);
    expect(result.points).toEqual([]);
    expect(result.avg_tickets).toBe(0);
    expect(result.par_accuracy_pct).toBe(0);
    expect(result.avg_differential).toBe(0);
    expect(result.trend).toBe('stable');
  });

  it('computes correct ticket count from shots', () => {
    const sc = makeScorecard({
      sprint_number: 1, par: 4, score: 4,
      shots: [
        { ticket_key: 'T1', title: 'T', club: 'short_iron', result: 'green', hazards: [] },
        { ticket_key: 'T2', title: 'T', club: 'short_iron', result: 'green', hazards: [] },
        { ticket_key: 'T3', title: 'T', club: 'short_iron', result: 'green', hazards: [] },
      ],
    });
    const result = computeVelocity([sc]);
    expect(result.points[0].tickets).toBe(3);
    expect(result.avg_tickets).toBe(3);
  });

  it('returns 100% par accuracy when all at par', () => {
    const scorecards = [
      makeScorecard({ sprint_number: 1, par: 4, score: 4 }),
      makeScorecard({ sprint_number: 2, par: 4, score: 4 }),
      makeScorecard({ sprint_number: 3, par: 3, score: 3 }),
    ];
    const result = computeVelocity(scorecards);
    expect(result.par_accuracy_pct).toBe(100);
    expect(result.trend).toBe('stable');
  });

  it('detects improving trend when last-5 avg differential is lower', () => {
    // First 10 sprints at +1, last 5 at -1 → last-5 avg = -1, all avg = +0.33
    const scorecards: GolfScorecard[] = [];
    for (let i = 1; i <= 10; i++) {
      scorecards.push(makeScorecard({ sprint_number: i, par: 4, score: 5 }));
    }
    for (let i = 11; i <= 15; i++) {
      scorecards.push(makeScorecard({ sprint_number: i, par: 4, score: 3 }));
    }
    const result = computeVelocity(scorecards);
    expect(result.trend).toBe('improving');
  });

  it('detects declining trend when last-5 avg differential is higher', () => {
    // First 10 sprints at -1, last 5 at +1
    const scorecards: GolfScorecard[] = [];
    for (let i = 1; i <= 10; i++) {
      scorecards.push(makeScorecard({ sprint_number: i, par: 4, score: 3 }));
    }
    for (let i = 11; i <= 15; i++) {
      scorecards.push(makeScorecard({ sprint_number: i, par: 4, score: 5 }));
    }
    const result = computeVelocity(scorecards);
    expect(result.trend).toBe('declining');
  });

  it('marks at_or_under_par correctly', () => {
    const scorecards = [
      makeScorecard({ sprint_number: 1, par: 4, score: 3 }),  // under
      makeScorecard({ sprint_number: 2, par: 4, score: 4 }),  // at
      makeScorecard({ sprint_number: 3, par: 4, score: 5 }),  // over
    ];
    const result = computeVelocity(scorecards);
    expect(result.points[0].at_or_under_par).toBe(true);
    expect(result.points[1].at_or_under_par).toBe(true);
    expect(result.points[2].at_or_under_par).toBe(false);
    // 2 out of 3 = 66.67%
    expect(result.par_accuracy_pct).toBe(66.67);
  });
});

// ═══════════════════════════════════════════════════════════════
// T3: computeGuardMetrics
// ═══════════════════════════════════════════════════════════════

describe('computeGuardMetrics', () => {
  it('returns zeroed report for empty lines', () => {
    const result = computeGuardMetrics([]);
    expect(result.total_executions).toBe(0);
    expect(result.by_guard).toEqual([]);
    expect(result.most_active).toBeNull();
    expect(result.most_blocking).toBeNull();
  });

  it('parses a single execution correctly', () => {
    const lines = [
      JSON.stringify({ ts: '2025-01-01T00:00:00Z', guard: 'explore', event: 'PreToolUse', tool: 'Read', decision: 'context' }),
    ];
    const result = computeGuardMetrics(lines);
    expect(result.total_executions).toBe(1);
    expect(result.by_guard).toHaveLength(1);
    expect(result.by_guard[0].guard).toBe('explore');
    expect(result.by_guard[0].context).toBe(1);
    expect(result.by_guard[0].total).toBe(1);
    expect(result.most_active).toBe('explore');
  });

  it('groups metrics correctly across multiple guards', () => {
    const lines = [
      JSON.stringify({ ts: '2025-01-01T00:00:00Z', guard: 'explore', event: 'PreToolUse', tool: 'Read', decision: 'context' }),
      JSON.stringify({ ts: '2025-01-01T00:00:01Z', guard: 'explore', event: 'PreToolUse', tool: 'Bash', decision: 'deny' }),
      JSON.stringify({ ts: '2025-01-01T00:00:02Z', guard: 'hazard', event: 'PreToolUse', tool: 'Edit', decision: 'context' }),
      JSON.stringify({ ts: '2025-01-01T00:00:03Z', guard: 'hazard', event: 'PreToolUse', tool: 'Edit', decision: 'allow' }),
      JSON.stringify({ ts: '2025-01-01T00:00:04Z', guard: 'hazard', event: 'PreToolUse', tool: 'Edit', decision: 'allow' }),
    ];
    const result = computeGuardMetrics(lines);
    expect(result.total_executions).toBe(5);
    expect(result.by_guard).toHaveLength(2);

    // Sorted by total descending → hazard (3) first, explore (2) second
    expect(result.by_guard[0].guard).toBe('hazard');
    expect(result.by_guard[0].total).toBe(3);
    expect(result.by_guard[1].guard).toBe('explore');
    expect(result.by_guard[1].total).toBe(2);

    expect(result.most_active).toBe('hazard');
  });

  it('requires minimum 5 executions for most_blocking', () => {
    // 2 executions, 100% block rate — should NOT be most_blocking
    const lines = [
      JSON.stringify({ ts: '2025-01-01T00:00:00Z', guard: 'test-guard', event: 'PreToolUse', tool: 'X', decision: 'deny' }),
      JSON.stringify({ ts: '2025-01-01T00:00:01Z', guard: 'test-guard', event: 'PreToolUse', tool: 'X', decision: 'deny' }),
    ];
    const result = computeGuardMetrics(lines);
    expect(result.most_blocking).toBeNull();
  });

  it('computes most_blocking with 5+ executions', () => {
    const lines: string[] = [];
    // 5 deny → 100% block rate
    for (let i = 0; i < 5; i++) {
      lines.push(JSON.stringify({ ts: `2025-01-01T00:00:0${i}Z`, guard: 'blocker', event: 'PreToolUse', tool: 'X', decision: 'deny' }));
    }
    // 10 allow → 0% block rate
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ ts: `2025-01-01T00:01:0${i}Z`, guard: 'permissive', event: 'PreToolUse', tool: 'X', decision: 'allow' }));
    }
    const result = computeGuardMetrics(lines);
    expect(result.most_blocking).toBe('blocker');
    expect(result.most_active).toBe('permissive');
  });

  it('skips malformed JSONL lines gracefully', () => {
    const lines = [
      'not json at all',
      '{"guard": "explore", "decision": "context"}',  // missing ts/event/tool but guard+decision present
      '',
      '   ',
      JSON.stringify({ ts: '2025-01-01', guard: 'hazard', event: 'PreToolUse', tool: 'Edit', decision: 'deny' }),
    ];
    const result = computeGuardMetrics(lines);
    // Should parse 2 valid lines (explore + hazard)
    expect(result.total_executions).toBe(2);
  });

  it('treats unknown decisions as silent', () => {
    const lines = [
      JSON.stringify({ ts: '2025-01-01', guard: 'test', event: 'PreToolUse', tool: 'X', decision: 'unknown_value' }),
    ];
    const result = computeGuardMetrics(lines);
    expect(result.by_guard[0].silent).toBe(1);
  });

  it('computes block_rate correctly', () => {
    const lines = [
      JSON.stringify({ ts: '2025-01-01', guard: 'g', event: 'PreToolUse', tool: 'X', decision: 'deny' }),
      JSON.stringify({ ts: '2025-01-01', guard: 'g', event: 'PreToolUse', tool: 'X', decision: 'allow' }),
      JSON.stringify({ ts: '2025-01-01', guard: 'g', event: 'PreToolUse', tool: 'X', decision: 'allow' }),
      JSON.stringify({ ts: '2025-01-01', guard: 'g', event: 'PreToolUse', tool: 'X', decision: 'allow' }),
    ];
    const result = computeGuardMetrics(lines);
    expect(result.by_guard[0].block_rate).toBe(25); // 1/4 * 100
  });
});
