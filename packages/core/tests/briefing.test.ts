import { describe, it, expect } from 'vitest';
import {
  filterCommonIssues,
  extractHazardIndex,
  computeNutritionTrend,
  formatBriefing,
  hazardBriefing,
} from '../src/briefing.js';
import type { CommonIssuesFile, RecurringPattern } from '../src/briefing.js';
import type { GolfScorecard, ShotRecord, HoleStats, SprintClaim } from '../src/types.js';

// --- Helpers ---

function makePattern(overrides: Partial<RecurringPattern> = {}): RecurringPattern {
  return {
    id: 1,
    title: 'Test Pattern',
    category: 'testing',
    sprints_hit: [100],
    gotcha_refs: ['g-001'],
    description: 'Test description',
    prevention: 'Test prevention',
    ...overrides,
  };
}

function makeIssues(patterns: RecurringPattern[]): CommonIssuesFile {
  return { recurring_patterns: patterns };
}

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
    fairways_hit: 3, fairways_total: 4,
    greens_in_regulation: 3, greens_total: 4,
    putts: 1, penalties: 0, hazards_hit: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    ...overrides,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 168,
    theme: 'Test Sprint',
    par: 4, slope: 1, score: 4, score_label: 'par',
    date: '2026-02-19',
    shots: [makeShot(), makeShot(), makeShot(), makeShot()],
    conditions: [], special_plays: [],
    stats: makeStats(),
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

// --- filterCommonIssues ---

describe('filterCommonIssues', () => {
  it('returns empty array for empty patterns', () => {
    expect(filterCommonIssues(makeIssues([]), {})).toEqual([]);
  });

  it('filters by category', () => {
    const issues = makeIssues([
      makePattern({ id: 1, category: 'testing' }),
      makePattern({ id: 2, category: 'mobile' }),
      makePattern({ id: 3, category: 'testing' }),
    ]);
    const result = filterCommonIssues(issues, { categories: ['testing'] });
    expect(result).toHaveLength(2);
    expect(result.every(p => p.category === 'testing')).toBe(true);
  });

  it('filters by keyword in title/description/prevention', () => {
    const issues = makeIssues([
      makePattern({ id: 1, title: 'Mock pool gotcha', category: 'testing' }),
      makePattern({ id: 2, title: 'API drift', description: 'mock something', category: 'api' }),
      makePattern({ id: 3, title: 'Unrelated', category: 'git' }),
    ]);
    const result = filterCommonIssues(issues, { keywords: ['mock'] });
    expect(result).toHaveLength(2);
  });

  it('combines category and keyword filters (AND)', () => {
    const issues = makeIssues([
      makePattern({ id: 1, title: 'Mock pool', category: 'testing' }),
      makePattern({ id: 2, title: 'Mock API', category: 'api' }),
      makePattern({ id: 3, title: 'Other test', category: 'testing' }),
    ]);
    const result = filterCommonIssues(issues, { categories: ['testing'], keywords: ['mock'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('sorts by most recently hit sprint (descending)', () => {
    const issues = makeIssues([
      makePattern({ id: 1, sprints_hit: [50, 100] }),
      makePattern({ id: 2, sprints_hit: [150] }),
      makePattern({ id: 3, sprints_hit: [80] }),
    ]);
    const result = filterCommonIssues(issues, {});
    expect(result.map(p => p.id)).toEqual([2, 1, 3]);
  });

  it('limits to 10 results', () => {
    const patterns = Array.from({ length: 15 }, (_, i) =>
      makePattern({ id: i, sprints_hit: [i] }),
    );
    const result = filterCommonIssues(makeIssues(patterns), {});
    expect(result).toHaveLength(10);
  });

  it('is case insensitive for categories', () => {
    const issues = makeIssues([makePattern({ category: 'Testing' })]);
    const result = filterCommonIssues(issues, { categories: ['testing'] });
    expect(result).toHaveLength(1);
  });
});

// --- extractHazardIndex ---

describe('extractHazardIndex', () => {
  it('returns empty for no scorecards', () => {
    const result = extractHazardIndex([]);
    expect(result.shot_hazards).toHaveLength(0);
    expect(result.bunker_locations).toHaveLength(0);
  });

  it('extracts shot hazards', () => {
    const card = makeCard({
      sprint_number: 167,
      shots: [
        makeShot({ ticket_key: 'S167-1', hazards: [{ type: 'bunker', description: 'migration conflict' }] }),
        makeShot({ ticket_key: 'S167-2', hazards: [] }),
      ],
    });
    const result = extractHazardIndex([card]);
    expect(result.shot_hazards).toHaveLength(1);
    expect(result.shot_hazards[0].sprint).toBe(167);
    expect(result.shot_hazards[0].ticket).toBe('S167-1');
    expect(result.shot_hazards[0].description).toBe('migration conflict');
  });

  it('extracts bunker locations', () => {
    const card = makeCard({
      sprint_number: 167,
      bunker_locations: ['Watch out for X', 'Careful with Y'],
    });
    const result = extractHazardIndex([card]);
    expect(result.bunker_locations).toHaveLength(2);
    expect(result.bunker_locations[0].sprint).toBe(167);
    expect(result.bunker_locations[0].location).toBe('Watch out for X');
  });

  it('filters by keyword', () => {
    const card = makeCard({
      shots: [
        makeShot({ hazards: [{ type: 'bunker', description: 'migration conflict' }] }),
        makeShot({ hazards: [{ type: 'rough', description: 'Playwright navigation' }] }),
      ],
      bunker_locations: ['migration gotcha', 'unrelated bunker'],
    });
    const result = extractHazardIndex([card], 'migration');
    expect(result.shot_hazards).toHaveLength(1);
    expect(result.bunker_locations).toHaveLength(1);
  });

  it('aggregates across multiple scorecards', () => {
    const card1 = makeCard({ sprint_number: 167, bunker_locations: ['A'] });
    const card2 = makeCard({ sprint_number: 168, bunker_locations: ['B'] });
    const result = extractHazardIndex([card1, card2]);
    expect(result.bunker_locations).toHaveLength(2);
  });
});

// --- computeNutritionTrend ---

describe('computeNutritionTrend', () => {
  it('returns empty for no scorecards', () => {
    expect(computeNutritionTrend([])).toHaveLength(0);
  });

  it('returns empty for scorecards with no nutrition', () => {
    expect(computeNutritionTrend([makeCard()])).toHaveLength(0);
  });

  it('reports healthy trend when majority healthy', () => {
    const cards = [
      makeCard({ nutrition: [{ category: 'hydration', description: 'ok', status: 'healthy' }] }),
      makeCard({ nutrition: [{ category: 'hydration', description: 'ok', status: 'healthy' }] }),
      makeCard({ nutrition: [{ category: 'hydration', description: 'meh', status: 'needs_attention' }] }),
    ];
    const trend = computeNutritionTrend(cards);
    const hydration = trend.find(t => t.category === 'hydration');
    expect(hydration?.trend).toBe('healthy');
    expect(hydration?.healthy).toBe(2);
    expect(hydration?.needs_attention).toBe(1);
  });

  it('reports neglected trend when majority neglected', () => {
    const cards = [
      makeCard({ nutrition: [{ category: 'recovery', description: 'bad', status: 'neglected' }] }),
      makeCard({ nutrition: [{ category: 'recovery', description: 'bad', status: 'neglected' }] }),
      makeCard({ nutrition: [{ category: 'recovery', description: 'ok', status: 'healthy' }] }),
    ];
    const trend = computeNutritionTrend(cards);
    const recovery = trend.find(t => t.category === 'recovery');
    expect(recovery?.trend).toBe('neglected');
  });

  it('reports mixed when no majority', () => {
    const cards = [
      makeCard({ nutrition: [{ category: 'diet', description: 'ok', status: 'healthy' }] }),
      makeCard({ nutrition: [{ category: 'diet', description: 'bad', status: 'neglected' }] }),
      makeCard({ nutrition: [{ category: 'diet', description: 'meh', status: 'needs_attention' }] }),
    ];
    const trend = computeNutritionTrend(cards);
    const diet = trend.find(t => t.category === 'diet');
    expect(diet?.trend).toBe('mixed');
  });

  it('tracks multiple categories independently', () => {
    const cards = [
      makeCard({
        nutrition: [
          { category: 'hydration', description: 'ok', status: 'healthy' },
          { category: 'recovery', description: 'bad', status: 'neglected' },
        ],
      }),
    ];
    const trend = computeNutritionTrend(cards);
    expect(trend).toHaveLength(2);
    expect(trend.find(t => t.category === 'hydration')?.trend).toBe('healthy');
    expect(trend.find(t => t.category === 'recovery')?.trend).toBe('neglected');
  });
});

// --- hazardBriefing ---

describe('hazardBriefing', () => {
  it('returns empty for no scorecards', () => {
    expect(hazardBriefing({ areas: ['migration'], scorecards: [] })).toEqual([]);
  });

  it('returns empty for no areas', () => {
    expect(hazardBriefing({ areas: [], scorecards: [makeCard()] })).toEqual([]);
  });

  it('matches hazards in target areas', () => {
    const card = makeCard({
      sprint_number: 170,
      shots: [
        makeShot({ hazards: [{ type: 'bunker', description: 'migration conflict in schema' }] }),
        makeShot({ hazards: [{ type: 'rough', description: 'Playwright navigation issue' }] }),
      ],
    });
    const result = hazardBriefing({ areas: ['migration'], scorecards: [card] });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('WARNING');
    expect(result[0]).toContain('migration conflict');
    expect(result[0]).toContain('S170');
  });

  it('matches bunker locations in target areas', () => {
    const card = makeCard({
      sprint_number: 171,
      bunker_locations: ['migration DDL is tricky', 'WebSocket timing'],
    });
    const result = hazardBriefing({ areas: ['migration'], scorecards: [card] });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('bunker');
    expect(result[0]).toContain('migration DDL');
  });

  it('is case insensitive', () => {
    const card = makeCard({
      sprint_number: 172,
      shots: [makeShot({ hazards: [{ type: 'bunker', description: 'MIGRATION issue' }] })],
    });
    const result = hazardBriefing({ areas: ['migration'], scorecards: [card] });
    expect(result).toHaveLength(1);
  });

  it('returns empty when no areas match', () => {
    const card = makeCard({
      shots: [makeShot({ hazards: [{ type: 'bunker', description: 'test failure' }] })],
      bunker_locations: ['test flakiness'],
    });
    const result = hazardBriefing({ areas: ['migration'], scorecards: [card] });
    expect(result).toHaveLength(0);
  });
});

// --- formatBriefing ---

describe('formatBriefing', () => {
  it('produces output with all sections', () => {
    const output = formatBriefing({
      scorecards: [makeCard({
        bunker_locations: ['Test bunker'],
        nutrition: [{ category: 'hydration', description: 'ok', status: 'healthy' }],
      })],
      commonIssues: makeIssues([makePattern()]),
      lastSession: { id: 1, date: '2026-02-19', sprint: 'Sprint 167', summary: 'Did stuff', where_left_off: 'Ready for 168' },
    });
    expect(output).toContain('PRE-ROUND BRIEFING');
    expect(output).toContain('Handicap:');
    expect(output).toContain('HAZARDS');
    expect(output).toContain('Test bunker');
    expect(output).toContain('LAST SESSION');
    expect(output).toContain('Ready for 168');
  });

  it('shows handicap and miss pattern', () => {
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([]),
    });
    expect(output).toContain('Handicap: +0.0');
    expect(output).toContain('Clean');
  });

  it('shows no scorecards message when empty', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
    });
    expect(output).toContain('No SLOPE-era scorecards yet');
  });

  it('shows nutrition alerts for non-healthy categories', () => {
    const output = formatBriefing({
      scorecards: [makeCard({
        nutrition: [
          { category: 'recovery', description: 'bad', status: 'neglected' },
          { category: 'hydration', description: 'ok', status: 'healthy' },
        ],
      })],
      commonIssues: makeIssues([]),
    });
    expect(output).toContain('NUTRITION ALERTS');
    expect(output).toContain('recovery: neglected');
    expect(output).not.toContain('hydration');
  });

  it('filters common issues by category when provided', () => {
    const issues = makeIssues([
      makePattern({ id: 1, category: 'testing', title: 'Test gotcha' }),
      makePattern({ id: 2, category: 'mobile', title: 'Mobile gotcha' }),
    ]);
    const output = formatBriefing({
      scorecards: [],
      commonIssues: issues,
      filter: { categories: ['testing'] },
    });
    expect(output).toContain('Test gotcha');
    expect(output).not.toContain('Mobile gotcha');
    expect(output).toContain('RELEVANT GOTCHAS');
  });

  it('shows RECENT GOTCHAS when no filter', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([makePattern()]),
    });
    expect(output).toContain('RECENT GOTCHAS');
  });

  it('truncates long prevention strings', () => {
    const longPrevention = 'A'.repeat(200);
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([makePattern({ prevention: longPrevention })]),
    });
    expect(output).toContain('...');
  });

  it('omits session section when no lastSession', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
    });
    expect(output).not.toContain('LAST SESSION');
  });

  it('includes training recommendations section when scorecards have patterns', () => {
    // Create scorecards with a dominant miss pattern -> triggers training rec
    const cards = [
      makeCard({
        sprint_number: 170,
        shots: [
          makeShot({ result: 'missed_long' }),
          makeShot({ result: 'missed_long' }),
          makeShot({ result: 'green' }),
        ],
        stats: makeStats({ miss_directions: { long: 2, short: 0, left: 0, right: 0 } }),
      }),
    ];
    const output = formatBriefing({
      scorecards: cards,
      commonIssues: makeIssues([]),
    });
    expect(output).toContain('TRAINING RECOMMENDATIONS');
  });

  it('omits training section when includeTraining is false', () => {
    const cards = [
      makeCard({
        sprint_number: 170,
        shots: [
          makeShot({ result: 'missed_long' }),
          makeShot({ result: 'missed_long' }),
          makeShot({ result: 'green' }),
        ],
        stats: makeStats({ miss_directions: { long: 2, short: 0, left: 0, right: 0 } }),
      }),
    ];
    const output = formatBriefing({
      scorecards: cards,
      commonIssues: makeIssues([]),
      includeTraining: false,
    });
    expect(output).not.toContain('TRAINING RECOMMENDATIONS');
  });

  it('omits training section when no scorecards', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
    });
    expect(output).not.toContain('TRAINING RECOMMENDATIONS');
  });

  it('omits training section when no high/medium recommendations exist', () => {
    // A clean scorecard with no misses generates no training recs
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([]),
    });
    expect(output).not.toContain('TRAINING RECOMMENDATIONS');
  });

  it('shows training items with priority icons', () => {
    // dominant miss -> high priority
    const cards = [
      makeCard({
        sprint_number: 170,
        shots: [
          makeShot({ result: 'missed_long' }),
          makeShot({ result: 'missed_long' }),
          makeShot({ result: 'green' }),
        ],
        stats: makeStats({ miss_directions: { long: 2, short: 0, left: 0, right: 0 } }),
      }),
    ];
    const output = formatBriefing({
      scorecards: cards,
      commonIssues: makeIssues([]),
    });
    // High priority items get !! icon
    expect(output).toContain('!! [');
  });

  it('backward compatible — existing tests still work with default includeTraining', () => {
    // This verifies that the function signature didn't break
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([makePattern()]),
      lastSession: { id: 1, date: '2026-02-19', sprint: 'Sprint 167', summary: 'Did stuff', where_left_off: 'Ready for 168' },
    });
    expect(output).toContain('PRE-ROUND BRIEFING');
    expect(output).toContain('LAST SESSION');
  });
});

// --- formatBriefing — COURSE STATUS ---

function makeClaim(overrides: Partial<SprintClaim> = {}): SprintClaim {
  return {
    id: 'c-001',
    sprint_number: 2,
    player: 'alice',
    target: 'S2-1',
    scope: 'ticket',
    claimed_at: '2026-02-20T00:00:00Z',
    ...overrides,
  };
}

describe('formatBriefing — COURSE STATUS', () => {
  it('shows "No active claims." when claims is undefined', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
    });
    expect(output).toContain('COURSE STATUS');
    expect(output).toContain('No active claims.');
  });

  it('shows "No active claims." when claims is empty array', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      claims: [],
    });
    expect(output).toContain('COURSE STATUS');
    expect(output).toContain('No active claims.');
  });

  it('groups claims by player with scope tags and notes', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1', scope: 'ticket' }),
      makeClaim({ id: 'c-002', player: 'alice', target: 'packages/cli', scope: 'area', notes: 'CLI work' }),
      makeClaim({ id: 'c-003', player: 'bob', target: 'S2-3', scope: 'ticket' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      claims,
    });
    expect(output).toContain('alice:');
    expect(output).toContain('[ticket] S2-1');
    expect(output).toContain('[area] packages/cli');
    expect(output).toContain('CLI work');
    expect(output).toContain('bob:');
    expect(output).toContain('[ticket] S2-3');
  });

  it('shows overlap conflicts with [!!] icon', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1' }),
      makeClaim({ id: 'c-002', player: 'bob', target: 'S2-1' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      claims,
    });
    expect(output).toContain('Conflicts:');
    expect(output).toContain('[!!]');
    expect(output).toContain('Both alice and bob claimed "S2-1"');
  });

  it('does not show Conflicts subsection when no conflicts exist', () => {
    const claims = [
      makeClaim({ player: 'alice', target: 'S2-1' }),
      makeClaim({ id: 'c-002', player: 'bob', target: 'S2-2' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      claims,
    });
    expect(output).toContain('COURSE STATUS');
    expect(output).not.toContain('Conflicts:');
  });

  it('appears between HAZARDS and NUTRITION sections', () => {
    const output = formatBriefing({
      scorecards: [makeCard({
        nutrition: [{ category: 'recovery', description: 'bad', status: 'neglected' }],
      })],
      commonIssues: makeIssues([]),
      claims: [],
    });
    const hazardsPos = output.indexOf('HAZARDS');
    const coursePos = output.indexOf('COURSE STATUS');
    const nutritionPos = output.indexOf('NUTRITION ALERTS');
    expect(hazardsPos).toBeLessThan(coursePos);
    expect(coursePos).toBeLessThan(nutritionPos);
  });
});
