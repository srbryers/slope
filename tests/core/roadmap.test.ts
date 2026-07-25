import { describe, it, expect } from 'vitest';
import {
  validateRoadmap,
  computeCriticalPath,
  findParallelOpportunities,
  parseRoadmap,
  castRoadmapStructure,
  formatRoadmapSummary,
  formatStrategicContext,
  formatSprintLabel,
  formatRoadmapSprintLabel,
  describeSprintIdAmbiguity,
  nextCanonicalSprintId,
  parseSprintNumber,
  sprintOrderValue,
  findNextPlannedSprint,
  isRoadmapSprintPending,
  isRoadmapSprintTerminal,
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

describe('sprint id formatting', () => {
  it('formats canonical, decimal, and encoded inserted sprint ids', () => {
    expect(formatSprintLabel(43)).toBe('S43');
    expect(formatSprintLabel(43.5)).toBe('S43.5');
    expect(formatSprintLabel(435)).toBe('S43.5');
    expect(formatSprintLabel(95)).toBe('S95');
    expect(formatSprintLabel(100)).toBe('S100');
    expect(formatSprintLabel(101)).toBe('S101');
    expect(formatSprintLabel(105)).toBe('S105');
    expect(formatSprintLabel(203)).toBe('S203');
  });

  it('sorts encoded inserted ids between surrounding canonical sprints', () => {
    expect(sprintOrderValue(435)).toBe(43.5);
    expect(sprintOrderValue(105)).toBe(105);
    expect([44, 435, 43].sort((a, b) => sprintOrderValue(a) - sprintOrderValue(b))).toEqual([43, 435, 44]);
  });

  it('parses canonical and decimal sprint ids without truncating', () => {
    expect(parseSprintNumber('114')).toBe(114);
    expect(parseSprintNumber('114.5')).toBe(114.5);
    expect(parseSprintNumber('S114.5')).toBe(114.5);
    expect(parseSprintNumber('114abc')).toBeNull();
    expect(parseSprintNumber('114.')).toBeNull();
  });

  it('computes the next canonical sprint after inserted sprint ids', () => {
    expect(nextCanonicalSprintId(114)).toBe(115);
    expect(nextCanonicalSprintId(114.5)).toBe(115);
    expect(nextCanonicalSprintId(435)).toBe(44);
  });
});

describe('roadmap terminal status semantics', () => {
  it.each([
    'complete',
    'superseded',
    'skipped',
    'cancelled',
    'cancelled-absorbed',
    'absorbed',
  ])('treats %s as terminal and not selectable', status => {
    const sprint = makeSprint(7, { status });
    expect(isRoadmapSprintTerminal(sprint)).toBe(true);
    expect(isRoadmapSprintPending(sprint)).toBe(false);
  });

  it('keeps active, planned, and unset work selectable', () => {
    for (const status of ['active', 'planned', undefined]) {
      const sprint = makeSprint(7, status ? { status } : {});
      expect(isRoadmapSprintTerminal(sprint)).toBe(false);
      expect(isRoadmapSprintPending(sprint)).toBe(true);
    }
  });
});

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

  it('reports sprint numbering gaps as warnings, not errors', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7), makeSprint(9)],
      phases: [{ name: 'P1', sprints: [7, 9] }],
    });
    const result = validateRoadmap(roadmap);
    // Long-lived roadmaps legitimately skip numbers (absorbed/cancelled/
    // renumbered sprints), so a gap is informational, not a hard error.
    expect(result.warnings.some(w => w.message.includes('gap'))).toBe(true);
    expect(result.errors.some(e => e.message.includes('gap'))).toBe(false);
  });

  it('allows inserted decimal sprint ids between canonical sprints', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(75), makeSprint(75.5), makeSprint(76)],
      phases: [{ name: 'P1', sprints: [75, 75.5, 76] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.errors.some(e => e.message.includes('gap'))).toBe(false);
  });

  it('keeps canonical post-S100 ids ending in 5 valid', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(104), makeSprint(105), makeSprint(106)],
      phases: [{ name: 'P1', sprints: [104, 105, 106] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.errors).toEqual([]);
  });

  it('accepts encoded inserted sprint ids with decimal ticket prefixes', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(43),
        makeSprint(435, {
          tickets: [
            { ...makeTicket(435, 1), key: 'S43.5-1' },
            { ...makeTicket(435, 2), key: 'S43.5-2' },
            { ...makeTicket(435, 3), key: 'S43.5-3' },
          ],
        }),
        makeSprint(44),
      ],
      phases: [{ name: 'P1', sprints: [43, 435, 44] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.errors).toEqual([]);
  });

  it('treats sprint ids >=200 ending in 5 with integer neighbours as canonical', () => {
    // Regression: 205/355 must not be decoded as S20.5/S35.5 — the legacy
    // half-sprint encoding (435 => S43.5) is ambiguous against real sprint
    // numbers. With S204/S206 present, 205 is a real sprint, so there is no
    // numbering gap and its S205-* ticket keys match (not "S20.5-").
    const roadmap = makeRoadmap({
      sprints: [makeSprint(204), makeSprint(205), makeSprint(206)],
      phases: [{ name: 'P1', sprints: [204, 205, 206] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.errors).toEqual([]);
  });

  it('treats sparse sprint ids >=200 ending in 5 with canonical ticket prefixes as canonical', () => {
    // Regression: sparse long-lived roadmaps may legitimately omit immediate
    // neighbours. S205-* ticket keys still prove this is canonical S205, not
    // legacy encoded S20.5.
    const roadmap = makeRoadmap({
      sprints: [makeSprint(205), makeSprint(207)],
      phases: [{ name: 'P1', sprints: [205, 207] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => w.message.includes('S205') && w.message.includes('S207'))).toBe(true);
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

  it('accepts id as a ticket key alias', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, {
        tickets: [
          { ...makeTicket(7, 1), key: undefined, id: 'S7-1' },
          { ...makeTicket(7, 2), key: undefined, id: 'S7-2', depends_on: ['S7-1'] },
          { ...makeTicket(7, 3), key: undefined, id: 'S7-3' },
        ] as unknown as RoadmapTicket[],
      })],
      phases: [{ name: 'P1', sprints: [7] }],
    });
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing ticket id/key without throwing', () => {
    const roadmap = makeRoadmap({
      sprints: [makeSprint(7, {
        tickets: [
          { ...makeTicket(7, 1), key: undefined, id: undefined },
          makeTicket(7, 2),
          makeTicket(7, 3),
        ] as unknown as RoadmapTicket[],
      })],
      phases: [{ name: 'P1', sprints: [7] }],
    });

    expect(() => validateRoadmap(roadmap)).not.toThrow();
    const result = validateRoadmap(roadmap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('missing key/id'))).toBe(true);
  });

  it('normalizes id-only tickets to key when parsing', () => {
    const parsed = parseRoadmap(makeRoadmap({
      sprints: [makeSprint(7, {
        tickets: [
          { ...makeTicket(7, 1), key: undefined, id: 'S7-1' },
          { ...makeTicket(7, 2), key: undefined, id: 'S7-2' },
          { ...makeTicket(7, 3), key: undefined, id: 'S7-3' },
        ] as unknown as RoadmapTicket[],
      })],
      phases: [{ name: 'P1', sprints: [7] }],
    }));

    expect(parsed.validation.valid).toBe(true);
    expect(parsed.roadmap?.sprints[0].tickets.map(t => t.key)).toEqual(['S7-1', 'S7-2', 'S7-3']);
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

  it('defaults missing sprint tickets to an empty array when parsing', () => {
    const json = {
      name: 'Test',
      phases: [{ name: 'P1', sprints: [7] }],
      sprints: [{
        id: 7,
        theme: 'Ticketless',
        par: 4,
        slope: 2,
        type: 'feature',
      }],
    };

    const { roadmap, validation } = parseRoadmap(json);

    expect(roadmap?.sprints[0].tickets).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some(w => w.message.includes('0 tickets'))).toBe(true);
  });

  it('defaults missing sprint tickets to an empty array when structurally casting', () => {
    const roadmap = castRoadmapStructure({
      name: 'Test',
      phases: [{ name: 'P1', sprints: [7] }],
      sprints: [{
        id: 7,
        theme: 'Ticketless',
        par: 4,
        slope: 2,
        type: 'feature',
      }],
    });

    expect(roadmap?.sprints[0].tickets).toEqual([]);
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

// --- validateRoadmap with shipped sprint drift detection ---

describe('validateRoadmap with shipped sprint IDs', () => {
  it('errors when sprint shipped on main but status is null', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const shipped = new Set([7]);
    const result = validateRoadmap(roadmap, undefined, shipped);
    expect(
      result.errors.some(
        e => e.sprint === 7 && e.message.includes('shipped commits') && e.message.includes('planned'),
      ),
    ).toBe(true);
  });

  it('errors when sprint shipped but status is "planned"', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'planned' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const result = validateRoadmap(roadmap, undefined, new Set([7]));
    expect(
      result.errors.some(e => e.sprint === 7 && e.message.includes('shipped commits')),
    ).toBe(true);
  });

  it('does not error when shipped and status is "complete"', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const result = validateRoadmap(roadmap, undefined, new Set([7]));
    expect(result.errors.filter(e => e.message.includes('shipped commits'))).toHaveLength(0);
  });

  it('warns when status is "complete" but sprint not in shipped set (phantom)', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const result = validateRoadmap(roadmap, undefined, new Set([8])); // 7 missing
    expect(
      result.warnings.some(
        w => w.sprint === 7 && w.message.includes('no shipped commits'),
      ),
    ).toBe(true);
  });

  it('skips drift check when shippedSprintIds not provided', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const result = validateRoadmap(roadmap);
    expect(result.errors.filter(e => e.message.includes('shipped commits'))).toHaveLength(0);
    expect(result.warnings.filter(w => w.message.includes('shipped commits'))).toHaveLength(0);
  });

  it('does not force "complete" on terminal non-complete sprints mentioned in commits', () => {
    // Regression: roadmap-bookkeeping commits ("feat: add S7 sprint") make a
    // sprint look shipped, but superseded / skipped / cancelled-absorbed are
    // valid terminal states and must not be flagged as "expected complete".
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(6), status: 'superseded' } as any,
        { ...makeSprint(7), status: 'skipped' } as any,
        { ...makeSprint(8), status: 'cancelled-absorbed', depends_on: [7] } as any,
        { ...makeSprint(9), status: 'complete', depends_on: [8] } as any,
      ],
    });
    const result = validateRoadmap(roadmap, undefined, new Set([6, 7, 8]));
    expect(result.errors.filter(e => e.message.includes('shipped commits'))).toHaveLength(0);
  });

  it('runs alongside scorecard cross-check independently', () => {
    const roadmap = makeRoadmap({
      sprints: [
        // S7: shipped + scorecard but status=planned → error from drift, warn from scorecards
        { ...makeSprint(7), status: 'planned' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const scorecards = [{ sprint_number: 7 }];
    const result = validateRoadmap(roadmap, scorecards, new Set([7]));
    expect(result.errors.some(e => e.message.includes('shipped commits'))).toBe(true);
    expect(result.warnings.some(w => w.message.includes('scorecard'))).toBe(true);
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

// --- findNextPlannedSprint (GH #290) ---

describe('findNextPlannedSprint', () => {
  it('returns the lowest-id non-complete sprint after current', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        { ...makeSprint(8, { depends_on: [7] }), status: 'complete' } as any,
        { ...makeSprint(9, { depends_on: [8] }), status: 'planned' } as any,
      ],
    });
    const next = findNextPlannedSprint(roadmap, 8);
    expect(next?.id).toBe(9);
  });

  it('orders encoded inserted sprints before the next canonical sprint', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(43), status: 'complete' } as any,
        makeSprint(435, {
          tickets: [
            { ...makeTicket(435, 1), key: 'S43.5-1' },
            { ...makeTicket(435, 2), key: 'S43.5-2' },
            { ...makeTicket(435, 3), key: 'S43.5-3' },
          ],
        }),
        makeSprint(44),
      ],
      phases: [{ name: 'P1', sprints: [43, 435, 44] }],
    });
    const next = findNextPlannedSprint(roadmap, 43);
    expect(next?.id).toBe(435);
  });

  it('skips complete sprints', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        { ...makeSprint(8, { depends_on: [7] }), status: 'complete' } as any,
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const next = findNextPlannedSprint(roadmap, 7);
    expect(next?.id).toBe(9);
  });

  it('skips superseded sprints', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        { ...makeSprint(8), status: 'superseded' } as any,
        { ...makeSprint(9), status: 'planned' } as any,
      ],
    });
    const next = findNextPlannedSprint(roadmap, 7);
    expect(next?.id).toBe(9);
  });

  it('returns null when no later sprints exist', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        { ...makeSprint(8, { depends_on: [7] }), status: 'complete' } as any,
        { ...makeSprint(9, { depends_on: [8] }), status: 'complete' } as any,
      ],
    });
    expect(findNextPlannedSprint(roadmap, 9)).toBeNull();
  });

  it('prefers a candidate whose dependencies are all satisfied', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        // S8 still planned; S9 depends on 7 (which IS complete) but has higher id
        makeSprint(8),
        makeSprint(9, { depends_on: [7] }),
      ],
    });
    // S8 has no deps so it's also "ready" — by id order, S8 wins (lowest ready)
    const next = findNextPlannedSprint(roadmap, 7);
    expect(next?.id).toBe(8);
  });

  it('falls back to lowest-id candidate when nothing is fully unblocked', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        // S8 depends on S7 (planned, not complete) — blocked
        makeSprint(8, { depends_on: [7] }),
        // S9 depends on S8 — also blocked
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const next = findNextPlannedSprint(roadmap, 6);
    expect(next?.id).toBe(7);
  });
});

// --- formatStrategicContext: next sprint surfacing (GH #290) ---

describe('formatStrategicContext next-sprint output', () => {
  it('includes next sprint with ready status when deps complete', () => {
    const roadmap = makeRoadmap({
      sprints: [
        { ...makeSprint(7), status: 'complete' } as any,
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const context = formatStrategicContext(roadmap, 7);
    expect(context).toContain('Next: S8');
    expect(context).toContain('(ready)');
  });

  it('shows blocked status when next sprint has incomplete deps', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [7, 8] }),
      ],
    });
    const context = formatStrategicContext(roadmap, 7);
    // S8 is the next; depends on S7 which is not complete
    expect(context).toContain('Next: S8');
    expect(context).toContain('blocked by S7');
  });

  it('omits Next line when no later sprints exist', () => {
    const roadmap = makeRoadmap({
      sprints: [
        makeSprint(7),
        makeSprint(8, { depends_on: [7] }),
        makeSprint(9, { depends_on: [8] }),
      ],
    });
    const context = formatStrategicContext(roadmap, 9);
    expect(context).not.toContain('Next:');
  });
});

describe('roadmap-aware sprint labelling (GH #635)', () => {
  function roadmapWith(id: number, ticketKey: string) {
    return {
      name: 'r',
      phases: [{ name: 'P', sprints: [id] }],
      sprints: [{
        id,
        theme: 'T',
        par: 3,
        slope: 1,
        tickets: [{ key: ticketKey, title: 'x', club: 'wedge' as const, complexity: 'small' as const }],
      }],
    };
  }

  it('renders a real three-digit sprint ending in 5 as itself, not a decimal', () => {
    // Bare formatSprintLabel cannot disambiguate: any integer 200-999 ending in 5
    // looks like the legacy encoding, so this repo's own S245 rendered "S24.5".
    expect(formatSprintLabel(245)).toBe('S24.5');
    // With roadmap evidence (ticket keys prove the canonical identity) it is correct.
    expect(formatRoadmapSprintLabel(roadmapWith(245, 'S245-1'), 245)).toBe('S245');
  });

  it.each([205, 215, 225, 235, 245, 255])('resolves S%i from roadmap evidence', id => {
    expect(formatRoadmapSprintLabel(roadmapWith(id, `S${id}-1`), id)).toBe(`S${id}`);
  });

  it('still renders a genuinely encoded inserted sprint as a decimal', () => {
    expect(formatRoadmapSprintLabel(roadmapWith(435, 'S43.5-1'), 435)).toBe('S43.5');
  });
});

describe('ambiguous sprint id rejection (GH #635)', () => {
  it.each([
    ['458.1', 458.1],
    ['458.9', 458.9],
    ['458.11', 458.11],
    ['459', 459],
  ])('round-trips %s', (written, expected) => {
    expect(parseSprintNumber(written)).toBe(expected);
    expect(describeSprintIdAmbiguity(written)).toBeNull();
  });

  it.each(['458.10', '458.0', '458.100', 'S458.10'])('rejects %s as unrepresentable', written => {
    // Stored as a number, "458.10" reads back as 458.1 and silently aliases it.
    expect(parseSprintNumber(written)).toBeNull();
    expect(describeSprintIdAmbiguity(written)).toContain('cannot round-trip');
  });

  it('names what the id would collapse to and suggests a renumbering', () => {
    const problem = describeSprintIdAmbiguity('458.10');
    expect(problem).toContain('reads back as 458.1');
    expect(problem).toContain('458.11');
  });

  it('only inspects text, since a parsed number has already lost the zero', () => {
    // 458.10 and 458.1 are the same number; the ambiguity exists only as written.
    expect(describeSprintIdAmbiguity(String(458.10))).toBeNull();
  });
});
