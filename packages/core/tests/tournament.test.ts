import { describe, it, expect } from 'vitest';
import { buildTournamentReview, formatTournamentReview } from '../src/tournament.js';
import type { GolfScorecard } from '../src/types.js';

function makeCard(overrides: Partial<GolfScorecard> & { sprint_number: number }): GolfScorecard {
  return {
    theme: `Sprint ${overrides.sprint_number}`,
    par: 4,
    slope: 3,
    score: 3,
    score_label: 'birdie',
    date: '2026-02-21',
    shots: [
      { ticket_key: 'T-1', title: 'Ticket 1', club: 'short_iron', result: 'in_the_hole', hazards: [], notes: '' },
      { ticket_key: 'T-2', title: 'Ticket 2', club: 'long_iron', result: 'in_the_hole', hazards: [], notes: '' },
    ],
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 1, fairways_total: 1,
      greens_in_regulation: 1, greens_total: 1,
      putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
      miss_directions: {} as any,
    },
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  } as GolfScorecard;
}

describe('buildTournamentReview', () => {
  const cards = [
    makeCard({ sprint_number: 197, par: 4, score: 4, score_label: 'par', theme: 'Foundation' }),
    makeCard({ sprint_number: 198, par: 4, score: 3, score_label: 'birdie', theme: 'Adapters' }),
    makeCard({ sprint_number: 199, par: 4, score: 3, score_label: 'birdie', theme: 'MCP Servers' }),
    makeCard({ sprint_number: 200, par: 5, score: 4, score_label: 'birdie', theme: 'Gateway', slope: 4,
      shots: [
        { ticket_key: 'T-1', title: 'T1', club: 'driver', result: 'in_the_hole', hazards: [], notes: '' },
        { ticket_key: 'T-2', title: 'T2', club: 'long_iron', result: 'in_the_hole', hazards: [], notes: '' },
        { ticket_key: 'T-3', title: 'T3', club: 'short_iron', result: 'in_the_hole', hazards: [], notes: '' },
        { ticket_key: 'T-4', title: 'T4', club: 'long_iron', result: 'in_the_hole', hazards: [], notes: '' },
        { ticket_key: 'T-5', title: 'T5', club: 'short_iron', result: 'in_the_hole', hazards: [], notes: '' },
      ],
    }),
    makeCard({ sprint_number: 201, par: 3, score: 2, score_label: 'eagle', theme: 'Code Mode' }),
    makeCard({ sprint_number: 202, par: 4, score: 3, score_label: 'birdie', slope: 2, theme: 'Hardening' }),
  ];

  it('builds review with correct id and name', () => {
    const review = buildTournamentReview('M-09', 'Agent Tooling Decoupling', cards);
    expect(review.id).toBe('M-09');
    expect(review.name).toBe('Agent Tooling Decoupling');
  });

  it('computes correct scoring', () => {
    const review = buildTournamentReview('M-09', 'Test', cards);
    expect(review.scoring.totalPar).toBe(24);
    expect(review.scoring.totalScore).toBe(19);
    expect(review.scoring.differential).toBe(-5);
    expect(review.scoring.sprintCount).toBe(6);
  });

  it('identifies best and worst sprints', () => {
    const review = buildTournamentReview('M-09', 'Test', cards);
    expect(review.scoring.bestSprint.sprintNumber).toBe(201);
    expect(review.scoring.bestSprint.label).toBe('eagle');
    expect(review.scoring.worstSprint.sprintNumber).toBe(197);
    expect(review.scoring.worstSprint.label).toBe('par');
  });

  it('computes ticket landing rate', () => {
    const review = buildTournamentReview('M-09', 'Test', cards);
    expect(review.scoring.ticketsLanded).toBe(review.scoring.ticketCount);
    expect(review.scoring.landingRate).toBe(1);
  });

  it('sorts sprints by number', () => {
    const reversed = [...cards].reverse();
    const review = buildTournamentReview('M-09', 'Test', reversed);
    expect(review.sprints[0].sprintNumber).toBe(197);
    expect(review.sprints[5].sprintNumber).toBe(202);
  });

  it('computes club performance', () => {
    const review = buildTournamentReview('M-09', 'Test', cards);
    expect(review.clubPerformance.short_iron).toBeDefined();
    expect(review.clubPerformance.short_iron.inTheHole).toBeGreaterThan(0);
  });

  it('includes takeaways and improvements', () => {
    const review = buildTournamentReview('M-09', 'Test', cards, {
      takeaways: ['MCP SDK is clean'],
      improvements: ['Start with gateway earlier'],
      reflection: 'Great initiative.',
    });
    expect(review.takeaways).toHaveLength(1);
    expect(review.improvements).toHaveLength(1);
    expect(review.reflection).toBe('Great initiative.');
  });

  it('extracts hazards from bunker_locations', () => {
    const cardsWithHazards = [
      makeCard({
        sprint_number: 100,
        bunker_locations: [
          { gotcha_id: 'g-100-001', area: 'pnpm workspace', description: 'needs nested globs' } as any,
        ],
      }),
    ];
    const review = buildTournamentReview('T-1', 'Test', cardsWithHazards);
    expect(review.hazardIndex).toHaveLength(1);
    expect(review.hazardIndex[0].gotchaId).toBe('g-100-001');
  });
});

describe('formatTournamentReview', () => {
  it('produces markdown with all sections', () => {
    const cards = [
      makeCard({ sprint_number: 197, par: 4, score: 4, score_label: 'par', theme: 'Foundation' }),
      makeCard({ sprint_number: 198, par: 4, score: 3, score_label: 'birdie', theme: 'Adapters' }),
    ];
    const review = buildTournamentReview('M-09', 'Decoupling', cards, {
      takeaways: ['MCP is powerful'],
      improvements: ['Better planning'],
      reflection: 'Solid work.',
    });

    const md = formatTournamentReview(review);

    expect(md).toContain('# Tournament Review: Decoupling');
    expect(md).toContain('## Scoring Summary');
    expect(md).toContain('## Sprint Breakdown');
    expect(md).toContain('## Aggregate Stats');
    expect(md).toContain('## Club Performance');
    expect(md).toContain('## Strategic Takeaways');
    expect(md).toContain("## What We'd Do Differently");
    expect(md).toContain('## Reflection');
    expect(md).toContain('S197');
    expect(md).toContain('S198');
  });

  it('omits empty sections', () => {
    const cards = [makeCard({ sprint_number: 100, theme: 'Test' })];
    const review = buildTournamentReview('T-1', 'Minimal', cards);
    const md = formatTournamentReview(review);

    expect(md).not.toContain('## Hazard Index');
    expect(md).not.toContain('## Strategic Takeaways');
    expect(md).not.toContain("## What We'd Do Differently");
    expect(md).not.toContain('## Reflection');
  });
});
