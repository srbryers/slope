import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeSlopeStats } from '../../src/cli/commands/stats.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-stats-'));
}

function writeScorecard(dir: string, sprint: number, score: number, par: number): void {
  const retrosDir = join(dir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  writeFileSync(join(retrosDir, `sprint-${sprint}.json`), JSON.stringify({
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par,
    score,
    score_label: score <= par ? 'par' : 'bogey',
    date: '2026-01-01',
    shots: Array.from({ length: score }, (_, i) => ({
      ticket_key: `S${sprint}-${i + 1}`,
      title: `Ticket ${i + 1}`,
      club: 'wedge',
      result: 'green',
      hazards: [],
    })),
    stats: {
      fairways_hit: score,
      fairways_total: score,
      greens_in_regulation: Math.floor(score * 0.8),
      greens_total: score,
      putts: 1,
      penalties: 0,
      hazards_hit: 0,
      hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    conditions: [],
    special_plays: [],
    bunker_locations: [],
    yardage_book_updates: [],
    course_management_notes: [],
  }));
}

function writeConfig(dir: string): void {
  const slopeDir = join(dir, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
  }));
}

describe('computeSlopeStats', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns zero stats when no scorecards exist', () => {
    writeConfig(tmpDir);
    const stats = computeSlopeStats(tmpDir);
    expect(stats.sprints_completed).toBe(0);
    expect(stats.recent_scorecards).toHaveLength(0);
    expect(stats.latest_scorecard).toBeNull();
    expect(stats.handicap.all_time.handicap).toBe(0);
  });

  it('computes stats from scorecards', () => {
    writeConfig(tmpDir);
    writeScorecard(tmpDir, 1, 4, 4);
    writeScorecard(tmpDir, 2, 3, 4);
    writeScorecard(tmpDir, 3, 5, 4);

    const stats = computeSlopeStats(tmpDir);
    expect(stats.sprints_completed).toBe(3);
    expect(stats.recent_scorecards).toHaveLength(3);
    expect(stats.latest_scorecard).not.toBeNull();
    expect(stats.latest_scorecard!.sprint).toBe(3);
  });

  it('produces the correct SlopeStats shape', () => {
    writeConfig(tmpDir);
    writeScorecard(tmpDir, 1, 4, 4);

    const stats = computeSlopeStats(tmpDir);

    // Top-level fields
    expect(typeof stats.sprints_completed).toBe('number');
    expect(typeof stats.total_tests).toBe('number');
    expect(typeof stats.cli_commands).toBe('number');
    expect(typeof stats.guards).toBe('number');
    expect(typeof stats.packages).toBe('number');
    expect(typeof stats.metaphors).toBe('number');

    // Handicap structure (simplified 4-field RollingStats)
    for (const window of ['last_5', 'last_10', 'all_time'] as const) {
      const rs = stats.handicap[window];
      expect(typeof rs.handicap).toBe('number');
      expect(typeof rs.fairway_pct).toBe('number');
      expect(typeof rs.gir_pct).toBe('number');
      expect(typeof rs.avg_putts).toBe('number');
      // Must NOT have extra fields from core RollingStats
      expect(Object.keys(rs)).toHaveLength(4);
    }

    // Miss pattern
    expect(stats.miss_pattern).toHaveProperty('long');
    expect(stats.miss_pattern).toHaveProperty('short');
    expect(stats.miss_pattern).toHaveProperty('left');
    expect(stats.miss_pattern).toHaveProperty('right');

    // Recent scorecards shape
    expect(Array.isArray(stats.recent_scorecards)).toBe(true);
    if (stats.recent_scorecards.length > 0) {
      const sc = stats.recent_scorecards[0];
      expect(typeof sc.sprint).toBe('number');
      expect(typeof sc.par).toBe('number');
      expect(typeof sc.score).toBe('number');
      expect(typeof sc.score_label).toBe('string');
      expect(typeof sc.theme).toBe('string');
    }

    // Latest scorecard shape
    expect(stats.latest_scorecard).not.toBeNull();
    const ls = stats.latest_scorecard!;
    expect(typeof ls.stats.fairway_hits).toBe('number');
    expect(typeof ls.stats.fairway_total).toBe('number');
    expect(typeof ls.stats.gir).toBe('number');
    expect(typeof ls.stats.hazards_hit).toBe('number');

    // Milestones
    expect(Array.isArray(stats.handicap_milestones)).toBe(true);
  });

  it('limits recent_scorecards to 5', () => {
    writeConfig(tmpDir);
    for (let i = 1; i <= 8; i++) {
      writeScorecard(tmpDir, i, 4, 4);
    }
    const stats = computeSlopeStats(tmpDir);
    expect(stats.recent_scorecards).toHaveLength(5);
    // Most recent first
    expect(stats.recent_scorecards[0].sprint).toBe(8);
  });

  it('computes handicap milestones at every 5th sprint', () => {
    writeConfig(tmpDir);
    for (let i = 1; i <= 12; i++) {
      writeScorecard(tmpDir, i, 4, 4);
    }
    const stats = computeSlopeStats(tmpDir);
    const milestoneNumbers = stats.handicap_milestones.map(m => m.sprint);
    expect(milestoneNumbers).toContain(5);
    expect(milestoneNumbers).toContain(10);
    expect(milestoneNumbers).toContain(12); // latest
  });

  it('counts cli_commands from registry', () => {
    writeConfig(tmpDir);
    const stats = computeSlopeStats(tmpDir);
    expect(stats.cli_commands).toBeGreaterThan(30);
  });

  it('counts guards from definitions', () => {
    writeConfig(tmpDir);
    const stats = computeSlopeStats(tmpDir);
    expect(stats.guards).toBeGreaterThan(10);
  });

  it('counts metaphors from registry', () => {
    writeConfig(tmpDir);
    const stats = computeSlopeStats(tmpDir);
    expect(stats.metaphors).toBeGreaterThanOrEqual(7);
  });
});
