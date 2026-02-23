import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAYER,
  extractPlayers,
  filterScorecardsByPlayer,
  computePlayerHandicaps,
  computePlayerHandicap,
  computeReporterSeverity,
  mergeHazardIndices,
  filterHazardsByVisibility,
} from '../src/player.js';
import type { GolfScorecard } from '../src/types.js';
import type { CommonIssuesFile, RecurringPattern } from '../src/briefing.js';

// --- Test helpers ---

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 1,
    theme: 'Test',
    par: 3,
    slope: 0,
    score: 3,
    score_label: 'par',
    date: '2026-01-01',
    shots: [
      { ticket_key: 'S1-1', title: 'Test', club: 'short_iron', result: 'green', hazards: [] },
      { ticket_key: 'S1-2', title: 'Test', club: 'wedge', result: 'in_the_hole', hazards: [] },
      { ticket_key: 'S1-3', title: 'Test', club: 'short_iron', result: 'fairway', hazards: [] },
    ],
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 3,
      fairways_total: 3,
      greens_in_regulation: 3,
      greens_total: 3,
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

// --- extractPlayers ---

describe('extractPlayers', () => {
  it('returns unique sorted player names', () => {
    const cards = [
      makeCard({ player: 'bob', sprint_number: 1 }),
      makeCard({ player: 'alice', sprint_number: 2 }),
      makeCard({ player: 'bob', sprint_number: 3 }),
    ];
    expect(extractPlayers(cards)).toEqual(['alice', 'bob']);
  });

  it('maps undefined player to DEFAULT_PLAYER', () => {
    const cards = [makeCard({ sprint_number: 1 })];
    expect(extractPlayers(cards)).toEqual([DEFAULT_PLAYER]);
  });

  it('handles mixed player and undefined', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ sprint_number: 2 }),
    ];
    expect(extractPlayers(cards)).toEqual(['alice', DEFAULT_PLAYER]);
  });

  it('returns empty array for empty input', () => {
    expect(extractPlayers([])).toEqual([]);
  });
});

// --- filterScorecardsByPlayer ---

describe('filterScorecardsByPlayer', () => {
  const cards = [
    makeCard({ player: 'alice', sprint_number: 1 }),
    makeCard({ player: 'bob', sprint_number: 2 }),
    makeCard({ player: 'alice', sprint_number: 3 }),
    makeCard({ sprint_number: 4 }),
  ];

  it('filters by exact player match', () => {
    const result = filterScorecardsByPlayer(cards, 'alice');
    expect(result).toHaveLength(2);
    expect(result.map(c => c.sprint_number)).toEqual([1, 3]);
  });

  it('maps undefined player to DEFAULT_PLAYER for filtering', () => {
    const result = filterScorecardsByPlayer(cards, DEFAULT_PLAYER);
    expect(result).toHaveLength(1);
    expect(result[0].sprint_number).toBe(4);
  });

  it('returns empty array for non-existent player', () => {
    expect(filterScorecardsByPlayer(cards, 'charlie')).toEqual([]);
  });
});

// --- computePlayerHandicaps ---

describe('computePlayerHandicaps', () => {
  it('returns per-player handicap entries', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ player: 'bob', sprint_number: 2 }),
      makeCard({ player: 'alice', sprint_number: 3 }),
    ];
    const result = computePlayerHandicaps(cards);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.player)).toEqual(['alice', 'bob']);
  });

  it('returns correct scorecard counts per player', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ player: 'alice', sprint_number: 2 }),
      makeCard({ player: 'bob', sprint_number: 3 }),
    ];
    const result = computePlayerHandicaps(cards);
    const alice = result.find(r => r.player === 'alice')!;
    const bob = result.find(r => r.player === 'bob')!;
    expect(alice.scorecardCount).toBe(2);
    expect(bob.scorecardCount).toBe(1);
  });

  it('computes independent handicap cards per player', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1, score: 3, par: 3 }),
      makeCard({ player: 'bob', sprint_number: 2, score: 5, par: 3 }),
    ];
    const result = computePlayerHandicaps(cards);
    const alice = result.find(r => r.player === 'alice')!;
    const bob = result.find(r => r.player === 'bob')!;
    expect(alice.handicapCard.all_time.handicap).toBe(0);
    expect(bob.handicapCard.all_time.handicap).toBeGreaterThan(0);
  });

  it('returns empty for no scorecards', () => {
    expect(computePlayerHandicaps([])).toEqual([]);
  });
});

// --- computePlayerHandicap ---

describe('computePlayerHandicap', () => {
  it('computes for a single player', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ player: 'bob', sprint_number: 2 }),
    ];
    const result = computePlayerHandicap(cards, 'alice');
    expect(result.player).toBe('alice');
    expect(result.scorecardCount).toBe(1);
    expect(result.handicapCard).toBeDefined();
  });

  it('returns zeroed card for unknown player', () => {
    const cards = [makeCard({ player: 'alice', sprint_number: 1 })];
    const result = computePlayerHandicap(cards, 'nobody');
    expect(result.scorecardCount).toBe(0);
    expect(result.handicapCard.all_time.handicap).toBe(0);
  });

  it('respects chronological order', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1, score: 5, par: 3 }),
      makeCard({ player: 'alice', sprint_number: 2, score: 3, par: 3 }),
    ];
    const result = computePlayerHandicap(cards, 'alice');
    expect(result.scorecardCount).toBe(2);
    // handicap uses all filtered scorecards
    expect(result.handicapCard.all_time).toBeDefined();
  });
});

// --- Backward compatibility ---

describe('backward compatibility', () => {
  it('scorecards without player field work with all functions', () => {
    const cards = [makeCard({ sprint_number: 1 }), makeCard({ sprint_number: 2 })];
    expect(extractPlayers(cards)).toEqual([DEFAULT_PLAYER]);
    expect(filterScorecardsByPlayer(cards, DEFAULT_PLAYER)).toHaveLength(2);
    const handicaps = computePlayerHandicaps(cards);
    expect(handicaps).toHaveLength(1);
    expect(handicaps[0].player).toBe(DEFAULT_PLAYER);
    expect(handicaps[0].scorecardCount).toBe(2);
  });
});

// --- Hazard helpers ---

function makePattern(overrides: Partial<RecurringPattern> = {}): RecurringPattern {
  return {
    id: 1,
    title: 'Test pattern',
    category: 'testing',
    sprints_hit: [1],
    gotcha_refs: [],
    description: 'Test',
    prevention: 'Test',
    ...overrides,
  };
}

function makeIssues(patterns: RecurringPattern[]): CommonIssuesFile {
  return { recurring_patterns: patterns };
}

// --- computeReporterSeverity ---

describe('computeReporterSeverity', () => {
  it('returns low for 1 reporter', () => {
    expect(computeReporterSeverity(['alice'])).toBe('low');
  });

  it('returns medium for 2 reporters', () => {
    expect(computeReporterSeverity(['alice', 'bob'])).toBe('medium');
  });

  it('returns high for 3+ reporters', () => {
    expect(computeReporterSeverity(['alice', 'bob', 'charlie'])).toBe('high');
  });

  it('deduplicates reporters before counting', () => {
    expect(computeReporterSeverity(['alice', 'alice', 'alice'])).toBe('low');
  });

  it('returns low for empty list', () => {
    expect(computeReporterSeverity([])).toBe('low');
  });
});

// --- mergeHazardIndices ---

describe('mergeHazardIndices', () => {
  it('adds new pattern with reporter', () => {
    const existing = makeIssues([]);
    const newPattern = makePattern({ id: 1, sprints_hit: [5] });
    const result = mergeHazardIndices(existing, [newPattern], 'alice');
    expect(result.recurring_patterns).toHaveLength(1);
    expect(result.recurring_patterns[0].reported_by).toEqual(['alice']);
  });

  it('merges existing pattern: unions sprints and accumulates reporters', () => {
    const existing = makeIssues([makePattern({ id: 1, sprints_hit: [1, 2], reported_by: ['alice'] })]);
    const newPattern = makePattern({ id: 1, sprints_hit: [2, 3] });
    const result = mergeHazardIndices(existing, [newPattern], 'bob');
    const merged = result.recurring_patterns[0];
    expect(merged.sprints_hit).toEqual([1, 2, 3]);
    expect(merged.reported_by).toEqual(['alice', 'bob']);
  });

  it('does not duplicate reporters', () => {
    const existing = makeIssues([makePattern({ id: 1, reported_by: ['alice'] })]);
    const newPattern = makePattern({ id: 1 });
    const result = mergeHazardIndices(existing, [newPattern], 'alice');
    expect(result.recurring_patterns[0].reported_by).toEqual(['alice']);
  });

  it('handles empty inputs', () => {
    const result = mergeHazardIndices(makeIssues([]), [], 'alice');
    expect(result.recurring_patterns).toEqual([]);
  });

  it('preserves unmatched existing patterns', () => {
    const existing = makeIssues([makePattern({ id: 1 }), makePattern({ id: 2, title: 'Other' })]);
    const newPattern = makePattern({ id: 1, sprints_hit: [5] });
    const result = mergeHazardIndices(existing, [newPattern], 'alice');
    expect(result.recurring_patterns).toHaveLength(2);
  });
});

// --- filterHazardsByVisibility ---

describe('filterHazardsByVisibility', () => {
  const issues = makeIssues([
    makePattern({ id: 1, reported_by: ['alice'] }),
    makePattern({ id: 2, reported_by: ['bob'] }),
    makePattern({ id: 3, reported_by: ['alice', 'bob'] }),
    makePattern({ id: 4 }),
  ]);

  it('returns all for team-wide', () => {
    const result = filterHazardsByVisibility(issues, { teamWide: true });
    expect(result.recurring_patterns).toHaveLength(4);
  });

  it('returns all when no flags set', () => {
    const result = filterHazardsByVisibility(issues, {});
    expect(result.recurring_patterns).toHaveLength(4);
  });

  it('filters by player with personal flag', () => {
    const result = filterHazardsByVisibility(issues, { player: 'alice', teamWide: false });
    const ids = result.recurring_patterns.map(p => p.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).toContain(4); // no reported_by = visible to all
    expect(ids).not.toContain(2);
  });

  it('playerless patterns visible to all players', () => {
    const result = filterHazardsByVisibility(issues, { player: 'charlie', teamWide: false });
    const ids = result.recurring_patterns.map(p => p.id);
    expect(ids).toEqual([4]); // only the one without reported_by
  });
});
