import { describe, it, expect } from 'vitest';
import {
  parseRoadmapSourceProject,
  parseRoadmapSourceDocument,
  compileRoadmapSources,
  validateRoadmapSourceFederation,
  serializeRoadmapProjection,
} from '../../src/core/index.js';

const LF = String.fromCharCode(10);

const PROJECT = [
  'version: "1"',
  'name: Probe',
  'output: ../backlog/roadmap.json',
  'sources:',
  '  - path: phases/phase-99.yaml',
  '    kind: phase',
  '',
].join(LF);

function sprintBlock(id: string): string {
  return [
    `  - id: "${id}"`,
    '    theme: T',
    '    par: 3',
    '    slope: 1',
    '    type: feature',
    '    status: planned',
    '    tickets:',
    `      - {key: S${id}-1, title: T1, club: wedge, complexity: small}`,
  ].join(LF);
}

function phaseYaml(ids: string[]): string {
  return [
    'version: "1"',
    'phase:',
    '  name: Phase 99',
    `  sprints: [${ids.map(id => `"${id}"`).join(', ')}]`,
    'sprints:',
    ...ids.map(sprintBlock),
    '',
  ].join(LF);
}

function buildSource(ids: string[]) {
  const project = parseRoadmapSourceProject(PROJECT, 'docs/roadmap/project.yaml');
  const document = parseRoadmapSourceDocument(phaseYaml(ids), 'phases/phase-99.yaml');
  return { project, source: { entry: project.sources[0], document, absolutePath: '/x/phases/phase-99.yaml' } };
}

describe('canonical sprint ids coexist through compile (GH #635)', () => {
  // The exact scenario from #635: an inserted sequence reaches .10 alongside .1.
  const ids = ['458.1', '458.9', '458.10', '458.11'];

  it('preserves each authored id_key on parse', () => {
    const { source } = buildSource(ids);
    expect(source.document.sprints.map(s => s.id_key)).toEqual(ids);
    expect(source.document.phase.sprint_keys).toEqual(ids);
  });

  it('validates without a false duplicate or logical-collision error', () => {
    const { project, source } = buildSource(ids);
    const validation = validateRoadmapSourceFederation(project, [source]);
    expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
  });

  it('keeps 458.10 distinct from 458.1 in the compiled projection', () => {
    const { project, source } = buildSource(ids);
    const roadmap = compileRoadmapSources(project, [source]);
    const projection = JSON.parse(serializeRoadmapProjection(roadmap));
    const keys = projection.sprints.map((s: { id: number; id_key?: string }) => s.id_key ?? String(s.id));
    expect(keys).toContain('458.10');
    expect(keys).toContain('458.1');
    expect(new Set(keys).size).toBe(ids.length);
  });

  it('sorts reverse-authored .10 and .1 by their exact canonical keys', () => {
    const { project, source } = buildSource(['458.10', '458.1']);
    const roadmap = compileRoadmapSources(project, [source]);

    expect(roadmap.sprints.map(sprint => sprint.id_key)).toEqual(['458.1', '458.10']);
  });

  it('still rejects two sprints with the same canonical key', () => {
    const { project, source } = buildSource(['458.10', '458.10']);
    const validation = validateRoadmapSourceFederation(project, [source]);
    expect(validation.valid).toBe(false);
  });
});

describe('authoring a canonical sprint id (GH #635)', () => {
  function doc(idLine: string, extraLines: string[] = []): string {
    return [
      'version: "1"',
      'phase:',
      '  name: Phase 99',
      '  sprints: ["458.10"]',
      'sprints:',
      `  - id: ${idLine}`,
      '    theme: T',
      '    par: 3',
      '    slope: 1',
      '    type: feature',
      '    status: planned',
      ...extraLines,
      '    tickets:',
      '      - {key: S458.10-1, title: T1, club: wedge, complexity: small}',
      '',
    ].join(LF);
  }

  it('rejects an unquoted trailing-zero id and points at quoting', () => {
    expect(() => parseRoadmapSourceDocument(doc('458.10'), 'phases/phase-99.yaml'))
      .toThrow(/Quote it to preserve/);
  });

  it('accepts a quoted trailing-zero id and preserves it', () => {
    const parsed = parseRoadmapSourceDocument(doc('"458.10"'), 'phases/phase-99.yaml');
    expect(parsed.sprints[0].id_key).toBe('458.10');
  });

  it('accepts a string depends_on reference', () => {
    const parsed = parseRoadmapSourceDocument(
      doc('"458.10"', ['    depends_on: ["458.9"]']),
      'phases/phase-99.yaml',
    );
    expect(parsed.sprints[0].depends_on).toEqual(['458.9']);
  });

  it('keeps a dependency on 458.10 distinct from 458.1', () => {
    const parsed = parseRoadmapSourceDocument([
      'version: "1"',
      'phase:',
      '  name: Phase 99',
      '  sprints: ["458.1", "458.10", 459]',
      'sprints:',
      sprintBlock('458.1'),
      sprintBlock('458.10'),
      '  - id: 459',
      '    theme: T',
      '    par: 3',
      '    slope: 1',
      '    type: feature',
      '    status: planned',
      '    depends_on: ["458.10"]',
      '    tickets:',
      '      - {key: S459-1, title: T1, club: wedge, complexity: small}',
      '',
    ].join(LF), 'phases/phase-99.yaml');

    expect(parsed.sprints[2].depends_on).toEqual(['458.10']);
  });
});
