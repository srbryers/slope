import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadScorecards, detectLatestSprint } from '../src/loader.js';
import type { SlopeConfig } from '../src/config.js';

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
    stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
    conditions: [],
    special_plays: [],
    bunker_locations: [],
    yardage_book_updates: [],
    course_management_notes: [],
  };
  writeFileSync(join(dir, filename), JSON.stringify(card));
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

  it('returns 0 for no scorecards', () => {
    const latest = detectLatestSprint(baseConfig, TMP);
    expect(latest).toBe(0);
  });
});
