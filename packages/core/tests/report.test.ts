import { describe, it, expect } from 'vitest';
import type { GolfScorecard } from '../src/types.js';
import { buildReportData, generateHtmlReport } from '../src/report.js';

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
      { ticket_key: 'T-3', title: 'Task 3', club: 'short_iron', result: 'fairway', hazards: [] },
      { ticket_key: 'T-4', title: 'Task 4', club: 'putter', result: 'in_the_hole', hazards: [] },
    ],
    stats: {
      fairways_hit: 3,
      fairways_total: 4,
      greens_in_regulation: 3,
      greens_total: 4,
      putts: 1,
      penalties: 0,
      hazards_hit: 0,
      hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    conditions: [],
    special_plays: [],
    nutrition: [
      { category: 'hydration', description: 'Test', status: 'healthy' },
      { category: 'diet', description: 'Test', status: 'needs_attention' },
    ],
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
  }));
}

describe('buildReportData', () => {
  it('builds report data from scorecards', () => {
    const cards = makeScorecards(5);
    const data = buildReportData(cards);

    expect(data.sprintCount).toBe(5);
    expect(data.scorecards).toHaveLength(5);
    expect(data.handicapCard).toBeDefined();
    expect(data.dispersion).toBeDefined();
    expect(data.areaPerformance).toBeDefined();
    expect(data.sprintTrend).toHaveLength(5);
    expect(data.generatedAt).toBeTruthy();
  });

  it('sorts scorecards by sprint number', () => {
    const cards = [makeScorecard({ sprint_number: 3 }), makeScorecard({ sprint_number: 1 })];
    const data = buildReportData(cards);

    expect(data.scorecards[0].sprint_number).toBe(1);
    expect(data.scorecards[1].sprint_number).toBe(3);
    expect(data.sprintTrend[0].sprintNumber).toBe(1);
  });

  it('computes sprint trend entries correctly', () => {
    const card = makeScorecard({ sprint_number: 5, par: 4, score: 3 });
    const data = buildReportData([card]);

    expect(data.sprintTrend[0]).toEqual(expect.objectContaining({
      sprintNumber: 5,
      par: 4,
      score: 3,
      differential: -1,
    }));
  });

  it('aggregates nutrition trends across sprints', () => {
    const cards = makeScorecards(3);
    const data = buildReportData(cards);

    const hydration = data.nutritionTrends.find(t => t.category === 'hydration');
    expect(hydration).toBeDefined();
    expect(hydration!.total).toBe(3);
    expect(hydration!.healthy).toBe(3);
  });

  it('handles empty scorecards array', () => {
    const data = buildReportData([]);

    expect(data.sprintCount).toBe(0);
    expect(data.sprintTrend).toHaveLength(0);
    expect(data.nutritionTrends).toHaveLength(0);
  });

  it('excludes nutrition categories with zero entries', () => {
    const card = makeScorecard({ nutrition: [] });
    const data = buildReportData([card]);

    expect(data.nutritionTrends).toHaveLength(0);
  });
});

describe('generateHtmlReport', () => {
  it('generates valid HTML document', () => {
    const data = buildReportData(makeScorecards(3));
    const html = generateHtmlReport(data);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
  });

  it('includes all major sections', () => {
    const data = buildReportData(makeScorecards(3));
    const html = generateHtmlReport(data);

    expect(html).toContain('Performance Trend');
    expect(html).toContain('Dispersion');
    expect(html).toContain('Approach Performance');
    expect(html).toContain('Nutrition');
    expect(html).toContain('Sprint History');
  });

  it('embeds SVG charts', () => {
    const data = buildReportData(makeScorecards(3));
    const html = generateHtmlReport(data);

    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
    expect(html).toContain('<polyline');
    expect(html).toContain('<circle');
  });

  it('includes sprint data in the table', () => {
    const cards = makeScorecards(3);
    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    expect(html).toContain('S1');
    expect(html).toContain('S2');
    expect(html).toContain('S3');
  });

  it('includes summary cards with handicap data', () => {
    const data = buildReportData(makeScorecards(5));
    const html = generateHtmlReport(data);

    expect(html).toContain('Handicap');
    expect(html).toContain('Fairway');
    expect(html).toContain('GIR');
  });

  it('renders with no data gracefully', () => {
    const data = buildReportData([]);
    const html = generateHtmlReport(data);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('0 sprints analyzed');
  });

  it('includes SLOPE footer', () => {
    const data = buildReportData(makeScorecards(1));
    const html = generateHtmlReport(data);

    expect(html).toContain('Sprint Lifecycle');
    expect(html).toContain('Operational Performance Engine');
  });

  it('escapes HTML in theme names', () => {
    const card = makeScorecard({ theme: 'Test <script>alert(1)</script>' });
    const data = buildReportData([card]);
    const html = generateHtmlReport(data);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes dispersion stats', () => {
    const cards = [makeScorecard({
      shots: [
        { ticket_key: 'T-1', title: 'Task', club: 'short_iron', result: 'missed_long', hazards: [] },
        { ticket_key: 'T-2', title: 'Task', club: 'short_iron', result: 'missed_left', hazards: [] },
        { ticket_key: 'T-3', title: 'Task', club: 'wedge', result: 'in_the_hole', hazards: [] },
      ],
    })];
    const data = buildReportData(cards);
    const html = generateHtmlReport(data);

    expect(html).toContain('Miss Rate');
    expect(html).toContain('Total Shots');
    expect(html).toContain('Dominant Miss');
  });
});

describe('generateHtmlReport — metaphor awareness', () => {
  // Import gaming metaphor for tests
  let gamingMetaphor: import('../src/metaphor.js').MetaphorDefinition;

  it('loads gaming metaphor', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    gamingMetaphor = gaming;
    expect(gamingMetaphor.id).toBe('gaming');
  });

  it('uses metaphor vocabulary in title', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, gaming);

    // Gaming review is "save point"
    expect(html).toContain('save point');
    // Should contain "level" (gaming term for sprint)
    expect(html).toContain('levels analyzed');
  });

  it('uses metaphor terms in summary cards', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, gaming);

    // Gaming handicapCard = "player stats"
    expect(html).toContain('player stats');
    // Gaming fairway = "Progress", green = "Clear"
    expect(html).toContain('Progress %');
    expect(html).toContain('Clear %');
    // Gaming scorecard = "score screen"
    expect(html).toContain('score screens');
  });

  it('uses metaphor terms in table headers', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, gaming);

    // Gaming sprint = "level"
    expect(html).toContain('<th>level</th>');
    // Gaming onTarget = "clear"
    expect(html).toContain('<th>clear</th>');
  });

  it('uses metaphor terms in dispersion labels', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const cards = [makeScorecard({
      shots: [
        { ticket_key: 'T-1', title: 'Task', club: 'short_iron', result: 'missed_long', hazards: [] },
        { ticket_key: 'T-2', title: 'Task', club: 'short_iron', result: 'in_the_hole', hazards: [] },
      ],
    })];
    const data = buildReportData(cards);
    const html = generateHtmlReport(data, gaming);

    // Gaming missDirections.long = "Over-leveled (too much scope)"
    expect(html).toContain('Over-leveled');
  });

  it('uses metaphor terms for club names in area chart', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, gaming);

    // Gaming clubs: short_iron = "Side Quest", wedge = "Fetch Quest", putter = "Tutorial"
    expect(html).toContain('Side Quest');
  });

  it('uses metaphor terms for nutrition categories', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, gaming);

    // Gaming nutrition: hydration = "Mana", diet = "HP"
    expect(html).toContain('Mana');
    expect(html).toContain('HP');
  });

  it('uses metaphor term in area performance legend', async () => {
    const { gaming } = await import('../src/metaphors/gaming.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, gaming);

    // Gaming shotResults.in_the_hole = "S-Rank"
    expect(html).toContain('S-Rank');
  });

  it('golf metaphor produces standard labels', async () => {
    const { golf } = await import('../src/metaphors/golf.js');
    const data = buildReportData(makeScorecards(2));
    const html = generateHtmlReport(data, golf);

    // Golf vocabulary: handicap card, Fairway, sprint
    expect(html).toContain('handicap card');
    expect(html).toContain('Fairway %');
    expect(html).toContain('Sprint');
  });
});
