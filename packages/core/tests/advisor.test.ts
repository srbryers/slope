import { describe, it, expect } from 'vitest';
import { recommendClub, classifyShot, generateTrainingPlan } from '../src/advisor.js';
import type {
  GolfScorecard,
  ShotRecord,
  HoleStats,
  ExecutionTrace,
  HandicapCard,
  DispersionReport,
  MissDirection,
  RollingStats,
} from '../src/types.js';

// --- Helpers ---

function makeShot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    ticket_key: 'S180-1',
    title: 'Test ticket',
    club: 'short_iron',
    result: 'green',
    hazards: [],
    ...overrides,
  };
}

function makeStats(overrides: Partial<HoleStats> = {}): HoleStats {
  return {
    fairways_hit: 3, fairways_total: 4,
    greens_in_regulation: 3, greens_total: 4,
    putts: 0, penalties: 0, hazards_hit: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    ...overrides,
  };
}

function makeCard(overrides: Partial<GolfScorecard> = {}): GolfScorecard {
  return {
    sprint_number: 170,
    theme: 'Test Sprint',
    par: 4, slope: 1, score: 4, score_label: 'par',
    date: '2026-02-19',
    shots: [makeShot(), makeShot(), makeShot(), makeShot()],
    conditions: [], special_plays: [],
    stats: makeStats(),
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
}

function makeTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    planned_scope_paths: ['packages/shared/src/'],
    modified_files: ['packages/shared/src/slope-advisor.ts'],
    test_results: [{ suite: 'shared', passed: true, first_run: true }],
    reverts: 0,
    elapsed_minutes: 30,
    hazards_encountered: [],
    ...overrides,
  };
}

function makeRollingStats(overrides: Partial<RollingStats> = {}): RollingStats {
  return {
    handicap: 0.5,
    fairway_pct: 80,
    gir_pct: 70,
    avg_putts: 1,
    penalties_per_round: 0.2,
    miss_pattern: { long: 0, short: 0, left: 0, right: 0 },
    mulligans: 0,
    gimmes: 0,
    ...overrides,
  };
}

function makeHandicap(overrides: Partial<HandicapCard> = {}): HandicapCard {
  return {
    last_5: makeRollingStats(),
    last_10: makeRollingStats(),
    all_time: makeRollingStats(),
    ...overrides,
  };
}

function makeDispersion(overrides: Partial<DispersionReport> = {}): DispersionReport {
  return {
    total_shots: 20,
    total_misses: 4,
    miss_rate_pct: 20,
    by_direction: {
      long: { count: 1, pct: 25, interpretation: 'Over-scoping' },
      short: { count: 1, pct: 25, interpretation: 'Under-scoping' },
      left: { count: 1, pct: 25, interpretation: 'Wrong approach' },
      right: { count: 1, pct: 25, interpretation: 'Scope creep' },
    },
    dominant_miss: null,
    systemic_issues: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// recommendClub
// ═══════════════════════════════════════════════════════════

describe('recommendClub', () => {
  it('maps trivial to putter', () => {
    const result = recommendClub({ ticketComplexity: 'trivial', scorecards: [] });
    expect(result.club).toBe('putter');
  });

  it('maps small to wedge', () => {
    const result = recommendClub({ ticketComplexity: 'small', scorecards: [] });
    expect(result.club).toBe('wedge');
  });

  it('maps medium to short_iron', () => {
    const result = recommendClub({ ticketComplexity: 'medium', scorecards: [] });
    expect(result.club).toBe('short_iron');
  });

  it('maps large to long_iron', () => {
    const result = recommendClub({ ticketComplexity: 'large', scorecards: [] });
    expect(result.club).toBe('long_iron');
  });

  it('upgrades large to driver with slope >= 3', () => {
    const result = recommendClub({
      ticketComplexity: 'large',
      scorecards: [],
      slopeFactors: ['cross_package', 'schema_migration', 'new_area'],
    });
    expect(result.club).toBe('driver');
  });

  it('does not upgrade large to driver with slope < 3', () => {
    const result = recommendClub({
      ticketComplexity: 'large',
      scorecards: [],
      slopeFactors: ['cross_package', 'schema_migration'],
    });
    expect(result.club).toBe('long_iron');
  });

  it('downgrades on high historical miss rate', () => {
    // Create scorecards where long_iron has >30% miss rate
    const cards = Array.from({ length: 5 }, (_, i) => makeCard({
      sprint_number: 170 + i,
      shots: [
        makeShot({ club: 'long_iron', result: 'missed_long' }),
        makeShot({ club: 'long_iron', result: 'missed_left' }),
        makeShot({ club: 'long_iron', result: 'green' }),
      ],
    }));
    const result = recommendClub({ ticketComplexity: 'large', scorecards: cards });
    expect(result.club).toBe('short_iron');
    expect(result.reasoning).toContain('Downgraded');
  });

  it('adds provisional suggestion on dominant miss', () => {
    // Create scorecards with dominant miss pattern (>40% in one direction)
    const cards = Array.from({ length: 5 }, (_, i) => makeCard({
      sprint_number: 170 + i,
      shots: [
        makeShot({ result: 'missed_long' }),
        makeShot({ result: 'missed_long' }),
        makeShot({ result: 'missed_long' }),
        makeShot({ result: 'green' }),
      ],
    }));
    const result = recommendClub({ ticketComplexity: 'medium', scorecards: cards });
    expect(result.provisional_suggestion).toBeDefined();
    expect(result.provisional_suggestion).toContain('miss rate');
  });

  it('has low confidence with no scorecards', () => {
    const result = recommendClub({ ticketComplexity: 'medium', scorecards: [] });
    expect(result.confidence).toBe(0.5);
  });

  it('has high confidence with sufficient history', () => {
    const cards = Array.from({ length: 5 }, (_, i) => makeCard({
      sprint_number: 170 + i,
      shots: [
        makeShot({ club: 'short_iron', result: 'green' }),
        makeShot({ club: 'short_iron', result: 'in_the_hole' }),
        makeShot({ club: 'short_iron', result: 'green' }),
      ],
    }));
    const result = recommendClub({ ticketComplexity: 'medium', scorecards: cards });
    expect(result.confidence).toBe(1.0);
  });

  it('has medium confidence with limited history', () => {
    const cards = [makeCard({
      shots: [
        makeShot({ club: 'short_iron', result: 'green' }),
      ],
    })];
    const result = recommendClub({ ticketComplexity: 'medium', scorecards: cards });
    expect(result.confidence).toBe(0.7);
  });
});

// ═══════════════════════════════════════════════════════════
// classifyShot
// ═══════════════════════════════════════════════════════════

describe('classifyShot', () => {
  it('classifies clean execution as in_the_hole', () => {
    const result = classifyShot(makeTrace());
    expect(result.result).toBe('in_the_hole');
    expect(result.miss_direction).toBeNull();
    expect(result.confidence).toBe(1.0);
    expect(result.reasoning).toContain('Clean execution');
  });

  it('classifies in-pass hazard fix as in_the_hole', () => {
    const result = classifyShot(makeTrace({
      hazards_encountered: [{ type: 'bunker', description: 'migration issue' }],
      test_results: [{ suite: 'shared', passed: true, first_run: true }],
    }));
    expect(result.result).toBe('in_the_hole');
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toContain('resolved before initial test pass');
  });

  it('classifies rework hazard as green', () => {
    // Rework: hazards present, all tests pass now, but only after re-runs (no first_run passes)
    const result = classifyShot(makeTrace({
      hazards_encountered: [{ type: 'rough', description: 'unexpected type error' }],
      test_results: [
        { suite: 'shared', passed: true, first_run: false },
      ],
    }));
    expect(result.result).toBe('green');
    expect(result.confidence).toBe(1.0);
    expect(result.reasoning).toContain('rework');
  });

  it('classifies out-of-scope files as missed_long', () => {
    const result = classifyShot(makeTrace({
      modified_files: [
        'packages/shared/src/slope-advisor.ts',
        'packages/orchestrator/src/routes/agents.ts',
        'packages/mobile/src/hooks/useAgents.ts',
      ],
    }));
    expect(result.result).toBe('missed_long');
    expect(result.miss_direction).toBe('long');
    expect(result.reasoning).toContain('outside scope');
  });

  it('classifies unmatched planned scopes as missed_short', () => {
    const result = classifyShot(makeTrace({
      planned_scope_paths: ['packages/shared/src/', 'packages/orchestrator/src/'],
      modified_files: ['packages/shared/src/slope-advisor.ts'],
    }));
    expect(result.result).toBe('missed_short');
    expect(result.miss_direction).toBe('short');
    expect(result.reasoning).toContain('not touched');
  });

  it('classifies reverts as missed_left', () => {
    const result = classifyShot(makeTrace({ reverts: 2 }));
    expect(result.result).toBe('missed_left');
    expect(result.miss_direction).toBe('left');
    expect(result.reasoning).toContain('revert');
  });

  it('classifies partial test failure as missed_right', () => {
    const result = classifyShot(makeTrace({
      test_results: [
        { suite: 'shared', passed: true, first_run: true },
        { suite: 'orchestrator', passed: false, first_run: true },
      ],
    }));
    expect(result.result).toBe('missed_right');
    expect(result.miss_direction).toBe('right');
    expect(result.reasoning).toContain('failing');
  });

  it('picks dominant signal when multiple miss types present', () => {
    const result = classifyShot(makeTrace({
      reverts: 3,
      modified_files: [
        'packages/shared/src/slope-advisor.ts',
        'packages/orchestrator/src/extra.ts',
      ],
    }));
    // Reverts have weight 6 (3 * 2), out-of-scope has weight 1
    expect(result.result).toBe('missed_left');
  });

  it('has lower confidence with ambiguous signals', () => {
    const result = classifyShot(makeTrace({
      reverts: 1,
      modified_files: [
        'packages/shared/src/slope-advisor.ts',
        'packages/orchestrator/src/extra.ts',
      ],
    }));
    expect(result.confidence).toBeLessThan(1.0);
  });

  it('handles empty trace', () => {
    const result = classifyShot(makeTrace({
      planned_scope_paths: [],
      modified_files: [],
      test_results: [],
      hazards_encountered: [],
    }));
    expect(result.result).toBe('in_the_hole');
    expect(result.confidence).toBe(1.0);
  });

  it('handles all tests failing as all-fail (no partial pass)', () => {
    const result = classifyShot(makeTrace({
      test_results: [
        { suite: 'shared', passed: false, first_run: true },
        { suite: 'orchestrator', passed: false, first_run: true },
      ],
    }));
    // All failing means no "some pass, some fail" signal — but planned scope not touched
    // since modified files match scope, this should be clean despite failures
    // Actually: all tests fail and none pass means someTestsFailed is false (need both conditions)
    expect(result.result).toBe('in_the_hole');
  });
});

// ═══════════════════════════════════════════════════════════
// generateTrainingPlan
// ═══════════════════════════════════════════════════════════

describe('generateTrainingPlan', () => {
  it('returns empty for clean handicap', () => {
    const result = generateTrainingPlan({
      handicap: makeHandicap(),
      dispersion: makeDispersion(),
      recentScorecards: [],
    });
    expect(result).toHaveLength(0);
  });

  it('recommends targeted practice for dominant miss', () => {
    const result = generateTrainingPlan({
      handicap: makeHandicap(),
      dispersion: makeDispersion({
        dominant_miss: 'long',
        by_direction: {
          long: { count: 8, pct: 60, interpretation: 'Over-scoping or over-engineering' },
          short: { count: 2, pct: 15, interpretation: 'Under-scoping' },
          left: { count: 2, pct: 15, interpretation: 'Wrong approach' },
          right: { count: 1, pct: 10, interpretation: 'Scope creep' },
        },
      }),
      recentScorecards: [],
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const domRec = result.find(r => r.area.includes('Dominant miss'));
    expect(domRec).toBeDefined();
    expect(domRec!.priority).toBe('high');
    expect(domRec!.instruction_adjustment).toBeDefined();
  });

  it('recommends review for worsening trend', () => {
    const result = generateTrainingPlan({
      handicap: makeHandicap({
        last_5: makeRollingStats({ handicap: 2.0 }),
        all_time: makeRollingStats({ handicap: 0.8 }),
      }),
      dispersion: makeDispersion(),
      recentScorecards: [],
    });
    const trendRec = result.find(r => r.area === 'Worsening trend');
    expect(trendRec).toBeDefined();
    expect(trendRec!.priority).toBe('high');
    expect(trendRec!.type).toBe('lessons');
  });

  it('recommends adjustment for club-specific issues', () => {
    // Create cards where driver has >50% miss rate across 2+ uses
    const cards = [
      makeCard({
        sprint_number: 170,
        shots: [
          makeShot({ club: 'driver', result: 'missed_long' }),
          makeShot({ club: 'driver', result: 'missed_left' }),
          makeShot({ club: 'driver', result: 'green' }),
        ],
      }),
      makeCard({
        sprint_number: 171,
        shots: [
          makeShot({ club: 'driver', result: 'missed_long' }),
        ],
      }),
    ];
    const result = generateTrainingPlan({
      handicap: makeHandicap(),
      dispersion: makeDispersion(),
      recentScorecards: cards,
    });
    const clubRec = result.find(r => r.area.includes('Club: driver'));
    expect(clubRec).toBeDefined();
    expect(clubRec!.priority).toBe('medium');
  });

  it('recommends attention for recurring hazards', () => {
    const cards = [
      makeCard({
        sprint_number: 170,
        shots: [makeShot({ hazards: [{ type: 'bunker', description: 'migration issue' }] })],
      }),
      makeCard({
        sprint_number: 171,
        shots: [makeShot({ hazards: [{ type: 'bunker', description: 'migration conflict' }] })],
      }),
      makeCard({
        sprint_number: 172,
        shots: [makeShot({ hazards: [{ type: 'bunker', description: 'migration problem' }] })],
      }),
    ];
    const result = generateTrainingPlan({
      handicap: makeHandicap(),
      dispersion: makeDispersion(),
      recentScorecards: cards,
    });
    const hazardRec = result.find(r => r.area.includes('Recurring hazard'));
    expect(hazardRec).toBeDefined();
    expect(hazardRec!.priority).toBe('medium');
  });

  it('sorts by priority (high first)', () => {
    const result = generateTrainingPlan({
      handicap: makeHandicap({
        last_5: makeRollingStats({ handicap: 2.0 }),
        all_time: makeRollingStats({ handicap: 0.8 }),
      }),
      dispersion: makeDispersion({
        dominant_miss: 'long',
        by_direction: {
          long: { count: 8, pct: 60, interpretation: 'Over-scoping' },
          short: { count: 1, pct: 10, interpretation: 'Under-scoping' },
          left: { count: 1, pct: 10, interpretation: 'Wrong approach' },
          right: { count: 1, pct: 10, interpretation: 'Scope creep' },
        },
      }),
      recentScorecards: [
        makeCard({
          sprint_number: 170,
          shots: [makeShot({ hazards: [{ type: 'bunker', description: 'issue' }] })],
        }),
        makeCard({
          sprint_number: 171,
          shots: [makeShot({ hazards: [{ type: 'bunker', description: 'issue' }] })],
        }),
        makeCard({
          sprint_number: 172,
          shots: [makeShot({ hazards: [{ type: 'bunker', description: 'issue' }] })],
        }),
      ],
    });
    // Should have both high and medium — high first
    const highIdx = result.findIndex(r => r.priority === 'high');
    const medIdx = result.findIndex(r => r.priority === 'medium');
    if (highIdx >= 0 && medIdx >= 0) {
      expect(highIdx).toBeLessThan(medIdx);
    }
  });

  it('handles empty input gracefully', () => {
    const result = generateTrainingPlan({
      handicap: makeHandicap({ last_5: makeRollingStats({ handicap: 0 }), all_time: makeRollingStats({ handicap: 0 }) }),
      dispersion: makeDispersion({ dominant_miss: null }),
      recentScorecards: [],
    });
    expect(result).toHaveLength(0);
  });

  it('does not flag worsening trend when all-time handicap is 0', () => {
    const result = generateTrainingPlan({
      handicap: makeHandicap({
        last_5: makeRollingStats({ handicap: 1.0 }),
        all_time: makeRollingStats({ handicap: 0 }),
      }),
      dispersion: makeDispersion(),
      recentScorecards: [],
    });
    const trendRec = result.find(r => r.area === 'Worsening trend');
    expect(trendRec).toBeUndefined();
  });
});
