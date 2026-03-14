import { describe, it, expect } from 'vitest';
import {
  validateRoadmap,
  computeCriticalPath,
  findParallelOpportunities,
  parseRoadmap,
  formatRoadmapSummary,
  formatStrategicContext,
} from '../../src/core/roadmap.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket } from '../../src/core/roadmap.js';

// --- Test helpers ---

function makeTicket(sprint: number, num: number, overrides: Partial<RoadmapTicket> = {}): RoadmapTicket {
  return {
    key: `S${sprint}-${num}`,
    title: `Ticket ${num}`,
    club: 'short_iron',
    complexity: 'standard',
    ...overrides,
  };
}

function makeSprint(id: number, overrides: Partial<RoadmapSprint> = {}): RoadmapSprint {
  return {
    id,
    theme: `Sprint ${id} Theme`,
    par: 4,
    slope: 2,
    type: 'feature',
    tickets: [makeTicket(id, 1), makeTicket(id, 2), makeTicket(id, 3), makeTicket(id, 4)],
    ...overrides,
  };
}

function makeRoadmap(overrides: Partial<RoadmapDefinition> = {}): RoadmapDefinition {
  return {
    name: 'Test Roadmap',
    phases: [{ name: 'Phase 1', sprints: [7, 8, 9] }],
    sprints: [makeSprint(7), makeSprint(8, { depends_on: [7] }), makeSprint(9, { depends_on: [8] })],
    ...overrides,
  };
}

// --- validateRoadmap ---

describe('validateRoadmap', () => {
  it('validates a correct roadmap', () => {
    const result = validateRoadmap(makeRoadmap());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects empty sprints', () => {
    const result = validateRoadmap(makeRoadmap({ sprints: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('no sprints');
  });

  it('detects sprint numbering gaps', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7), makeSprint(9)],
      phases: [{ name: 'P1', sprints: [7, 9] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('gap'))).toBe(true);
  });

  it('detects duplicate sprint IDs', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7), makeSprint(7)],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('warns on ticket count < 3', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, { tickets: [makeTicket(7, 1), makeTicket(7, 2)] })],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.warnings.some(w => w.message.includes('2 tickets'))).toBe(true);
  });

  it('warns on ticket count > 4', () => {
    const tickets = [1, 2, 3, 4, 5].map(n => makeTicket(7, n));
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, { tickets })],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.warnings.some(w => w.message.includes('5 tickets'))).toBe(true);
  });

  it('detects ticket key mismatch', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, {
        tickets: [makeTicket(7, 1), makeTicket(8, 2)], // S8-2 in sprint 7
      })],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('S8-2') && e.message.includes('S7'))).toBe(true);
  });

  it('detects missing intra-sprint ticket dependency', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, {
        tickets: [
          makeTicket(7, 1),
          makeTicket(7, 2, { depends_on: ['S7-99'] }),
          makeTicket(7, 3),
          makeTicket(7, 4),
        ],
      })],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('S7-99'))).toBe(true);
  });

  it('accepts valid cross-sprint ticket dependencies', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8, {
          depends_on: [7],
          tickets: [
            makeTicket(8, 1, { depends_on: ['S7-1'] }),
            makeTicket(8, 2),
            makeTicket(8, 3),
            makeTicket(8, 4),
          ],
        }),
      ],
      phases: [{ name: 'P1', sprints: [7, 8] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing sprint dependency', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, { depends_on: [99] })],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('S99'))).toBe(true);
  });

  it('detects dependency cycles', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7, { depends_on: [9] }),
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('cycle'))).toBe(true);
  });

  it('detects invalid phase sprint references', () => {
    const roadmap = makeRoadmap({
      phases: [{ name: 'P1', sprints: [7, 8, 99] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('S99') && e.message.includes('Phase'))).toBe(true);
  });
});

// --- computeCriticalPath ---

describe('computeCriticalPath', () => {
  it('computes a linear critical path', () => {
    const roadmap = makeRoadmap();
    const result = computeCriticalPath(roadmap);
    expect(result.path).toEqual([7, 8, 9]);
    expect(result.length).toBe(3);
    expect(result.totalPar).toBe(12); // 4 + 4 + 4
  });

  it('finds the longest path when branches exist', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9),  // independent
        makeSprint(10, { depends_on: [8] }),
      ],
      phases: [{ name: 'P1', sprints: [7, 8, 9, 10] }],
    });
    const result = computeCriticalPath(roadmap);
    expect(result.path).toEqual([7, 8, 10]);
    expect(result.length).toBe(3);
  });

  it('handles a single sprint', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7)],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = computeCriticalPath(roadmap);
    expect(result.path).toEqual([7]);
    expect(result.length).toBe(1);
    expect(result.totalPar).toBe(4);
  });

  it('handles all-independent sprints', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7), makeSprint(8), makeSprint(9)],
      phases: [{ name: 'P1', sprints: [7, 8, 9] }],
    });
    const result = computeCriticalPath(roadmap);
    expect(result.length).toBe(1);
  });
});

// --- findParallelOpportunities ---

describe('findParallelOpportunities', () => {
  it('finds parallel sprints at the same depth', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),               // depth 0
        makeSprint(8),               // depth 0 — parallel with S7
        makeSprint(9, { depends_on: [7] }),  // depth 1
      ],
      phases: [{ name: 'P1', sprints: [7, 8, 9] }],
    });
    const groups = findParallelOpportunities(roadmap);
    expect(groups.length).toBe(1);
    expect(groups[0].sprints).toEqual([7, 8]);
  });

  it('returns empty when no parallel opportunities exist', () => {
    const roadmap = makeRoadmap(); // linear: 7 → 8 → 9
    const groups = findParallelOpportunities(roadmap);
    expect(groups).toHaveLength(0);
  });

  it('finds multiple parallel groups', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8),
        makeSprint(9, { depends_on: [7] }),
        makeSprint(10, { depends_on: [8] }),
      ],
      phases: [{ name: 'P1', sprints: [7, 8, 9, 10] }],
    });
    const groups = findParallelOpportunities(roadmap);
    expect(groups.length).toBe(2); // [7,8] at depth 0, [9,10] at depth 1
  });
});

// --- parseRoadmap ---

describe('parseRoadmap', () => {
  it('parses valid JSON into a roadmap', () => {
    const json = {
      name: 'Test',
      phases: [{ name: 'P1', sprints: [7] }],
      sprints: [{
        id: 7, theme: 'Test', par: 4, slope: 2, type: 'feature',
        tickets: [
          { key: 'S7-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
          { key: 'S7-2', title: 'T2', club: 'wedge', complexity: 'small' },
          { key: 'S7-3', title: 'T3', club: 'short_iron', complexity: 'standard' },
        ],
      }],
    };
    const { roadmap, validation } = parseRoadmap(json);
    expect(roadmap).not.toBeNull();
    expect(validation.valid).toBe(true);
  });

  it('rejects non-object input', () => {
    const { roadmap, validation } = parseRoadmap('not an object');
    expect(roadmap).toBeNull();
    expect(validation.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const { roadmap, validation } = parseRoadmap({ sprints: [], phases: [] });
    expect(roadmap).toBeNull();
    expect(validation.errors[0].message).toContain('name');
  });

  it('rejects missing sprints', () => {
    const { roadmap, validation } = parseRoadmap({ name: 'Test', phases: [] });
    expect(roadmap).toBeNull();
    expect(validation.errors[0].message).toContain('sprints');
  });

  it('rejects missing phases', () => {
    const { roadmap, validation } = parseRoadmap({ name: 'Test', sprints: [] });
    expect(roadmap).toBeNull();
    expect(validation.errors[0].message).toContain('phases');
  });
});

// --- formatRoadmapSummary ---

describe('formatRoadmapSummary', () => {
  it('formats a roadmap as markdown', () => {
    const output = formatRoadmapSummary(makeRoadmap());
    expect(output).toContain('# Test Roadmap');
    expect(output).toContain('S7');
    expect(output).toContain('S8');
    expect(output).toContain('S9');
    expect(output).toContain('Critical Path');
    expect(output).toContain('S7 → S8 → S9');
  });

  it('includes parallel opportunities', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7), makeSprint(8), makeSprint(9, { depends_on: [7] })],
    });
    const output = formatRoadmapSummary(roadmap);
    expect(output).toContain('Parallel');
    expect(output).toContain('S7, S8');
  });

  it('includes summary table', () => {
    const output = formatRoadmapSummary(makeRoadmap());
    expect(output).toContain('| 3 | 12 | 12 |');
  });
});

// --- validateRoadmap with scorecards cross-check ---

describe('validateRoadmap with scorecards', () => {
  it('warns when sprint has scorecard but status is not complete', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'planned' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const scorecards = [{ sprint_number: 7 }];
    const result = validateRoadmap(roadmap, scorecards);
    expect(result.warnings.some(w => w.message.includes('S7') && w.message.includes('scorecard') && w.message.includes('planned'))).toBe(true);
  });

  it('warns when sprint is marked complete but no scorecard exists', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const scorecards: { sprint_number: number }[] = []; // no scorecards at all
    const result = validateRoadmap(roadmap, scorecards);
    expect(result.warnings.some(w => w.message.includes('S7') && w.message.includes('phantom'))).toBe(true);
  });

  it('no warnings when sprint status matches scorecard presence', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const scorecards = [{ sprint_number: 7 }];
    const result = validateRoadmap(roadmap, scorecards);
    // Should only have warnings about ticket count, not about status mismatch
    expect(result.warnings.filter(w => w.message.includes('scorecard') || w.message.includes('phantom'))).toHaveLength(0);
  });

  it('skips cross-validation when scorecards not provided', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'planned' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const result = validateRoadmap(roadmap);
    expect(result.warnings.filter(w => w.message.includes('scorecard'))).toHaveLength(0);
  });
});

// --- formatStrategicContext ---

describe('formatStrategicContext', () => {
  it('returns context for a valid sprint', () => {
    const context = formatStrategicContext(makeRoadmap(), 8);
    expect(context).not.toBeNull();
    expect(context).toContain('S8');
    expect(context).toContain('Sprint 2 of 3');
    expect(context).toContain('Phase 1');
  });

  it('includes critical path when sprint is on it', () => {
    const context = formatStrategicContext(makeRoadmap(), 8);
    expect(context).toContain('critical path');
  });

  it('includes dependents', () => {
    const context = formatStrategicContext(makeRoadmap(), 7);
    expect(context).toContain('Feeds into');
    expect(context).toContain('S8');
  });

  it('returns null for unknown sprint', () => {
    const context = formatStrategicContext(makeRoadmap(), 99);
    expect(context).toBeNull();
  });
});
