import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadScorecards, detectLatestSprint, discoverScorecardFiles, normalizeScorecard } from '../../src/core/loader.js';
import type { SlopeConfig } from '../../src/core/config.js';

const TMP = join(__dirname, '__loader_tmp__');

const baseConfig: SlopeConfig = {
  scorecardDir: 'retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '',
  sessionsPath: '',
  registry: 'file',
  claimsPath: '',
  roadmapPath: '',
  metaphor: 'golf',
};

function writeCard(dir: string, filename: string, sprintNumber: number): void {
  const card = {
    sprint_number: sprintNumber,
    theme: `Sprint ${sprintNumber}`,
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    date: '2026-01-01',
    shots: [],
    stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
    conditions: [],
    special_plays: [],
    bunker_locations: [],
    yardage_book_updates: [],
    course_management_notes: [],
  };
  writeFileSync(join(dir, filename), JSON.stringify(card));
}

function writeNestedCard(retrosDir: string, dirname: string, sprintNumber: number): void {
  const nestedDir = join(retrosDir, dirname);
  mkdirSync(nestedDir, { recursive: true });
  writeCard(nestedDir, 'scorecard.json', sprintNumber);
}

describe('loadScorecards — numeric sort', () => {
  const retrosDir = join(TMP, 'retros');

  beforeEach(() => {
    mkdirSync(retrosDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('sorts sprint-9 before sprint-20 (numeric, not lexicographic)', () => {
    writeCard(retrosDir, 'sprint-20.json', 20);
    writeCard(retrosDir, 'sprint-9.json', 9);
    writeCard(retrosDir, 'sprint-2.json', 2);

    const cards = loadScorecards(baseConfig, TMP);
    const numbers = cards.map(c => c.sprint_number);
    expect(numbers).toEqual([2, 9, 20]);
  });

  it('sorts double-digit sprints correctly', () => {
    for (const n of [1, 2, 10, 11, 20, 3, 9]) {
      writeCard(retrosDir, `sprint-${n}.json`, n);
    }

    const cards = loadScorecards(baseConfig, TMP);
    const numbers = cards.map(c => c.sprint_number);
    expect(numbers).toEqual([1, 2, 3, 9, 10, 11, 20]);
  });

  it('returns empty array for missing directory', () => {
    rmSync(TMP, { recursive: true, force: true });
    const cards = loadScorecards(baseConfig, TMP);
    expect(cards).toEqual([]);
  });

  it('respects minSprint filter', () => {
    writeCard(retrosDir, 'sprint-1.json', 1);
    writeCard(retrosDir, 'sprint-5.json', 5);
    writeCard(retrosDir, 'sprint-10.json', 10);

    const cards = loadScorecards({ ...baseConfig, minSprint: 5 }, TMP);
    const numbers = cards.map(c => c.sprint_number);
    expect(numbers).toEqual([5, 10]);
  });

  it('normalizes missing score fields to a neutral par score', () => {
    const card = {
      sprint_number: 153,
      sprint_label: 'S153',
      par: 4,
      slope: 3,
      tickets: [],
      shots: [],
    };
    writeFileSync(join(retrosDir, 'sprint-153.json'), JSON.stringify(card));

    const cards = loadScorecards(baseConfig, TMP);
    expect(cards[0].score).toBe(4);
    expect(cards[0].score_label).toBe('par');
  });

  it('normalizes stats totals from legacy tickets when shots are absent', () => {
    const card = normalizeScorecard({
      sprint_number: 197,
      theme: 'Legacy tickets',
      slope: 2,
      date: '2026-06-03',
      tickets: [
        { id: 'S197-1', title: 'Ticket 1', approach: 'short_iron', result: 'green' },
        { id: 'S197-2', title: 'Ticket 2', approach: 'short_iron', result: 'short' },
      ],
      stats: {},
    });

    expect(card.shots).toHaveLength(2);
    expect(card.shots[1].result).toBe('missed_short');
    expect(card.stats.fairways_total).toBe(2);
    expect(card.stats.greens_total).toBe(2);
    expect(card.stats.miss_directions.short).toBe(1);
  });

  it('loads and sorts decimal scorecard filenames for inserted sub-sprints', () => {
    writeCard(retrosDir, 'sprint-44.json', 44);
    writeCard(retrosDir, 'sprint-43.5.json', 43.5);

    const cards = loadScorecards(baseConfig, TMP);
    expect(cards.map(c => c.sprint_number)).toEqual([43.5, 44]);
  });

  it('also loads nested sN/scorecard.json scorecards for repos that keep sprint artifacts together', () => {
    writeCard(retrosDir, 'sprint-103.json', 103);
    writeNestedCard(retrosDir, 's104', 104);
    writeNestedCard(retrosDir, 's155', 155);

    const cards = loadScorecards(baseConfig, TMP);
    expect(cards.map(c => c.sprint_number)).toEqual([103, 104, 155]);
  });

  it('prefers configured top-level scorecards over nested duplicates for the same sprint', () => {
    writeCard(retrosDir, 'sprint-104.json', 104);
    writeNestedCard(retrosDir, 's104', 104);

    const cards = loadScorecards(baseConfig, TMP);
    expect(cards.map(c => c.sprint_number)).toEqual([104]);
    expect(cards).toHaveLength(1);
  });

  it('discovers nested scorecard paths for validation commands', () => {
    writeCard(retrosDir, 'sprint-103.json', 103);
    writeNestedCard(retrosDir, 's104', 104);

    const files = discoverScorecardFiles(baseConfig, TMP);
    expect(files.map(f => f.replace(TMP, ''))).toEqual([
      '/retros/sprint-103.json',
      '/retros/s104/scorecard.json',
    ]);
  });
});

describe('detectLatestSprint', () => {
  const retrosDir = join(TMP, 'retros');

  beforeEach(() => {
    mkdirSync(retrosDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns the highest sprint number regardless of file order', () => {
    writeCard(retrosDir, 'sprint-9.json', 9);
    writeCard(retrosDir, 'sprint-20.json', 20);
    writeCard(retrosDir, 'sprint-2.json', 2);

    const latest = detectLatestSprint(baseConfig, TMP);
    expect(latest).toBe(20);
  });

  it('orders decimal inserted scorecards before the next canonical sprint', () => {
    writeCard(retrosDir, 'sprint-43.5.json', 43.5);
    writeCard(retrosDir, 'sprint-44.json', 44);

    const latest = detectLatestSprint(baseConfig, TMP);
    expect(latest).toBe(44);
  });

  it('detects latest sprint from nested sN/scorecard.json scorecards', () => {
    writeCard(retrosDir, 'sprint-103.json', 103);
    writeNestedCard(retrosDir, 's155', 155);

    const latest = detectLatestSprint(baseConfig, TMP);
    expect(latest).toBe(155);
  });

  it('returns 0 for no scorecards', () => {
    const latest = detectLatestSprint(baseConfig, TMP);
    expect(latest).toBe(0);
  });
});
