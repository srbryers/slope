import { describe, it, expect } from 'vitest';
import {
  buildLeaderboard,
  formatLeaderboard,
  renderLeaderboardHtml,
} from '../src/leaderboard.js';
import type { GolfScorecard } from '../src/types.js';
import { golf } from '../src/metaphors/index.js';

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
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

// --- buildLeaderboard ---

describe('buildLeaderboard', () => {
  it('returns empty entries for no scorecards', () => {
    const lb = buildLeaderboard([]);
    expect(lb.entries).toEqual([]);
    expect(lb.generatedAt).toBeDefined();
  });

  it('builds single player leaderboard', () => {
    const lb = buildLeaderboard([makeCard({ player: 'alice', sprint_number: 1 })]);
    expect(lb.entries).toHaveLength(1);
    expect(lb.entries[0].player).toBe('alice');
    expect(lb.entries[0].rank).toBe(1);
  });

  it('ranks by handicap ascending', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1, score: 3, par: 3 }),
      makeCard({ player: 'bob', sprint_number: 2, score: 5, par: 3 }),
    ];
    const lb = buildLeaderboard(cards);
    expect(lb.entries[0].player).toBe('alice');
    expect(lb.entries[1].player).toBe('bob');
    expect(lb.entries[0].rank).toBe(1);
    expect(lb.entries[1].rank).toBe(2);
  });

  it('assigns same rank for ties', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1, score: 3, par: 3 }),
      makeCard({ player: 'bob', sprint_number: 2, score: 3, par: 3 }),
    ];
    const lb = buildLeaderboard(cards);
    expect(lb.entries[0].rank).toBe(1);
    expect(lb.entries[1].rank).toBe(1);
  });

  it('computes improvement trend when >= 5 scorecards', () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      makeCard({ player: 'alice', sprint_number: i + 1, score: i < 3 ? 5 : 3, par: 3 }),
    );
    const lb = buildLeaderboard(cards);
    // Last 5 should have lower handicap than all-time since later scores are at par
    expect(lb.entries[0].improvementTrend).toBeLessThanOrEqual(0);
  });

  it('treats default player correctly', () => {
    const cards = [
      makeCard({ sprint_number: 1, score: 4, par: 3 }),
      makeCard({ player: 'bob', sprint_number: 2, score: 3, par: 3 }),
    ];
    const lb = buildLeaderboard(cards);
    expect(lb.entries.some(e => e.player === 'default')).toBe(true);
    expect(lb.entries.some(e => e.player === 'bob')).toBe(true);
  });
});

// --- formatLeaderboard ---

describe('formatLeaderboard', () => {
  it('outputs text table with headers', () => {
    const lb = buildLeaderboard([
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ player: 'bob', sprint_number: 2 }),
    ]);
    const text = formatLeaderboard(lb);
    expect(text).toContain('Rank');
    expect(text).toContain('Player');
    expect(text).toContain('Handicap');
    expect(text).toContain('alice');
    expect(text).toContain('bob');
  });

  it('includes content for all entries', () => {
    const lb = buildLeaderboard([
      makeCard({ player: 'alice', sprint_number: 1 }),
    ]);
    const text = formatLeaderboard(lb);
    expect(text).toContain('alice');
    expect(text).toContain('Fairway%');
  });
});

// --- renderLeaderboardHtml ---

describe('renderLeaderboardHtml', () => {
  it('returns message for empty leaderboard', () => {
    const lb = buildLeaderboard([]);
    const html = renderLeaderboardHtml(lb);
    expect(html).toContain('No leaderboard data');
  });

  it('produces valid HTML table structure', () => {
    const lb = buildLeaderboard([
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ player: 'bob', sprint_number: 2 }),
    ]);
    const html = renderLeaderboardHtml(lb);
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('alice');
    expect(html).toContain('bob');
  });

  it('includes all required columns', () => {
    const lb = buildLeaderboard([makeCard({ player: 'alice', sprint_number: 1 })]);
    const html = renderLeaderboardHtml(lb);
    expect(html).toContain('Rank');
    expect(html).toContain('Player');
    expect(html).toContain('Handicap');
    expect(html).toContain('Cards');
    expect(html).toContain('Fairway%');
    expect(html).toContain('GIR%');
    expect(html).toContain('Trend');
  });

  it('accepts metaphor parameter', () => {
    const lb = buildLeaderboard([makeCard({ player: 'alice', sprint_number: 1 })]);
    const html = renderLeaderboardHtml(lb, golf);
    expect(html).toContain('<table>');
  });
});

// --- Dashboard integration ---

describe('dashboard leaderboard integration', () => {
  it('buildLeaderboard returns correct structure', () => {
    const cards = [
      makeCard({ player: 'alice', sprint_number: 1 }),
      makeCard({ player: 'bob', sprint_number: 2 }),
    ];
    const lb = buildLeaderboard(cards);
    expect(lb.entries).toHaveLength(2);
    expect(lb.entries[0]).toHaveProperty('rank');
    expect(lb.entries[0]).toHaveProperty('player');
    expect(lb.entries[0]).toHaveProperty('handicap');
    expect(lb.generatedAt).toBeTruthy();
  });
});
