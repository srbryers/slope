import { describe, it, expect } from 'vitest';
import type { GolfScorecard } from '../src/types.js';
import type { ReportData } from '../src/report.js';
import { buildReportData } from '../src/report.js';
import {
  DEFAULT_DASHBOARD_CONFIG,
  generateDashboardHtml,
  renderSprintDetail,
  renderSprintTimeline,
  generateDashboardScript,
  computeMissHeatmap,
  renderMissHeatmap,
  computeAreaHazards,
  renderAreaHazardOverlay,
} from '../src/dashboard.js';

function makeScorecard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 1,
    theme: 'Test Sprint',
    par: 4,
    slope: 2,
    score: 4,
    score_label: 'par',
    date: '2026-01-01',
    type: 'feature',
    shots: [
      { ticket_key: 'T-1', title: 'Task 1', club: 'short_iron', result: 'in_the_hole', hazards: [] },
      { ticket_key: 'T-2', title: 'Task 2', club: 'wedge', result: 'green', hazards: [] },
      { ticket_key: 'T-3', title: 'Task 3', club: 'short_iron', result: 'missed_long', hazards: [{ type: 'bunker', description: 'flaky tests' }] },
      { ticket_key: 'T-4', title: 'Task 4', club: 'putter', result: 'in_the_hole', hazards: [] },
    ],
    stats: {
      fairways_hit: 3,
      fairways_total: 4,
      greens_in_regulation: 3,
      greens_total: 4,
      putts: 1,
      penalties: 0,
      hazards_hit: 1,
      hazard_penalties: 0,
      miss_directions: { long: 1, short: 0, left: 0, right: 0 },
    },
    conditions: [{ type: 'wind', description: 'team changes', impact: 'minor' }],
    special_plays: ['mulligan'],
    nutrition: [
      { category: 'hydration', description: 'Good CI', status: 'healthy' },
      { category: 'diet', description: 'Some debt', status: 'needs_attention' },
    ],
    nineteenth_hole: {
      how_did_it_feel: 'Productive sprint',
      advice_for_next_player: 'Watch out for flaky tests',
    },
    training: [],
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

function makeScorecards(count: number): GolfScorecard[] {
  return Array.from({ length: count }, (_, i) => makeScorecard({
    sprint_number: i + 1,
    theme: `Sprint ${i + 1}`,
    score: 4 + (i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1),
    score_label: i % 3 === 0 ? 'birdie' : i % 3 === 1 ? 'par' : 'bogey',
    stats: {
      fairways_hit: 3, fairways_total: 4,
      greens_in_regulation: 3, greens_total: 4,
      putts: 1, penalties: 0, hazards_hit: i % 2, hazard_penalties: 0,
      miss_directions: { long: i % 2, short: 0, left: i % 3, right: 0 },
    },
  }));
}

// --- generateDashboardHtml ---

describe('generateDashboardHtml', () => {
  it('generates valid HTML document with DOCTYPE', () => {
    const data = buildReportData(makeScorecards(3));
    const html = generateDashboardHtml(data);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('contains nav header with title and timestamp', () => {
    const data = buildReportData(makeScorecards(2));
    const html = generateDashboardHtml(data);

    expect(html).toContain('dashboard-nav');
    expect(html).toContain('SLOPE Dashboard');
    expect(html).toContain('sprints analyzed');
  });

  it('contains auto-refresh meta tag', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateDashboardHtml(data);

    expect(html).toContain('<meta http-equiv="refresh" content="30">');
  });

  it('uses custom refreshInterval', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateDashboardHtml(data, undefined, { refreshInterval: 60 });

    expect(html).toContain('content="60"');
  });

  it('omits auto-refresh meta when refreshInterval is 0', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateDashboardHtml(data, undefined, { refreshInterval: 0 });

    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('contains all chart sections', () => {
    const data = buildReportData(makeScorecards(3));
    const html = generateDashboardHtml(data);

    expect(html).toContain('Performance Trend');
    expect(html).toContain('Timeline');
    expect(html).toContain('Dispersion');
    expect(html).toContain('Approach Performance');
    expect(html).toContain('Nutrition');
    expect(html).toContain('Sprint History');
    expect(html).toContain('Miss Pattern Heatmap');
  });

  it('contains sprint-detail container', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateDashboardHtml(data);

    expect(html).toContain('id="sprint-detail"');
  });

  it('sprint table rows have data-sprint attributes', () => {
    const data = buildReportData(makeScorecards(3));
    const html = generateDashboardHtml(data);

    expect(html).toContain('data-sprint="1"');
    expect(html).toContain('data-sprint="2"');
    expect(html).toContain('data-sprint="3"');
  });

  it('uses metaphor terms when provided', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateDashboardHtml(data, gaming);

    expect(html).toContain('player stats');
    expect(html).toContain('level');
  });

  it('includes dashboard script', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateDashboardHtml(data);

    expect(html).toContain('<script>');
    expect(html).toContain('fetch(');
    expect(html).toContain('/api/sprint/');
  });

  it('includes REPORT_CSS and dashboard CSS', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateDashboardHtml(data);

    expect(html).toContain('<style>');
    expect(html).toContain('.dashboard-nav');
    expect(html).toContain('.chart-container');
  });
});

// --- renderSprintDetail ---

describe('renderSprintDetail', () => {
  it('renders sprint header with number and theme', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('Sprint 1');
    expect(html).toContain('Test Sprint');
  });

  it('renders shot table with ticket keys', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('T-1');
    expect(html).toContain('T-2');
    expect(html).toContain('T-3');
    expect(html).toContain('T-4');
  });

  it('renders hazards in shots', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('bunker');
    expect(html).toContain('flaky tests');
  });

  it('renders conditions', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('Conditions');
    expect(html).toContain('wind');
    expect(html).toContain('team changes');
    expect(html).toContain('minor');
  });

  it('renders nutrition entries', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('Nutrition');
    expect(html).toContain('hydration');
    expect(html).toContain('healthy');
  });

  it('renders 19th hole reflections', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('19th Hole');
    expect(html).toContain('Productive sprint');
    expect(html).toContain('Watch out for flaky tests');
  });

  it('escapes HTML in notes', () => {
    const card = makeScorecard({
      shots: [{ ticket_key: 'X-1', title: 'Test', club: 'wedge', result: 'green', hazards: [], notes: '<script>alert(1)</script>' }],
    });
    const html = renderSprintDetail(card);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders special plays', () => {
    const card = makeScorecard();
    const html = renderSprintDetail(card);

    expect(html).toContain('Special Plays');
    expect(html).toContain('mulligan');
  });

  it('handles scorecard with no optional fields', () => {
    const card = makeScorecard({
      conditions: [],
      special_plays: [],
      nutrition: [],
      nineteenth_hole: undefined,
    });
    const html = renderSprintDetail(card);

    expect(html).toContain('Sprint 1');
    expect(html).not.toContain('Conditions');
    expect(html).not.toContain('19th Hole');
  });
});

// --- renderSprintTimeline ---

describe('renderSprintTimeline', () => {
  it('renders SVG with correct number of bar groups', () => {
    const data = buildReportData(makeScorecards(4));
    const html = renderSprintTimeline(data.sprintTrend);

    const barGroups = (html.match(/data-sprint="/g) ?? []).length;
    expect(barGroups).toBe(4);
  });

  it('colors bars correctly: under=green, at=blue, over=red', () => {
    const trend = [
      { sprintNumber: 1, theme: 'S1', par: 4, score: 3, differential: -1, fairwayPct: 75, girPct: 75 },
      { sprintNumber: 2, theme: 'S2', par: 4, score: 4, differential: 0, fairwayPct: 75, girPct: 75 },
      { sprintNumber: 3, theme: 'S3', par: 4, score: 5, differential: 1, fairwayPct: 75, girPct: 75 },
    ];
    const html = renderSprintTimeline(trend);

    expect(html).toContain('#22c55e'); // green (under par)
    expect(html).toContain('#3b82f6'); // blue (at par)
    expect(html).toContain('#ef4444'); // red (over par)
  });

  it('has data-sprint attributes on clickable areas', () => {
    const data = buildReportData(makeScorecards(2));
    const html = renderSprintTimeline(data.sprintTrend);

    expect(html).toContain('data-sprint="1"');
    expect(html).toContain('data-sprint="2"');
  });

  it('handles empty trend gracefully', () => {
    const html = renderSprintTimeline([]);
    expect(html).toContain('No sprint data');
  });

  it('includes legend', () => {
    const data = buildReportData(makeScorecards(2));
    const html = renderSprintTimeline(data.sprintTrend);

    expect(html).toContain('Under Par');
    expect(html).toContain('At Par');
    expect(html).toContain('Over Par');
  });
});

// --- generateDashboardScript ---

describe('generateDashboardScript', () => {
  it('contains fetch call pattern', () => {
    const script = generateDashboardScript();

    expect(script).toContain('<script>');
    expect(script).toContain('fetch(');
    expect(script).toContain('/api/sprint/');
    expect(script).toContain('sprint-detail');
  });

  it('contains toggle logic for same-sprint click', () => {
    const script = generateDashboardScript();

    expect(script).toContain('currentSprint');
  });

  it('contains scrollIntoView', () => {
    const script = generateDashboardScript();

    expect(script).toContain('scrollIntoView');
  });
});

// --- computeMissHeatmap ---

describe('computeMissHeatmap', () => {
  it('computes correct cell counts from scorecard data', () => {
    const cards = makeScorecards(3);
    const heatmap = computeMissHeatmap(cards);

    expect(heatmap.sprints).toEqual([1, 2, 3]);
    expect(heatmap.directions).toEqual(['long', 'short', 'left', 'right']);
    expect(heatmap.cells.length).toBe(12); // 3 sprints * 4 directions
  });

  it('max-count cell has intensity 1.0', () => {
    const cards = [
      makeScorecard({ sprint_number: 1, stats: { fairways_hit: 3, fairways_total: 4, greens_in_regulation: 3, greens_total: 4, putts: 1, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 5, short: 0, left: 0, right: 0 } } }),
    ];
    const heatmap = computeMissHeatmap(cards);

    expect(heatmap.maxCount).toBe(5);
    const longCell = heatmap.cells.find(c => c.direction === 'long');
    expect(longCell?.intensity).toBe(1.0);
  });

  it('empty input produces empty heatmap', () => {
    const heatmap = computeMissHeatmap([]);

    expect(heatmap.cells).toHaveLength(0);
    expect(heatmap.sprints).toHaveLength(0);
    expect(heatmap.maxCount).toBe(0);
  });

  it('no misses means all intensity 0', () => {
    const cards = [makeScorecard({
      stats: { fairways_hit: 4, fairways_total: 4, greens_in_regulation: 4, greens_total: 4, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
    })];
    const heatmap = computeMissHeatmap(cards);

    expect(heatmap.maxCount).toBe(0);
    for (const cell of heatmap.cells) {
      expect(cell.intensity).toBe(0);
    }
  });
});

// --- renderMissHeatmap ---

describe('renderMissHeatmap', () => {
  it('renders correct grid dimensions', () => {
    const heatmap = computeMissHeatmap(makeScorecards(3));
    const html = renderMissHeatmap(heatmap);

    expect(html).toContain('<svg');
    // Should have sprint labels
    expect(html).toContain('S1');
    expect(html).toContain('S2');
    expect(html).toContain('S3');
    // Should have direction labels
    expect(html).toContain('long');
    expect(html).toContain('short');
    expect(html).toContain('left');
    expect(html).toContain('right');
  });

  it('includes title tooltips', () => {
    const heatmap = computeMissHeatmap(makeScorecards(2));
    const html = renderMissHeatmap(heatmap);

    expect(html).toContain('<title>');
    expect(html).toContain('misses');
  });

  it('uses metaphor direction labels', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const heatmap = computeMissHeatmap(makeScorecards(2));
    const html = renderMissHeatmap(heatmap, gaming);

    expect(html).toContain('Over-leveled');
  });

  it('handles empty heatmap', () => {
    const heatmap = computeMissHeatmap([]);
    const html = renderMissHeatmap(heatmap);

    expect(html).toContain('No miss data');
  });
});

// --- computeAreaHazards ---

describe('computeAreaHazards', () => {
  it('counts hazards per club', () => {
    const cards = [makeScorecard()];
    const hazards = computeAreaHazards(cards);

    expect(hazards.length).toBeGreaterThan(0);
    const shortIron = hazards.find(h => h.club === 'short_iron');
    expect(shortIron).toBeDefined();
    expect(shortIron!.hazardCount).toBe(1); // T-3 has one hazard
  });

  it('identifies top hazard types', () => {
    const cards = [makeScorecard()];
    const hazards = computeAreaHazards(cards);
    const shortIron = hazards.find(h => h.club === 'short_iron');
    expect(shortIron!.topHazards[0].type).toBe('bunker');
  });

  it('handles clubs with no hazards', () => {
    const cards = [makeScorecard({
      shots: [{ ticket_key: 'T-1', title: 'Clean', club: 'wedge', result: 'in_the_hole', hazards: [] }],
    })];
    const hazards = computeAreaHazards(cards);
    const wedge = hazards.find(h => h.club === 'wedge');

    expect(wedge).toBeDefined();
    expect(wedge!.hazardCount).toBe(0);
    expect(wedge!.hazardRate).toBe(0);
  });
});

// --- renderAreaHazardOverlay ---

describe('renderAreaHazardOverlay', () => {
  it('produces valid HTML with table', () => {
    const hazards = computeAreaHazards([makeScorecard()]);
    const html = renderAreaHazardOverlay(hazards);

    expect(html).toContain('<table>');
    expect(html).toContain('Area Hazard Frequency');
    expect(html).toContain('short_iron');
  });

  it('returns empty string for no hazards', () => {
    const html = renderAreaHazardOverlay([]);
    expect(html).toBe('');
  });
});

// --- DEFAULT_DASHBOARD_CONFIG ---

describe('DEFAULT_DASHBOARD_CONFIG', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_DASHBOARD_CONFIG.port).toBe(3000);
    expect(DEFAULT_DASHBOARD_CONFIG.autoOpen).toBe(true);
    expect(DEFAULT_DASHBOARD_CONFIG.refreshInterval).toBe(30);
  });
});
