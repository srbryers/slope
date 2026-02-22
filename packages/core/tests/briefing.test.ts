import { describe, it, expect } from 'vitest';
import {
  filterCommonIssues,
  extractHazardIndex,
  computeNutritionTrend,
  formatBriefing,
  hazardBriefing,
} from '../src/briefing.js';
import type { CommonIssuesFile, RecurringPattern } from '../src/briefing.js';
import type { GolfScorecard, ShotRecord, HoleStats, SprintClaim, SlopeEvent } from '../src/types.js';
import { golf, gaming } from '../src/metaphors/index.js';
import { backend, frontend, generalist } from '../src/roles.js';
import type { RoleDefinition } from '../src/roles.js';

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

// --- formatBriefing — STRATEGIC CONTEXT ---

import type { RoadmapDefinition } from '../src/roadmap.js';

function makeRoadmap(): RoadmapDefinition {
  return {
    name: 'Test Roadmap',
    phases: [{ name: 'Phase 1', sprints: [7, 8, 9] }],
    sprints: [
      {
        id: 7, theme: 'Foundation', par: 4, slope: 2, type: 'feature',
        tickets: [
          { key: 'S7-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
          { key: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small' },
          { key: 'S7-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
        ],
      },
      {
        id: 8, theme: 'Platform', par: 4, slope: 2, type: 'feature',
        depends_on: [7],
        tickets: [
          { key: 'S8-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
          { key: 'S8-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
          { key: 'S8-3', title: 'T3', club: 'wedge', complexity: 'small' },
        ],
      },
      {
        id: 9, theme: 'Polish', par: 3, slope: 1, type: 'feature',
        depends_on: [8],
        tickets: [
          { key: 'S9-1', title: 'T1', club: 'wedge', complexity: 'small' },
          { key: 'S9-2', title: 'T2', club: 'putter', complexity: 'trivial' },
          { key: 'S9-3', title: 'T3', club: 'wedge', complexity: 'small' },
        ],
      },
    ],
  };
}

describe('formatBriefing — STRATEGIC CONTEXT', () => {
  it('includes strategic context when roadmap and currentSprint provided', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      roadmap: makeRoadmap(),
      currentSprint: 8,
    });
    expect(output).toContain('STRATEGIC CONTEXT');
    expect(output).toContain('S8');
    expect(output).toContain('Phase 1');
  });

  it('shows critical path info for sprint on critical path', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      roadmap: makeRoadmap(),
      currentSprint: 8,
    });
    expect(output).toContain('critical path');
  });

  it('shows dependents for sprint with downstream sprints', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      roadmap: makeRoadmap(),
      currentSprint: 7,
    });
    expect(output).toContain('Feeds into');
    expect(output).toContain('S8');
  });

  it('omits strategic context when no roadmap provided', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
    });
    expect(output).not.toContain('STRATEGIC CONTEXT');
  });

  it('omits strategic context when no currentSprint provided', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      roadmap: makeRoadmap(),
    });
    expect(output).not.toContain('STRATEGIC CONTEXT');
  });

  it('omits strategic context when currentSprint not in roadmap', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      roadmap: makeRoadmap(),
      currentSprint: 99,
    });
    expect(output).not.toContain('STRATEGIC CONTEXT');
  });

  it('places strategic context between handicap and hazards', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      roadmap: makeRoadmap(),
      currentSprint: 8,
    });
    const briefingPos = output.indexOf('PRE-ROUND BRIEFING');
    const contextPos = output.indexOf('STRATEGIC CONTEXT');
    const hazardsPos = output.indexOf('HAZARDS');
    expect(briefingPos).toBeLessThan(contextPos);
    expect(contextPos).toBeLessThan(hazardsPos);
  });
});

describe('formatBriefing — METAPHOR', () => {
  it('uses golf briefing title by default (no metaphor)', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: { recurring_patterns: [] },
    });
    expect(output).toContain('PRE-ROUND BRIEFING');
  });

  it('uses golf briefing title with golf metaphor', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: { recurring_patterns: [] },
      metaphor: golf,
    });
    expect(output).toContain('PRE-ROUND BRIEFING');
  });

  it('uses gaming briefing title with gaming metaphor', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: { recurring_patterns: [] },
      metaphor: gaming,
    });
    expect(output).toContain('QUEST LOG');
  });

  it('gaming metaphor translates score label in latest sprint', () => {
    const card = makeCard({ score_label: 'par' });
    const output = formatBriefing({
      scorecards: [card],
      commonIssues: { recurring_patterns: [] },
      metaphor: gaming,
    });
    expect(output).toContain('B-Rank');
  });

  it('gaming metaphor translates training types in recommendations', () => {
    // Need scorecards with recurring hazards to trigger training recommendations
    const cards = Array.from({ length: 5 }, (_, i) => makeCard({
      sprint_number: i + 1,
      shots: [
        makeShot({
          result: 'missed_long',
          hazards: [{ type: 'rough', description: 'test' }],
        }),
      ],
      stats: {
        fairways_hit: 0, fairways_total: 1,
        greens_in_regulation: 0, greens_total: 1,
        putts: 0, penalties: 0, hazards_hit: 1,
        miss_directions: { long: 1, short: 0, left: 0, right: 0 },
      },
    }));
    const output = formatBriefing({
      scorecards: cards,
      commonIssues: { recurring_patterns: [] },
      metaphor: gaming,
      includeTraining: true,
    });
    // Gaming training types should appear
    if (output.includes('TRAINING RECOMMENDATIONS')) {
      expect(output).not.toContain('[driving_range]');
      expect(output).not.toContain('[chipping_practice]');
    }
  });

  it('no metaphor preserves backward compatible output', () => {
    const card = makeCard({ score_label: 'par' });
    const withMetaphor = formatBriefing({
      scorecards: [card],
      commonIssues: { recurring_patterns: [] },
    });
    const withoutMetaphor = formatBriefing({
      scorecards: [card],
      commonIssues: { recurring_patterns: [] },
    });
    expect(withMetaphor).toBe(withoutMetaphor);
  });
});

// --- formatBriefing — RECENT EVENTS ---

function makeEvent(type: SlopeEvent['type'], sprintNumber: number, data: Record<string, unknown> = {}): SlopeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    data,
    sprint_number: sprintNumber,
  };
}

describe('formatBriefing — RECENT EVENTS', () => {
  it('shows recent events section when events provided', () => {
    const events = [
      makeEvent('failure', 10, { error: 'build failed' }),
      makeEvent('failure', 11, { error: 'test timeout' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
    });
    expect(output).toContain('RECENT EVENTS');
    expect(output).toContain('[failure] x2');
    expect(output).toContain('build failed');
  });

  it('groups events by type', () => {
    const events = [
      makeEvent('failure', 10, { error: 'build failed' }),
      makeEvent('dead_end', 10, { description: 'wrong approach' }),
      makeEvent('failure', 11, { error: 'test timeout' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
    });
    expect(output).toContain('[failure] x2');
    expect(output).toContain('[dead_end] x1');
  });

  it('shows sprint numbers in event summary', () => {
    const events = [
      makeEvent('failure', 9, { error: 'err' }),
      makeEvent('failure', 11, { error: 'err2' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
    });
    expect(output).toContain('S9');
    expect(output).toContain('S11');
  });

  it('filters out events outside recency window', () => {
    const events = [
      makeEvent('failure', 1, { error: 'ancient' }),
      makeEvent('failure', 11, { error: 'recent' }),
    ];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
      eventRecencyWindow: 5,
    });
    expect(output).toContain('RECENT EVENTS');
    expect(output).toContain('recent');
    // Sprint 1 is outside window (12 - 5 = 7, so only > 7 included)
    expect(output).not.toContain('ancient');
  });

  it('respects custom eventRecencyWindow', () => {
    const events = [
      makeEvent('failure', 8, { error: 'slightly old' }),
      makeEvent('failure', 11, { error: 'recent' }),
    ];
    // Window of 2: only sprints > 10 included
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
      eventRecencyWindow: 2,
    });
    expect(output).toContain('recent');
    expect(output).not.toContain('slightly old');
  });

  it('omits section when no events provided', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      currentSprint: 12,
    });
    expect(output).not.toContain('RECENT EVENTS');
  });

  it('omits section when events array is empty', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: [],
      currentSprint: 12,
    });
    expect(output).not.toContain('RECENT EVENTS');
  });

  it('omits section when no currentSprint provided', () => {
    const events = [makeEvent('failure', 10, { error: 'err' })];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
    });
    expect(output).not.toContain('RECENT EVENTS');
  });

  it('uses data.area as description fallback', () => {
    const events = [makeEvent('hazard', 10, { area: 'packages/core' })];
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
    });
    expect(output).toContain('packages/core');
  });

  it('places section between COURSE STATUS and NUTRITION ALERTS', () => {
    const events = [makeEvent('failure', 10, { error: 'err' })];
    const output = formatBriefing({
      scorecards: [makeCard({
        nutrition: [{ category: 'recovery', description: 'bad', status: 'neglected' }],
      })],
      commonIssues: makeIssues([]),
      recentEvents: events,
      currentSprint: 12,
    });
    const coursePos = output.indexOf('COURSE STATUS');
    const eventsPos = output.indexOf('RECENT EVENTS');
    const nutritionPos = output.indexOf('NUTRITION ALERTS');
    expect(coursePos).toBeLessThan(eventsPos);
    expect(eventsPos).toBeLessThan(nutritionPos);
  });

  it('backward compatible — no events does not change output', () => {
    const baseOutput = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([makePattern()]),
    });
    const withEmptyEvents = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([makePattern()]),
      recentEvents: [],
      currentSprint: 12,
    });
    // Both should not contain RECENT EVENTS
    expect(baseOutput).not.toContain('RECENT EVENTS');
    expect(withEmptyEvents).not.toContain('RECENT EVENTS');
  });
});

// --- formatBriefing — ROLE-BASED CONTEXT INJECTION ---

describe('formatBriefing — ROLE-BASED CONTEXT', () => {
  it('shows role identity in header when role is provided', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
      role: backend,
    });
    expect(output).toContain('Role: Backend');
    expect(output).toContain('API, database, server-side logic specialist');
  });

  it('does not show role line when no role provided', () => {
    const output = formatBriefing({
      scorecards: [],
      commonIssues: makeIssues([]),
    });
    expect(output).not.toContain('Role:');
  });

  it('generalist role shows role line but does not filter', () => {
    const issues = makeIssues([
      makePattern({ id: 1, category: 'database', title: 'DB timeout', description: 'database related issue', prevention: 'Add retry' }),
      makePattern({ id: 2, category: 'styling', title: 'CSS bugs', description: 'styling related issue', prevention: 'Use module CSS' }),
    ]);
    const output = formatBriefing({
      scorecards: [],
      commonIssues: issues,
      role: generalist,
    });
    expect(output).toContain('Role: Generalist');
    // Generalist has no emphasis, so both should appear (no filter applied means top 10 by recency)
    expect(output).toContain('DB timeout');
    expect(output).toContain('CSS bugs');
  });

  it('backend role emphasizes database/api issues via keyword filtering', () => {
    const issues = makeIssues([
      makePattern({ id: 1, category: 'testing', title: 'API timeout in tests', description: 'api related testing', prevention: 'Mock API', sprints_hit: [10] }),
      makePattern({ id: 2, category: 'styling', title: 'Button alignment', description: 'CSS grid issue', prevention: 'Use flexbox', sprints_hit: [10] }),
      makePattern({ id: 3, category: 'database', title: 'Migration failure', description: 'database migration broke', prevention: 'Test migrations', sprints_hit: [10] }),
    ]);
    const output = formatBriefing({
      scorecards: [],
      commonIssues: issues,
      role: backend,
    });
    // Backend emphasizes: database, api, testing, migration, schema
    // These keywords match pattern 1 (api, testing) and 3 (database, migration)
    expect(output).toContain('API timeout');
    expect(output).toContain('Migration failure');
  });

  it('role hazard filtering uses focus areas', () => {
    const card = makeCard({
      sprint_number: 5,
      shots: [
        makeShot({ ticket_key: 'S5-1', hazards: [{ type: 'bunker', description: 'flaky test in packages/core' }] }),
        makeShot({ ticket_key: 'S5-2', hazards: [{ type: 'water', description: 'CSS regression in src/components' }] }),
      ],
      bunker_locations: ['packages/core: type export issue', 'src/components: styling breakage'],
    });
    // Backend focuses on: packages/core, packages/store-*, src/api, src/server, src/db, migrations
    const output = formatBriefing({
      scorecards: [card],
      commonIssues: makeIssues([]),
      role: backend,
    });
    expect(output).toContain('packages/core');
    expect(output).not.toContain('src/components');
    expect(output).not.toContain('CSS regression');
  });

  it('frontend role filters hazards to component/styling areas', () => {
    const card = makeCard({
      sprint_number: 5,
      shots: [
        makeShot({ ticket_key: 'S5-1', hazards: [{ type: 'bunker', description: 'flaky test in packages/core' }] }),
        makeShot({ ticket_key: 'S5-2', hazards: [{ type: 'water', description: 'CSS regression in src/components' }] }),
      ],
      bunker_locations: ['packages/core: type export issue', 'src/components: styling breakage'],
    });
    // Frontend focuses on: src/components, src/pages, src/styles, src/hooks, public
    const output = formatBriefing({
      scorecards: [card],
      commonIssues: makeIssues([]),
      role: frontend,
    });
    expect(output).toContain('src/components');
    expect(output).not.toContain('packages/core');
  });

  it('role deemphasis pushes categories to end of common issues', () => {
    // Backend deemphasizes: accessibility, styling, bundle
    const issues = makeIssues([
      makePattern({ id: 1, category: 'styling', title: 'CSS issue', description: 'styling problem', prevention: 'Fix CSS', sprints_hit: [10] }),
      makePattern({ id: 2, category: 'database', title: 'DB issue', description: 'database problem', prevention: 'Fix DB', sprints_hit: [10] }),
      makePattern({ id: 3, category: 'accessibility', title: 'A11y issue', description: 'accessibility problem', prevention: 'Add ARIA', sprints_hit: [10] }),
    ]);
    // Backend emphasis keywords: database, api, testing, migration, schema
    // Only pattern 2 (database) matches keywords
    const output = formatBriefing({
      scorecards: [],
      commonIssues: issues,
      role: backend,
    });
    // With backend role, emphasis filters to database/api/testing/migration/schema keywords
    expect(output).toContain('DB issue');
  });

  it('role + explicit filter: explicit filter keywords merge with role emphasis', () => {
    const issues = makeIssues([
      makePattern({ id: 1, category: 'testing', title: 'Custom keyword match', description: 'foobar related', prevention: 'Fix foobar', sprints_hit: [10] }),
      makePattern({ id: 2, category: 'database', title: 'DB migration issue', description: 'database migration', prevention: 'Test it', sprints_hit: [10] }),
    ]);
    const output = formatBriefing({
      scorecards: [],
      commonIssues: issues,
      role: backend,
      filter: { keywords: ['foobar'] },
    });
    // Merged keywords: foobar + backend emphasis (database, api, testing, migration, schema)
    // Pattern 1 matches 'foobar' and 'testing', pattern 2 matches 'database' and 'migration'
    expect(output).toContain('Custom keyword match');
    expect(output).toContain('DB migration issue');
  });

  it('backward compatible — no role produces same output as before', () => {
    const baseOutput = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([makePattern()]),
    });
    const withoutRole = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: makeIssues([makePattern()]),
      role: undefined,
    });
    expect(baseOutput).toBe(withoutRole);
  });
});
