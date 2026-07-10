import { describe, expect, it } from 'vitest';
import {
  compileRoadmapSources,
  parseRoadmapSourceDocument,
  parseRoadmapSourceProject,
  RoadmapSourceError,
  serializeRoadmapProjection,
  validateRoadmapSourceFederation,
} from '../../src/core/index.js';

const PROJECT = `
version: "1"
name: Test Roadmap
description: Modular fixture
output: ../backlog/roadmap.json
sources:
  - path: phases\\phase-01.yaml
    kind: phase
  - path: backlog/deferred.yaml
    kind: backlog
`;

const PHASE = `
version: 1
phase:
  name: no
  status: complete
  sprints: [7]
sprints:
  - id: 7
    theme: Foundation
    par: 3
    slope: 1
    type: feature
    status: complete
    custom_extension: preserved
    tickets:
      - key: S7-1
        title: T1
        club: wedge
        complexity: small
scorecards:
  "7": docs/retros/sprint-7.json
`;

describe('modular roadmap source schema', () => {
  it('parses an explicitly ordered project manifest and normalizes Windows paths', () => {
    const project = parseRoadmapSourceProject(PROJECT);

    expect(project).toEqual({
      version: '1',
      name: 'Test Roadmap',
      description: 'Modular fixture',
      output: '../backlog/roadmap.json',
      sources: [
        { path: 'phases/phase-01.yaml', kind: 'phase' },
        { path: 'backlog/deferred.yaml', kind: 'backlog' },
      ],
    });
  });

  it('uses YAML 1.2 core strings and preserves roadmap extension fields', () => {
    const source = parseRoadmapSourceDocument(PHASE, 'docs\\roadmap\\phases\\phase-01.yaml');

    expect(source.phase.name).toBe('no');
    expect(source.sprints[0]).toMatchObject({ id: 7, custom_extension: 'preserved' });
    expect(source.scorecards).toEqual({ '7': 'docs/retros/sprint-7.json' });
  });

  it('preserves bounded pre-schema ticket values without compatibility drift', () => {
    const legacy = PHASE
      .replace('complexity: small', 'complexity: multi_package\n        github_issue: [290, 324]');
    const source = parseRoadmapSourceDocument(legacy, 'docs/roadmap/archive/phase-01.yaml');

    expect(source.sprints[0].tickets[0]).toMatchObject({
      complexity: 'multi_package',
      github_issue: [290, 324],
    });
    expect(serializeRoadmapProjection({
      name: 'Legacy',
      phases: [source.phase],
      sprints: source.sprints,
    })).toContain('"github_issue": [');
  });

  it('still rejects unbounded complexity and issue compatibility values', () => {
    expect(() => parseRoadmapSourceDocument(PHASE.replace('complexity: small', 'complexity: enormous'), 'phase.yaml'))
      .toThrow(/complexity is invalid/);
    expect(() => parseRoadmapSourceDocument(PHASE.replace('complexity: small', 'complexity: small\n        github_issue: []'), 'phase.yaml'))
      .toThrow(/github_issue must be/);
  });

  it('reports duplicate YAML keys with a normalized source path', () => {
    expect(() => parseRoadmapSourceProject(`${PROJECT}\nname: duplicate\n`, 'docs\\roadmap\\project.yaml'))
      .toThrow(/docs\/roadmap\/project\.yaml: YAML parse error/);
  });

  it.each([
    ['../outside.yaml', 'phase'],
    ['C:\\outside.yaml', 'phase'],
    ['archive/phase-01.yaml', 'phase'],
  ])('rejects unsafe or kind-inconsistent source paths', (path, kind) => {
    const yaml = PROJECT.replace('phases\\phase-01.yaml', path).replace('kind: phase', `kind: ${kind}`);

    expect(() => parseRoadmapSourceProject(yaml)).toThrow(RoadmapSourceError);
  });

  it.each(['project.yaml', '../../package.json', '../backlog/roadmap.yaml'])
    ('rejects unsafe compatibility outputs: %s', output => {
      expect(() => parseRoadmapSourceProject(PROJECT.replace('../backlog/roadmap.json', output)))
        .toThrow(RoadmapSourceError);
    });

  it('requires redundant phase membership and sprint definition sequences', () => {
    expect(() => parseRoadmapSourceDocument(PHASE.replace('sprints: [7]', 'sprints: missing'), 'phase.yaml'))
      .toThrow(/phase\.sprints must be a sequence/);
    expect(() => parseRoadmapSourceDocument(PHASE.replace('\nsprints:\n', '\nsprint_rows:\n'), 'phase.yaml'))
      .toThrow(/sprints must be a sequence/);
  });
});

describe('modular roadmap compilation', () => {
  it('preserves input phase order, sorts sprint IDs deterministically, and strips source metadata', () => {
    const project = parseRoadmapSourceProject(PROJECT);
    const phase = parseRoadmapSourceDocument(PHASE, 'phases/phase-01.yaml');
    const deferred = parseRoadmapSourceDocument(PHASE
      .replace('name: no', 'name: Deferred')
      .replace('sprints: [7]', 'sprints: [9]')
      .replaceAll('id: 7', 'id: 9')
      .replaceAll('S7-', 'S9-')
      .replace('"7":', '"9":'), 'backlog/deferred.yaml');

    const ordered = [
      { entry: project.sources[1], document: deferred },
      { entry: project.sources[0], document: phase },
    ];
    const roadmap = compileRoadmapSources(project, ordered);
    const first = serializeRoadmapProjection(roadmap);
    const second = serializeRoadmapProjection(compileRoadmapSources(project, ordered));

    expect(roadmap.phases.map(item => item.name)).toEqual(['no', 'Deferred']);
    expect(roadmap.sprints.map(item => item.id)).toEqual([7, 9]);
    expect(first).toBe(second);
    expect(first).not.toContain('scorecards');
    expect(first.endsWith('\n')).toBe(true);
  });
});

describe('modular roadmap federation validation', () => {
  function loaded(entryIndex: number, document = PHASE) {
    const project = parseRoadmapSourceProject(PROJECT);
    return {
      project,
      source: {
        entry: project.sources[entryIndex],
        document: parseRoadmapSourceDocument(document, project.sources[entryIndex].path),
      },
    };
  }

  it('accepts a locally self-contained phase bundle', () => {
    const { project, source } = loaded(0);
    const result = validateRoadmapSourceFederation({ ...project, sources: [source.entry] }, [source]);

    expect(result.valid).toBe(true);
  });

  it('reports duplicate sprint/ticket definitions and multiple phase membership with source attribution', () => {
    const { project, source } = loaded(0);
    const duplicate = loaded(1).source;
    const result = validateRoadmapSourceFederation(project, [source, duplicate]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_sprint', sprint: 7, source: 'backlog/deferred.yaml' }),
      expect.objectContaining({ code: 'duplicate_ticket', ticket: 'S7-1' }),
      expect.objectContaining({ code: 'multiple_phase_membership', sprint: 7 }),
    ]));
  });

  it('reports local orphan and missing definitions separately', () => {
    const { project } = loaded(0);
    const orphan = parseRoadmapSourceDocument(PHASE.replace('sprints: [7]', 'sprints: [99]'), 'phases/phase-01.yaml');
    const result = validateRoadmapSourceFederation(
      { ...project, sources: [project.sources[0]] },
      [{ entry: project.sources[0], document: orphan }],
    );

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_sprint_definition', sprint: 99 }),
      expect.objectContaining({ code: 'orphan_sprint_definition', sprint: 7 }),
    ]));
  });

  it('surfaces dangling sprint and ticket dependencies from the compatibility validator', () => {
    const { project } = loaded(0);
    const dangling = parseRoadmapSourceDocument(PHASE
      .replace('    tickets:', '    depends_on: [99]\n    tickets:')
      .replace('        complexity: small', '        complexity: small\n        depends_on: [S99-1]'), 'phases/phase-01.yaml');
    const result = validateRoadmapSourceFederation(
      { ...project, sources: [project.sources[0]] },
      [{ entry: project.sources[0], document: dangling }],
    );

    expect(result.errors.filter(issue => issue.code === 'roadmap_validation').map(issue => issue.message).join('\n'))
      .toContain('depends on');
    expect(result.errors.some(issue => issue.ticket === 'S7-1')).toBe(true);
  });

  it('rejects missing/unexpected loaded sources and always compiles in manifest order', () => {
    const project = parseRoadmapSourceProject(PROJECT);
    const phase = loaded(0).source;
    const backlog = loaded(1).source;

    const missing = validateRoadmapSourceFederation(project, [phase]);
    expect(missing.errors).toContainEqual(expect.objectContaining({ code: 'manifest_fidelity' }));
    expect(compileRoadmapSources(project, [backlog, phase]).phases.map(item => item.name)).toEqual(['no', 'no']);
  });

  it('rejects weak sprint/ticket schemas with source-attributed errors', () => {
    expect(() => parseRoadmapSourceDocument(`
version: 1
phase: {name: Weak, sprints: [7]}
sprints:
  - id: 7
    tickets: [null]
`, 'phases/weak.yaml')).toThrow(/phases\/weak\.yaml: sprints\[0\]\.theme/);
  });

  it('rejects decimal and encoded IDs that resolve to the same roadmap identity', () => {
    const project = parseRoadmapSourceProject(PROJECT);
    const encoded = parseRoadmapSourceDocument(PHASE
      .replace('sprints: [7]', 'sprints: [435]')
      .replaceAll('id: 7', 'id: 435')
      .replaceAll('S7-', 'S43.5-'), 'phases/phase-01.yaml');
    const decimal = parseRoadmapSourceDocument(PHASE
      .replace('name: no', 'name: Decimal')
      .replace('sprints: [7]', 'sprints: [43.5]')
      .replaceAll('id: 7', 'id: 43.5')
      .replaceAll('S7-', 'S43.5-'), 'backlog/deferred.yaml');
    const result = validateRoadmapSourceFederation(project, [
      { entry: project.sources[0], document: encoded },
      { entry: project.sources[1], document: decimal },
    ]);

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'logical_sprint_collision' }));
  });
});
