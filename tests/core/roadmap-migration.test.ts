import { describe, expect, it } from 'vitest';
import {
  computeRoadmapMigrationDigest,
  parseRoadmapMigrationMapping,
  planRoadmapMigration,
  RoadmapMigrationError,
  serializeRoadmapMigrationMappingTemplate,
  type RoadmapMigrationMapping,
} from '../../src/core/index.js';

function ticket(key: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { key, title: key, club: 'wedge', complexity: 'small', ...extra };
}

function sprint(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    theme: `Sprint ${id}`,
    par: 3,
    slope: 1,
    type: 'feature',
    status: 'planned',
    tickets: [ticket(`S${id}-1`), ticket(`S${id}-2`), ticket(`S${id}-3`)],
    ...extra,
  };
}

function roadmap(
  phases: Record<string, unknown>[],
  sprints: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): string {
  return `${JSON.stringify({ name: 'Migration fixture', phases, sprints, ...extra }, null, 2)}\n`;
}

function mapping(source: string, extra: Partial<RoadmapMigrationMapping> = {}): RoadmapMigrationMapping {
  return parseRoadmapMigrationMapping({
    version: 1,
    source_sha256: computeRoadmapMigrationDigest(source),
    ownership: {},
    ticket_repairs: {},
    phase_kinds: {},
    scorecards: {},
    ...extra,
  });
}

describe('roadmap migration mapping', () => {
  it('is strict, source-bound, and canonicalizes its contract', () => {
    const source = roadmap([{ name: 'One', sprints: [1] }], [sprint(1)]);
    const parsed = mapping(source, {
      ownership: { '1': { phase_index: 1, phase_name: 'One' } },
      scorecards: { '1': 'docs\\retros\\sprint-1.json' },
    });

    expect(parsed.version).toBe('1');
    expect(parsed.scorecards['1']).toBe('docs/retros/sprint-1.json');
    expect(() => parseRoadmapMigrationMapping({ ...parsed, mystery: true })).toThrow(/unknown field/);
    expect(() => planRoadmapMigration(source, {
      mapping: { ...parsed, source_sha256: '0'.repeat(64) },
    })).toThrow(RoadmapMigrationError);
  });
});

describe('roadmap migration ownership planning', () => {
  it('reports orphans and duplicate owners without guessing', () => {
    const source = roadmap(
      [{ name: 'Umbrella', sprints: [1] }, { name: 'Subphase', sprints: [1] }],
      [sprint(1), sprint(2)],
    );
    const plan = planRoadmapMigration(source);

    expect(plan.applicable).toBe(false);
    expect(plan.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'multiple_phase_membership',
      'orphan_sprint_definition',
    ]));
    expect(plan.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ownership', key: '1', candidates: [1, 2] }),
      expect.objectContaining({ kind: 'ownership', key: '2' }),
    ]));
    expect(plan.mapping_template.ownership).toEqual({ '1': null, '2': null });
  });

  it('applies explicit duplicate and orphan mappings while preserving membership order', () => {
    const source = roadmap(
      [{ name: 'Umbrella', sprints: [1] }, { name: 'Subphase', sprints: [1] }],
      [sprint(1), sprint(2)],
    );
    const plan = planRoadmapMigration(source, {
      mapping: mapping(source, {
        ownership: {
          '1': { phase_index: 2, phase_name: 'Subphase' },
          '2': { phase_index: 2 },
        },
      }),
    });

    expect(plan.applicable).toBe(true);
    expect(plan.normalized_roadmap.phases.map(phase => phase.sprints)).toEqual([[], [1, 2]]);
    expect(plan.sources[1].sprints.map(item => item.id)).toEqual([1, 2]);
    expect(plan.audit.filter(item => item.rule === 'repair_phase_ownership')).toHaveLength(2);
  });

  it('deduplicates repeated membership in one phase without treating it as ambiguous', () => {
    const source = roadmap([{ name: 'One', sprints: [1, 1] }], [sprint(1)]);
    const plan = planRoadmapMigration(source);

    expect(plan.applicable).toBe(true);
    expect(plan.normalized_roadmap.phases[0].sprints).toEqual([1]);
    expect(plan.audit).toContainEqual(expect.objectContaining({
      path: '/phases/0/sprints',
      rule: 'deduplicate_local_membership',
      before: [1, 1],
      after: [1],
    }));
  });

  it('rejects stale and unnecessary mapping entries', () => {
    const source = roadmap([{ name: 'One', sprints: [1] }], [sprint(1)]);
    const plan = planRoadmapMigration(source, {
      mapping: mapping(source, {
        ownership: { '1': { phase_index: 1 }, '9': { phase_index: 1 } },
      }),
    });

    expect(plan.applicable).toBe(false);
    expect(plan.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'unused_ownership_mapping',
      'stale_ownership_mapping',
    ]));
  });
});

describe('roadmap migration normalization', () => {
  it('normalizes only bounded legacy shapes and records exact JSON pointers', () => {
    const legacy = sprint(1, {
      phase: 7,
      wave: 2.5,
      research: 'docs/research.md',
      artifacts: 'dist/output.json',
      tickets: null,
    });
    const source = roadmap([{ name: 'One', sprints: [1] }], [legacy]);
    const plan = planRoadmapMigration(source);
    const normalized = plan.normalized_roadmap.sprints[0];

    expect(plan.applicable).toBe(true);
    expect(normalized).toMatchObject({
      phase: '7',
      wave: '2.5',
      research: ['docs/research.md'],
      artifacts: ['dist/output.json'],
      tickets: [],
    });
    expect(plan.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/sprints/0/phase', rule: 'numeric_label_to_string', before: 7, after: '7' }),
      expect.objectContaining({ path: '/sprints/0/research', rule: 'scalar_path_to_list', after: ['docs/research.md'] }),
      expect.objectContaining({ path: '/sprints/0/tickets', rule: 'null_tickets_to_empty', before: null, after: [] }),
    ]));
  });

  it('normalizes finite aliases and derives one missing approach field', () => {
    const legacy = sprint(1, {
      tickets: [
        ticket('S1-1', { club: 'Long Iron', complexity: undefined }),
        ticket('S1-2', { club: undefined, complexity: 'medium' }),
        { id: 'S1-3', title: 'Alias key', club: 'short-iron', complexity: 'multi-package' },
      ],
    });
    const source = roadmap([{ name: 'One', sprints: [1] }], [legacy]);
    const plan = planRoadmapMigration(source);

    expect(plan.applicable).toBe(true);
    expect(plan.normalized_roadmap.sprints[0].tickets).toEqual([
      expect.objectContaining({ club: 'long_iron', complexity: 'multi_package' }),
      expect.objectContaining({ club: 'short_iron', complexity: 'standard' }),
      expect.objectContaining({ key: 'S1-3', id: 'S1-3', club: 'short_iron', complexity: 'multi_package' }),
    ]);
    expect(plan.audit.map(item => item.rule)).toEqual(expect.arrayContaining([
      'club_alias',
      'complexity_alias',
      'derive_complexity_from_club',
      'derive_club_from_complexity',
      'ticket_id_alias',
    ]));
  });

  it('requires an explicit repair when neither approach field is usable', () => {
    const broken = sprint(1, {
      tickets: [ticket('S1-1', { club: 'iron', complexity: 'unknown' })],
    });
    const source = roadmap([{ name: 'One', sprints: [1] }], [broken]);
    const unresolved = planRoadmapMigration(source);
    expect(unresolved.applicable).toBe(false);
    expect(unresolved.mapping_template.ticket_repairs).toEqual({ 'S1-1': {} });

    const repaired = planRoadmapMigration(source, {
      mapping: mapping(source, {
        ticket_repairs: { 'S1-1': { club: 'long_iron', complexity: 'moderate' } },
      }),
    });
    expect(repaired.applicable).toBe(true);
    expect(repaired.normalized_roadmap.sprints[0].tickets[0]).toMatchObject({
      club: 'long_iron',
      complexity: 'moderate',
    });
  });

  it('rejects unbounded scalar normalization', () => {
    const source = roadmap(
      [{ name: 'One', sprints: [1] }],
      [sprint(1, { research: 42 })],
    );
    const plan = planRoadmapMigration(source);

    expect(plan.applicable).toBe(false);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_path_list' }));
    expect(plan.normalized_roadmap.sprints[0].research).toBe(42);
  });
});

describe('roadmap migration preservation and classification', () => {
  it('preserves unknown nested fields and explicitly exports non-core top-level blocks', () => {
    const customSprint = sprint(1, {
      custom_sprint: { retain: true },
      tickets: [ticket('S1-1', { custom_ticket: ['keep'] })],
    });
    const source = roadmap(
      [{ name: 'One', sprints: [1], custom_phase: 'keep' }],
      [customSprint],
      { releases: { channel: 'beta' }, research_index: ['a', 'b'] },
    );
    const plan = planRoadmapMigration(source);

    expect(plan.sources[0].phase).toMatchObject({ custom_phase: 'keep' });
    expect(plan.sources[0].sprints[0]).toMatchObject({
      custom_sprint: { retain: true },
      tickets: [expect.objectContaining({ custom_ticket: ['keep'] })],
    });
    expect(plan.non_core).toEqual({
      path: 'migration/non-core.json',
      fields: { releases: { channel: 'beta' }, research_index: ['a', 'b'] },
      sha256: computeRoadmapMigrationDigest({ releases: { channel: 'beta' }, research_index: ['a', 'b'] }),
    });
  });

  it('archives only terminal, evidenced phases and routes all others explicitly', () => {
    const source = roadmap(
      [
        { name: 'Verified History', status: 'complete', sprints: [1] },
        { name: 'Unverified History', status: 'complete', sprints: [2] },
        { name: 'Current Work', status: 'active', sprints: [3] },
        { name: 'Explicit Deferred', status: 'planned', sprints: [4] },
      ],
      [
        sprint(1, { status: 'complete' }),
        sprint(2, { status: 'complete' }),
        sprint(3),
        sprint(4),
      ],
    );
    const plan = planRoadmapMigration(source, {
      mapping: mapping(source, { phase_kinds: { '4': 'backlog' } }),
      evidence: { '1': { path: 'docs/retros/sprint-1.json', valid: true } },
    });

    expect(plan.sources.map(item => ({ classification: item.classification, kind: item.kind, path: item.path }))).toEqual([
      expect.objectContaining({ classification: 'archive', kind: 'archive', path: expect.stringMatching(/^archive\/001-/) }),
      expect.objectContaining({ classification: 'history_unverified', kind: 'phase', path: expect.stringMatching(/^phases\/history-unverified\/002-/) }),
      expect.objectContaining({ classification: 'live', kind: 'phase', path: expect.stringMatching(/^phases\/live\/003-/) }),
      expect.objectContaining({ classification: 'backlog', kind: 'backlog', path: expect.stringMatching(/^backlog\/004-/) }),
    ]);
    expect(plan.sources[0].scorecards).toEqual({ '1': 'docs/retros/sprint-1.json' });
  });

  it('is deterministic and digest-bound independent of object key insertion order', () => {
    const source = roadmap([{ name: 'One', sprints: [2, 1] }], [sprint(2), sprint(1)]);
    const first = planRoadmapMigration(source);
    const second = planRoadmapMigration(source);

    expect(first.plan_sha256).toBe(second.plan_sha256);
    expect(first.normalized_roadmap.sprints.map(item => item.id)).toEqual([1, 2]);
    expect(first.audit).toContainEqual(expect.objectContaining({ path: '/sprints', rule: 'compiler_sprint_order' }));
    expect(serializeRoadmapMigrationMappingTemplate(first)).toBe(`${JSON.stringify(first.mapping_template, null, 2)}\n`);
  });
});
