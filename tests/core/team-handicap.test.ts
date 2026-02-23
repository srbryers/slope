import { describe, it, expect } from 'vitest';
import {
  extractRoleData,
  computeRoleHandicap,
  computeSwarmEfficiency,
  analyzeRoleCombinations,
  computeTeamHandicap,
} from '../../src/core/team-handicap.js';
import type { GolfScorecard, AgentBreakdown, ShotRecord, HoleStats } from '../../src/core/types.js';
import { computeStatsFromShots } from '../../src/core/builder.js';

// --- Helpers ---

function makeShot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    ticket_key: 'S15-1',
    title: 'Test',
    club: 'short_iron',
    result: 'green',
    hazards: [],
    ...overrides,
  };
}

function makeAgent(role: string, shots: ShotRecord[]): AgentBreakdown {
  const stats = computeStatsFromShots(shots);
  return {
    session_id: `sess-${role}`,
    agent_role: role,
    shots,
    score: shots.length,
    stats,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  const shots = overrides.shots ?? [makeShot(), makeShot(), makeShot(), makeShot()];
  return {
    sprint_number: 15,
    theme: 'Test',
    par: 4,
    slope: 2,
    score: shots.length,
    score_label: 'par',
    date: '2026-02-22',
    shots,
    conditions: [],
    special_plays: [],
    stats: computeStatsFromShots(shots),
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

// --- extractRoleData ---

describe('extractRoleData', () => {
  it('groups agent breakdowns by role', () => {
    const cards = [
      makeCard({
        agents: [
          makeAgent('backend', [makeShot(), makeShot()]),
          makeAgent('frontend', [makeShot()]),
        ],
      }),
      makeCard({
        sprint_number: 16,
        agents: [
          makeAgent('backend', [makeShot()]),
        ],
      }),
    ];

    const roleData = extractRoleData(cards);
    expect(roleData.size).toBe(2);
    expect(roleData.get('backend')).toHaveLength(2);
    expect(roleData.get('frontend')).toHaveLength(1);
  });

  it('skips scorecards without agents', () => {
    const cards = [
      makeCard(), // No agents
      makeCard({ agents: [makeAgent('devops', [makeShot()])] }),
    ];

    const roleData = extractRoleData(cards);
    expect(roleData.size).toBe(1);
    expect(roleData.has('devops')).toBe(true);
  });

  it('returns empty map when no swarm scorecards', () => {
    const roleData = extractRoleData([makeCard(), makeCard()]);
    expect(roleData.size).toBe(0);
  });
});

// --- computeRoleHandicap ---

describe('computeRoleHandicap', () => {
  it('computes stats from multiple sprint participations', () => {
    const breakdowns = [
      makeAgent('backend', [
        makeShot({ result: 'in_the_hole' }),
        makeShot({ result: 'green' }),
      ]),
      makeAgent('backend', [
        makeShot({ result: 'fairway' }),
        makeShot({ result: 'missed_long' }),
      ]),
    ];

    const handicap = computeRoleHandicap('backend', breakdowns);
    expect(handicap.role).toBe('backend');
    expect(handicap.sprints_participated).toBe(2);
    expect(handicap.total_shots).toBe(4);
    expect(handicap.stats.fairway_pct).toBeGreaterThan(0);
    expect(handicap.stats.miss_pattern.long).toBe(1);
  });

  it('returns zeroed stats for empty breakdowns', () => {
    const handicap = computeRoleHandicap('unknown', []);
    expect(handicap.sprints_participated).toBe(0);
    expect(handicap.total_shots).toBe(0);
    expect(handicap.stats.handicap).toBe(0);
  });

  it('computes handicap as average score per participation', () => {
    const breakdowns = [
      makeAgent('frontend', [makeShot(), makeShot()]), // score 2
      makeAgent('frontend', [makeShot(), makeShot(), makeShot()]), // score 3
    ];

    const handicap = computeRoleHandicap('frontend', breakdowns);
    expect(handicap.stats.handicap).toBe(2.5); // (2+3)/2
  });
});

// --- computeSwarmEfficiency ---

describe('computeSwarmEfficiency', () => {
  it('computes efficiency from swarm scorecards', () => {
    const cards = [
      makeCard({
        agents: [
          makeAgent('backend', [makeShot(), makeShot()]),
          makeAgent('frontend', [makeShot(), makeShot()]),
        ],
      }),
    ];

    const efficiency = computeSwarmEfficiency(cards);
    expect(efficiency.total_sprints).toBe(1);
    expect(efficiency.total_agents).toBe(2);
    expect(efficiency.total_shots).toBe(4);
    expect(efficiency.efficiency_ratio).toBe(100); // no coordination events
  });

  it('accounts for coordination events in efficiency', () => {
    const shots = [makeShot(), makeShot()];
    const cards = [
      makeCard({
        shots,
        score: 2,
        agents: [makeAgent('backend', shots)],
      }),
    ];

    const efficiency = computeSwarmEfficiency(cards, 2);
    // 2 shots / (2 shots + 2 coord) = 50%
    expect(efficiency.efficiency_ratio).toBe(50);
    expect(efficiency.coordination_events).toBe(2);
  });

  it('returns zeroed stats when no swarm cards', () => {
    const efficiency = computeSwarmEfficiency([makeCard()]);
    expect(efficiency.total_sprints).toBe(0);
    expect(efficiency.efficiency_ratio).toBe(0);
  });

  it('computes avg score vs par', () => {
    const cards = [
      makeCard({
        par: 4,
        score: 5,
        agents: [makeAgent('backend', [makeShot()])],
      }),
      makeCard({
        sprint_number: 16,
        par: 4,
        score: 3,
        agents: [makeAgent('frontend', [makeShot()])],
      }),
    ];

    const efficiency = computeSwarmEfficiency(cards);
    expect(efficiency.avg_score_vs_par).toBe(0); // (+1 + -1) / 2 = 0
  });
});

// --- analyzeRoleCombinations ---

describe('analyzeRoleCombinations', () => {
  it('groups sprints by role combination', () => {
    const cards = [
      makeCard({
        agents: [
          makeAgent('backend', [makeShot()]),
          makeAgent('frontend', [makeShot()]),
        ],
      }),
      makeCard({
        sprint_number: 16,
        agents: [
          makeAgent('backend', [makeShot()]),
          makeAgent('frontend', [makeShot()]),
        ],
      }),
      makeCard({
        sprint_number: 17,
        agents: [
          makeAgent('devops', [makeShot()]),
        ],
      }),
    ];

    const combos = analyzeRoleCombinations(cards);
    expect(combos).toHaveLength(2);

    const bfCombo = combos.find(c => c.roles.includes('backend'));
    expect(bfCombo?.sprint_count).toBe(2);
    expect(bfCombo?.roles).toEqual(['backend', 'frontend']);

    const devopsCombo = combos.find(c => c.roles.includes('devops'));
    expect(devopsCombo?.sprint_count).toBe(1);
  });

  it('returns empty for non-swarm cards', () => {
    expect(analyzeRoleCombinations([makeCard()])).toEqual([]);
  });
});

// --- computeTeamHandicap ---

describe('computeTeamHandicap', () => {
  it('builds a complete team handicap card', () => {
    const cards = [
      makeCard({
        agents: [
          makeAgent('backend', [makeShot({ result: 'in_the_hole' }), makeShot()]),
          makeAgent('frontend', [makeShot(), makeShot()]),
        ],
      }),
    ];

    const team = computeTeamHandicap(cards);
    expect(team.overall.handicap).toBeGreaterThanOrEqual(0);
    expect(team.by_role).toHaveLength(2);
    expect(team.swarm_efficiency.total_sprints).toBe(1);
    expect(team.role_combinations).toHaveLength(1);
  });

  it('sorts roles by participation count', () => {
    const cards = [
      makeCard({
        agents: [
          makeAgent('backend', [makeShot()]),
          makeAgent('frontend', [makeShot()]),
        ],
      }),
      makeCard({
        sprint_number: 16,
        agents: [
          makeAgent('backend', [makeShot()]),
        ],
      }),
    ];

    const team = computeTeamHandicap(cards);
    expect(team.by_role[0].role).toBe('backend'); // 2 sprints
    expect(team.by_role[1].role).toBe('frontend'); // 1 sprint
  });

  it('handles mixed solo and swarm scorecards', () => {
    const cards = [
      makeCard(), // solo
      makeCard({
        sprint_number: 16,
        agents: [makeAgent('backend', [makeShot()])],
      }),
    ];

    const team = computeTeamHandicap(cards);
    expect(team.overall.handicap).toBeGreaterThanOrEqual(0);
    expect(team.swarm_efficiency.total_sprints).toBe(1); // only swarm card counted
    expect(team.by_role).toHaveLength(1);
  });
});
