import { describe, it, expect } from 'vitest';
import { formatBriefing } from '../src/briefing.js';
import type { CommonIssuesFile, RecurringPattern } from '../src/briefing.js';
import type { GolfScorecard, ShotRecord, HoleStats, PRSignal } from '../src/types.js';

// --- Helpers ---

function makePattern(overrides: Partial<RecurringPattern> = {}): RecurringPattern {
  return {
    id: 1, title: 'Test', category: 'testing', sprints_hit: [1],
    gotcha_refs: [], description: 'desc', prevention: 'prev', ...overrides,
  };
}

function makeShot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    ticket_key: 'S18-1', title: 'Test', club: 'short_iron',
    result: 'green', hazards: [], ...overrides,
  };
}

function makeStats(overrides: Partial<HoleStats> = {}): HoleStats {
  return {
    fairways_hit: 3, fairways_total: 4, greens_in_regulation: 3, greens_total: 4,
    putts: 1, penalties: 0, hazards_hit: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 }, ...overrides,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 18, theme: 'PR Signals', par: 4, slope: 2,
    score: 4, score_label: 'par', date: '2026-02-22',
    shots: [makeShot()], conditions: [], special_plays: [],
    stats: makeStats(), yardage_book_updates: [], bunker_locations: [],
    course_management_notes: [], ...overrides,
  };
}

function makePR(overrides: Partial<PRSignal> = {}): PRSignal {
  return {
    platform: 'github', pr_number: 42, review_cycles: 2,
    change_request_count: 1, time_to_merge_minutes: 90,
    ci_checks_passed: 5, ci_checks_failed: 0, file_count: 8,
    additions: 200, deletions: 50, comment_count: 4,
    review_decision: 'APPROVED', ...overrides,
  };
}

const emptyIssues: CommonIssuesFile = { recurring_patterns: [makePattern()] };

describe('formatBriefing — PR Context section', () => {
  it('includes PR Context when prSignal is provided', () => {
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: emptyIssues,
      prSignal: makePR(),
    });
    expect(output).toContain('PR CONTEXT');
    expect(output).toContain('#42');
    expect(output).toContain('github');
    expect(output).toContain('APPROVED');
    expect(output).toContain('2 cycle(s)');
    expect(output).toContain('1 change request(s)');
    expect(output).toContain('5 passed');
    expect(output).toContain('0 failed');
    expect(output).toContain('+200');
    expect(output).toContain('-50');
    expect(output).toContain('1h 30m');
  });

  it('omits PR Context when prSignal is not provided', () => {
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: emptyIssues,
    });
    expect(output).not.toContain('PR CONTEXT');
  });

  it('shows comment density per file', () => {
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: emptyIssues,
      prSignal: makePR({ comment_count: 16, file_count: 4 }),
    });
    expect(output).toContain('4.0/file');
  });

  it('handles null time_to_merge', () => {
    const output = formatBriefing({
      scorecards: [makeCard()],
      commonIssues: emptyIssues,
      prSignal: makePR({ time_to_merge_minutes: null }),
    });
    expect(output).toContain('PR CONTEXT');
    expect(output).not.toContain('Time to merge');
  });
});
