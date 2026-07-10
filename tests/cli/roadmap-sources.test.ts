import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { roadmapCommand } from '../../src/cli/commands/roadmap.js';

let cwd: string;
let originalCwd: string;
let logs: string[];
let errors: string[];

const PROJECT = `
version: 1
name: Test Roadmap
description: Modular fixture
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
  - path: phases/phase-02.yaml
    kind: phase
  - path: backlog/deferred.yaml
    kind: backlog
`;

function source(name: string, ids: number[], status: string, dependency?: number): string {
  const sprints = ids.map((id, index) => `
  - id: ${id}
    theme: Sprint ${id}
    par: 3
    slope: 1
    type: feature
    status: ${status}
${dependency != null && index === 0 ? `    depends_on: [${dependency}]\n` : ''}    tickets:
      - {key: S${id}-1, title: T1, club: wedge, complexity: small}
      - {key: S${id}-2, title: T2, club: wedge, complexity: small}
      - {key: S${id}-3, title: T3, club: wedge, complexity: small}`).join('');
  return `
version: 1
phase:
  name: ${name}
  status: ${status}
  sprints: [${ids.join(', ')}]
sprints:${sprints}
`;
}

function writeFixture(): string {
  const root = join(cwd, 'docs', 'roadmap');
  mkdirSync(join(root, 'phases'), { recursive: true });
  mkdirSync(join(root, 'backlog'), { recursive: true });
  writeFileSync(join(root, 'project.yaml'), PROJECT);
  // Create in reverse filesystem order; manifest order remains authoritative.
  writeFileSync(join(root, 'backlog', 'deferred.yaml'), source('Deferred', [10], 'planned', 9));
  writeFileSync(join(root, 'phases', 'phase-02.yaml'), source('Phase 2', [9], 'planned', 8));
  writeFileSync(join(root, 'phases', 'phase-01.yaml'), source('Phase 1', [7, 8], 'complete'));
  return join(cwd, 'docs', 'backlog', 'roadmap.json');
}

function addPhaseOneArchiveEvidence(): void {
  const phasePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
  writeFileSync(phasePath, `${readFileSync(phasePath, 'utf8')}
scorecards:
  "7": docs/retros/sprint-7.json
  "8": docs/retros/sprint-8.json
`);
  mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'retros', 'sprint-7.json'), JSON.stringify({ sprint_number: 7 }));
  writeFileSync(join(cwd, 'docs', 'retros', 'sprint-8.json'), JSON.stringify({ sprint_number: 8 }));
}

function mockExit(): number[] {
  const codes: number[] = [];
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    codes.push(typeof code === 'number' ? code : 0);
    throw new Error(`process.exit(${code})`);
  });
  return codes;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'slope-roadmap-sources-'));
  originalCwd = process.cwd();
  process.chdir(cwd);
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('slope roadmap compile', () => {
  it('supports dry-run and writes a byte-stable compatibility projection', async () => {
    const output = writeFixture();

    await roadmapCommand(['compile', '--dry-run']);
    expect(existsSync(output)).toBe(false);
    expect(logs.join('\n')).toContain('would write docs/backlog/roadmap.json');

    logs.length = 0;
    await roadmapCommand(['compile']);
    const first = readFileSync(output, 'utf8');
    expect(JSON.parse(first)).toMatchObject({
      name: 'Test Roadmap',
      phases: [{ name: 'Phase 1' }, { name: 'Phase 2' }, { name: 'Deferred' }],
    });
    expect(JSON.parse(first).sprints.map((item: any) => item.id)).toEqual([7, 8, 9, 10]);

    logs.length = 0;
    await roadmapCommand(['compile']);
    expect(readFileSync(output, 'utf8')).toBe(first);
    expect(logs.join('\n')).toContain('projection unchanged');
  });

  it('detects projection drift in check mode without writing', async () => {
    const output = writeFixture();
    mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
    writeFileSync(output, '{"sentinel":true}\n');
    const codes = mockExit();

    await expect(roadmapCommand(['compile', '--check'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(readFileSync(output, 'utf8')).toBe('{"sentinel":true}\n');
    expect(errors.join('\n')).toContain('Roadmap projection drift');
    expect(errors.join('\n')).toContain('roadmap compile');
  });

  it('fails actionably when a single-file project has no modular manifest', async () => {
    const codes = mockExit();

    await expect(roadmapCommand(['compile'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('single-file projects should use slope roadmap validate');
  });
});

describe('slope roadmap validate-sources', () => {
  it('validates clean sources and detects projection drift without mutation', async () => {
    const output = writeFixture();
    await roadmapCommand(['compile']);

    logs.length = 0;
    await roadmapCommand(['validate-sources']);
    expect(logs.join('\n')).toContain('sources and compiled projection are valid');

    writeFileSync(output, readFileSync(output, 'utf8').replace('Sprint 9', 'Drifted Sprint 9'));
    logs.length = 0;
    const codes = mockExit();
    await expect(roadmapCommand(['validate-sources'])).rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(logs.join('\n')).toContain('projection has drifted');
    expect(readFileSync(output, 'utf8')).toContain('Drifted Sprint 9');
  });

  it('skips successfully in unchanged single-file mode', async () => {
    await roadmapCommand(['validate-sources']);

    expect(logs.join('\n')).toContain('Single-file roadmap mode');
    expect(errors).toEqual([]);
  });

  it('blocks compile on duplicate source definitions without replacing the projection', async () => {
    const output = writeFixture();
    mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
    writeFileSync(output, '{"sentinel":true}\n');
    writeFileSync(
      join(cwd, 'docs', 'roadmap', 'phases', 'phase-02.yaml'),
      source('Duplicate', [7], 'complete'),
    );
    const codes = mockExit();

    await expect(roadmapCommand(['compile'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('also defined');
    expect(readFileSync(output, 'utf8')).toBe('{"sentinel":true}\n');
  });

  it('refuses direct roadmap sync when modular sources are authoritative', async () => {
    writeFixture();
    const codes = mockExit();

    await expect(roadmapCommand(['sync', '--dry-run'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('source YAML');
    expect(errors.join('\n')).toContain('roadmap compile');
  });
});

describe('slope roadmap archive', () => {
  it('keeps dry-run read-only and moves a whole terminal phase without projection drift', async () => {
    const output = writeFixture();
    addPhaseOneArchiveEvidence();
    await roadmapCommand(['compile']);
    const projectionBefore = readFileSync(output, 'utf8');
    const manifestPath = join(cwd, 'docs', 'roadmap', 'project.yaml');
    const sourcePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    const archivePath = join(cwd, 'docs', 'roadmap', 'archive', 'phase-01.yaml');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const sourceBefore = readFileSync(sourcePath, 'utf8');

    logs.length = 0;
    await roadmapCommand(['archive', '--through=8', '--dry-run']);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceBefore);
    expect(existsSync(archivePath)).toBe(false);
    expect(readFileSync(output, 'utf8')).toBe(projectionBefore);

    logs.length = 0;
    await roadmapCommand(['archive', '--through=8']);
    expect(existsSync(sourcePath)).toBe(false);
    expect(readFileSync(archivePath, 'utf8')).toBe(sourceBefore);
    expect(readFileSync(output, 'utf8')).toBe(projectionBefore);
    const manifestAfter = readFileSync(manifestPath, 'utf8');
    expect(manifestAfter.indexOf('archive/phase-01.yaml')).toBeLessThan(manifestAfter.indexOf('phases/phase-02.yaml'));
    expect(logs.join('\n')).toContain('compatibility projection unchanged');

    logs.length = 0;
    await roadmapCommand(['validate-sources']);
    expect(logs.join('\n')).toContain('sources and compiled projection are valid');
  });

  it('refuses a boundary that would split a phase', async () => {
    writeFixture();
    addPhaseOneArchiveEvidence();
    await roadmapCommand(['compile']);
    const codes = mockExit();

    await expect(roadmapCommand(['archive', '--through=7'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('split phase');
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml'))).toBe(true);
  });

  it('refuses incomplete phases and missing archived scorecard links', async () => {
    writeFixture();
    await roadmapCommand(['compile']);
    let codes = mockExit();

    await expect(roadmapCommand(['archive', '--through=8'])).rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('no scorecard link');

    vi.restoreAllMocks();
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
    const phasePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    writeFileSync(phasePath, readFileSync(phasePath, 'utf8').replaceAll('status: complete', 'status: planned'));
    await roadmapCommand(['compile']);
    codes = mockExit();

    await expect(roadmapCommand(['archive', '--through=8'])).rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('not fully terminal');
  });
});
