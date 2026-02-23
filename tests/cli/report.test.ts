import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const mockConfig = {
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file' as const,
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  metaphor: 'golf',
  guidance: {} as Record<string, unknown>,
};

vi.mock('../src/config.js', () => ({
  loadConfig: () => mockConfig,
}));

// We test the core functions directly since the CLI command uses process.exit
import { buildReportData, generateHtmlReport, loadScorecards } from '../../src/core/index.js';
import type { GolfScorecard } from '../../src/core/index.js';

let tmpDir: string;

function writeScorecard(dir: string, num: number): void {
  const card: GolfScorecard = {
    sprint_number: num,
    theme: `Sprint ${num}`,
    par: 4,
    slope: 2,
    score: 4,
    score_label: 'par',
    date: `2026-01-${String(num).padStart(2, '0')}`,
    type: 'feature',
    shots: [
      { ticket_key: `S${num}-1`, title: 'Task', club: 'short_iron', result: 'in_the_hole', hazards: [] },
      { ticket_key: `S${num}-2`, title: 'Task', club: 'wedge', result: 'green', hazards: [] },
    ],
    stats: {
      fairways_hit: 2, fairways_total: 2,
      greens_in_regulation: 2, greens_total: 2,
      putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    conditions: [],
    special_plays: [],
    nutrition: [{ category: 'hydration', description: 'Test', status: 'healthy' }],
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
  };
  const retrosDir = join(dir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  writeFileSync(join(retrosDir, `sprint-${num}.json`), JSON.stringify(card));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-report-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe('report integration', () => {
  it('loads scorecards and generates HTML report', () => {
    writeScorecard(tmpDir, 1);
    writeScorecard(tmpDir, 2);
    writeScorecard(tmpDir, 3);

    const cards = loadScorecards(mockConfig, tmpDir);
    expect(cards).toHaveLength(3);

    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('3 sprints analyzed');
    expect(html).toContain('S1');
    expect(html).toContain('S2');
    expect(html).toContain('S3');
  });

  it('report can be written to file', () => {
    writeScorecard(tmpDir, 1);

    const cards = loadScorecards(mockConfig, tmpDir);
    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    const outDir = join(tmpDir, '.slope', 'reports');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'report-test.html');
    writeFileSync(outPath, html, 'utf8');

    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, 'utf8');
    expect(content).toContain('<!DOCTYPE html>');
  });

  it('handles empty scorecards directory', () => {
    const cards = loadScorecards(mockConfig, tmpDir);
    expect(cards).toHaveLength(0);

    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    expect(html).toContain('0 sprints analyzed');
  });

  it('generates self-contained HTML with embedded CSS', () => {
    writeScorecard(tmpDir, 1);

    const cards = loadScorecards(mockConfig, tmpDir);
    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    // Should be self-contained — no external CSS/JS links
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain('<script src=');
    expect(html).toContain('<style>');
  });

  it('report includes SVG charts for visualization', () => {
    writeScorecard(tmpDir, 1);
    writeScorecard(tmpDir, 2);

    const cards = loadScorecards(mockConfig, tmpDir);
    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    // Should contain embedded SVGs
    const svgCount = (html.match(/<svg/g) ?? []).length;
    expect(svgCount).toBeGreaterThanOrEqual(3); // trend chart + dispersion + area/nutrition
  });
});
