import { describe, expect, it } from 'vitest';
import {
  buildRoadmapFocus,
  formatRoadmapFocus,
  formatRoadmapSprintLabel,
  type RoadmapDefinition,
  type RoadmapFocusHazard,
  type RoadmapSprint,
} from '../../src/core/index.js';

function sprint(id: number, overrides: Partial<RoadmapSprint> = {}): RoadmapSprint {
  return {
    id,
    theme: `Theme ${id}`,
    par: 4,
    slope: 2,
    type: 'feature',
    tickets: [
      { key: `S${id}-1`, title: `Ticket ${id}`, club: 'short_iron', complexity: 'standard' },
    ],
    ...overrides,
  };
}

function fixture(): RoadmapDefinition {
  const selected = sprint(228, {
    depends_on: [227, 220],
    note: 'Focused context contract',
    tickets: [
      { key: 'S228-1', title: 'Define focus', club: 'long_iron', complexity: 'moderate', github_issue: 584 },
      { key: 'S228-2', title: 'Build focus', club: 'short_iron', complexity: 'standard', github_issue: 584 },
    ],
    artifacts: ['docs/design/roadmap-focus.md'],
  });
  return {
    name: 'Large Roadmap',
    description: 'Only selected context should be projected.',
    phases: [
      { name: 'Archived Sentinel Phase', sprints: [219, 220], status: 'complete' },
      {
        name: 'Phase 52',
        description: 'Bound roadmap context before modular federation.',
        sprints: [224, 225, 226, 227, 228, 229, 230, 231, 232],
        status: 'in_progress',
      },
      { name: 'Future Sentinel Phase', sprints: [233] },
    ],
    // Deliberately shuffled: focus must use phase order, not this array order.
    sprints: [
      sprint(233, { theme: 'FUTURE_SENTINEL' }),
      sprint(219, { theme: 'ARCHIVE_HISTORY_SENTINEL', status: 'complete' }),
      sprint(230, { depends_on: [228] }),
      sprint(225, { status: 'superseded' }),
      sprint(220, { theme: 'Cross-phase dependency', status: 'complete' }),
      sprint(232, { depends_on: [229] }),
      selected,
      sprint(224),
      sprint(231, { depends_on: [227] }),
      sprint(227, { status: 'complete' }),
      sprint(229, { depends_on: [228] }),
      sprint(226),
    ],
  };
}

describe('roadmap focus projection', () => {
  it('projects exact sprint, phase contract, direct dependencies, and bounded phase neighbors', () => {
    const roadmap = fixture();
    const focus = buildRoadmapFocus(roadmap, 228, { completedSprintIds: [220, 227] });

    expect(focus?.version).toBe(1);
    expect(focus?.roadmap).toEqual({ name: 'Large Roadmap' });
    expect(focus?.sprint.label).toBe('S228');
    expect(focus?.sprint.tickets.map(ticket => ticket.key)).toEqual(['S228-1', 'S228-2']);
    expect(focus?.phase).toMatchObject({
      name: 'Phase 52',
      contract: 'Bound roadmap context before modular federation.',
      sprint_index: 5,
      sprint_count: 9,
    });
    expect(focus?.dependencies.map(item => item.sprint.id)).toEqual([227, 220]);
    expect(focus?.dependencies.every(item => item.sprint.readiness === 'complete')).toBe(true);
    expect(focus?.previous.map(item => item.sprint.id)).toEqual([225, 226]);
    expect(focus?.previous[0].sprint.label).toBe('S225');
    expect(focus?.previous[0].sprint.status).toBe('superseded');
    expect(focus?.previous[0].sprint.readiness).toBe('complete');
    expect(focus?.successors.map(item => item.sprint.id)).toEqual([229, 230, 231]);
    expect(focus?.successors.map(item => item.direct)).toEqual([true, true, false]);
    expect(focus?.successors[0].sprint.readiness).toBe('blocked');
    expect(focus?.successors[2].sprint.readiness).toBe('ready');
    expect(focus?.omitted).toMatchObject({ previous: 1, successors: 1 });
  });

  it('deduplicates and bounds explicit hazards and evidence without mutating input', () => {
    const roadmap = fixture();
    const before = structuredClone(roadmap);
    const hazards: RoadmapFocusHazard[] = Array.from({ length: 10 }, (_, index) => ({
      sprint: 228,
      sprint_label: 'S228',
      type: 'roadmap_reality',
      description: `Hazard ${index}`,
    }));
    hazards.push({ ...hazards[0] });

    const first = buildRoadmapFocus(roadmap, 228, {
      hazards,
      evidence: [
        { kind: 'roadmap', label: 'Roadmap source', ref: 'docs/backlog/roadmap.json' },
        { kind: 'roadmap', label: 'Duplicate source', ref: 'docs/backlog/roadmap.json' },
        ...Array.from({ length: 12 }, (_, index) => ({
          kind: 'scorecard' as const,
          label: `Ancillary ${index}`,
          ref: `ancillary-${index}.json`,
        })),
      ],
    });
    const second = buildRoadmapFocus(roadmap, 228, { hazards, evidence: first?.evidence });

    expect(first?.hazards).toHaveLength(8);
    expect(first?.omitted.hazards).toBe(2);
    expect(first?.evidence.filter(item => item.ref === '#584')).toHaveLength(1);
    expect(first?.evidence.some(item => item.ref === 'docs/design/roadmap-focus.md')).toBe(true);
    expect(first?.evidence.filter(item => item.ref === 'docs/backlog/roadmap.json')).toHaveLength(1);
    expect(second?.sprint).toEqual(first?.sprint);
    expect(roadmap).toEqual(before);
  });

  it('includes only bounded hazards from the selected, dependency, and recent phase scorecards', () => {
    const focus = buildRoadmapFocus(fixture(), 228, {
      scorecards: [
        {
          sprint_number: 227,
          shots: [{
            ticket_key: 'S227-2',
            hazards: [{ type: 'bunker', severity: 'moderate', description: 'Dependency boundary hazard' }],
          }],
          bunker_locations: ['Dependency bunker location'],
        },
        {
          sprint_number: 226,
          shots: [{ hazards: [{ type: 'rough', description: 'Recent phase hazard' }] }],
        },
        {
          sprint_number: 219,
          shots: [{ hazards: [{ type: 'water', description: 'UNRELATED_HISTORY_HAZARD' }] }],
        },
      ],
    });

    expect(focus?.hazards.map(hazard => hazard.description)).toEqual([
      'Dependency boundary hazard',
      'Dependency bunker location',
      'Recent phase hazard',
    ]);
    expect(focus?.hazards.some(hazard => hazard.description === 'UNRELATED_HISTORY_HAZARD')).toBe(false);
  });

  it('keeps an unphased sprint focusable and emits a membership hazard', () => {
    const roadmap = fixture();
    roadmap.sprints.push(sprint(240));

    const focus = buildRoadmapFocus(roadmap, 240);

    expect(focus?.phase).toBeNull();
    expect(focus?.previous).toEqual([]);
    expect(focus?.successors).toEqual([]);
    expect(focus?.hazards[0].description).toContain('not assigned');
  });

  it('returns null for an unknown sprint', () => {
    expect(buildRoadmapFocus(fixture(), 999)).toBeNull();
  });

  it('formats canonical post-200 sprint IDs separately from encoded inserted IDs', () => {
    const canonical: RoadmapDefinition = {
      name: 'Canonical',
      phases: [{ name: 'P', sprints: [454, 455, 456] }],
      sprints: [sprint(454), sprint(455), sprint(456)],
    };
    const encoded: RoadmapDefinition = {
      name: 'Encoded',
      phases: [{ name: 'P', sprints: [43, 435, 44] }],
      sprints: [
        sprint(43),
        sprint(435, { tickets: [{ key: 'S43.5-1', title: 'Inserted', club: 'wedge', complexity: 'small' }] }),
        sprint(44),
      ],
    };

    expect(formatRoadmapSprintLabel(canonical, 455)).toBe('S455');
    expect(buildRoadmapFocus(canonical, 455)?.sprint.label).toBe('S455');
    expect(formatRoadmapSprintLabel(encoded, 435)).toBe('S43.5');
    const encodedFocus = buildRoadmapFocus(encoded, 435, { completedSprintIds: [43.5] });
    expect(encodedFocus?.sprint.label).toBe('S43.5');
    expect(encodedFocus?.sprint.status).toBe('complete');
    expect(encodedFocus?.sprint.readiness).toBe('complete');
  });

  it('formats only the bounded focus sections', () => {
    const focus = buildRoadmapFocus(fixture(), 228)!;
    const output = formatRoadmapFocus(focus);

    expect(output).toContain('# Focused Roadmap Context — S228');
    expect(output).toContain('## Phase Contract');
    expect(output).toContain('## Direct Dependencies');
    expect(output).toContain('## Immediate Successors');
    expect(output).not.toContain('ARCHIVE_HISTORY_SENTINEL');
    expect(output).not.toContain('FUTURE_SENTINEL');
    expect(output).not.toContain('Critical Path');
  });
});
