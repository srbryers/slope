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

  it('still rejects two sprints with the same canonical key', () => {
    const { project, source } = buildSource(['458.10', '458.10']);
    const validation = validateRoadmapSourceFederation(project, [source]);
    expect(validation.valid).toBe(false);
  });
});
