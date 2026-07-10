import { describe, expect, it } from 'vitest';
import {
  compileRoadmapSources,
  parseRoadmapSourceDocument,
  parseRoadmapSourceProject,
  RoadmapSourceError,
  serializeRoadmapProjection,
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

    expect(roadmap.phases.map(item => item.name)).toEqual(['Deferred', 'no']);
    expect(roadmap.sprints.map(item => item.id)).toEqual([7, 9]);
    expect(first).toBe(second);
    expect(first).not.toContain('scorecards');
    expect(first.endsWith('\n')).toBe(true);
  });
});
