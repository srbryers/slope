import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { roadmapCommand } from '../../src/cli/commands/roadmap.js';
import {
  applyRoadmapSourceArchive,
  completeRoadmapSourceSprint,
  loadRoadmapSourceStore,
  planRoadmapSourceArchive,
  roadmapProjectionMatches,
  writeRoadmapSourceProjection,
  validateRoadmapSourceStore,
} from '../../src/cli/roadmap-source-store.js';
import {
  findRoadmapProjectionDivergence,
  stripRoadmapProjectionMarker,
  withRoadmapProjectionMarker,
  ROADMAP_PROJECTION_MARKER_KEY,
} from '../../src/core/index.js';
import type { RoadmapDefinition } from '../../src/core/index.js';

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
  it('treats only CRLF checkout conversion as projection-equivalent', () => {
    expect(roadmapProjectionMatches('{\n  "name": "Roadmap"\n}\n', '{\r\n  "name": "Roadmap"\r\n}\r\n')).toBe(true);
    expect(roadmapProjectionMatches('{\n}\n', '{\n}\n\n')).toBe(false);
    expect(roadmapProjectionMatches('{\n}\n', '{ \n}\n')).toBe(false);
    expect(roadmapProjectionMatches('{\n}\n', '{\n}')).toBe(false);
    expect(roadmapProjectionMatches('{\r}\r', '{\n}\n')).toBe(false);
  });

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

  it('marks the owning modular source sprint complete and recompiles projection (#612)', async () => {
    const output = writeFixture();
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-9.json'), JSON.stringify({ sprint_number: 9 }));

    await roadmapCommand(['complete', '--sprint=9']);

    const sourceYaml = readFileSync(join(cwd, 'docs', 'roadmap', 'phases', 'phase-02.yaml'), 'utf8');
    expect(sourceYaml).toContain('status: complete');
    expect(sourceYaml).toContain('"9": docs/retros/sprint-9.json');
    const roadmap = JSON.parse(readFileSync(output, 'utf8'));
    expect(roadmap.sprints.find((s: any) => s.id === 9).status).toBe('complete');
    expect(logs.join('\n')).toContain('Roadmap source reconciled: S9');
  });

  it('forces completion of a deliberate status as the explicit override (#660)', async () => {
    const output = writeFixture();
    const phase2 = join(cwd, 'docs', 'roadmap', 'phases', 'phase-02.yaml');
    // Sprint 9 carries a deliberate 'absorbed' disposition — the automatic
    // validate path would leave it, but `slope roadmap complete` is the
    // explicit override and must force it through.
    writeFileSync(phase2, readFileSync(phase2, 'utf8').replace('\n    status: planned\n', '\n    status: absorbed\n'));
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-9.json'), JSON.stringify({ sprint_number: 9 }));

    await roadmapCommand(['complete', '--sprint=9']);

    const sourceYaml = readFileSync(phase2, 'utf8');
    expect(sourceYaml).toContain('status: complete');
    expect(sourceYaml).not.toContain('status: absorbed');
    expect(JSON.parse(readFileSync(output, 'utf8')).sprints.find((s: any) => s.id === 9).status).toBe('complete');
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

  it('accepts a CRLF checkout without rewriting it and still detects semantic drift', async () => {
    const output = writeFixture();
    await roadmapCommand(['compile']);
    const canonical = readFileSync(output, 'utf8');
    const crlf = canonical.replace(/\n/g, '\r\n');
    writeFileSync(output, crlf);

    logs.length = 0;
    await roadmapCommand(['compile', '--check']);
    expect(logs.join('\n')).toContain('projection is current');

    logs.length = 0;
    await roadmapCommand(['validate-sources']);
    expect(logs.join('\n')).toContain('sources and compiled projection are valid');

    logs.length = 0;
    await roadmapCommand(['compile']);
    expect(logs.join('\n')).toContain('projection unchanged');
    expect(readFileSync(output, 'utf8')).toBe(crlf);

    const drifted = crlf.replace('Sprint 9', 'Drifted Sprint 9');
    writeFileSync(output, drifted);
    errors.length = 0;
    const codes = mockExit();
    await expect(roadmapCommand(['compile', '--check'])).rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('Roadmap projection drift');
    expect(readFileSync(output, 'utf8')).toBe(drifted);
  });

  it('fails actionably when a single-file project has no modular manifest', async () => {
    const codes = mockExit();

    await expect(roadmapCommand(['compile'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('single-file projects should use slope roadmap validate');
  });

  it('rejects output paths that do not match configured roadmapPath', async () => {
    writeFixture();
    const manifest = join(cwd, 'docs', 'roadmap', 'project.yaml');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('../backlog/roadmap.json', '../backlog/other.json'));
    const codes = mockExit();

    await expect(roadmapCommand(['compile'])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('must match configured roadmapPath');
    expect(existsSync(join(cwd, 'docs', 'backlog', 'other.json'))).toBe(false);
  });

  it('rejects explicit manifests and symlinked source roots outside the repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'slope-roadmap-outside-'));
    try {
      writeFileSync(join(outside, 'project.yaml'), PROJECT);
      let codes = mockExit();
      await expect(roadmapCommand(['compile', `--source=${join(outside, 'project.yaml')}`]))
        .rejects.toThrow('process.exit(1)');
      expect(codes).toEqual([1]);
      expect(errors.join('\n')).toContain('manifest path');

      vi.restoreAllMocks();
      logs = [];
      errors = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
      vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
      mkdirSync(join(cwd, 'docs'), { recursive: true });
      try {
        symlinkSync(outside, join(cwd, 'docs', 'roadmap'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return; // Host does not permit symlink/junction creation.
      }
      codes = mockExit();
      await expect(roadmapCommand(['compile'])).rejects.toThrow('process.exit(1)');
      expect(codes).toEqual([1]);
      expect(errors.join('\n')).toContain('resolves outside');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
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

  it('does not let an explicit missing manifest bypass default modular authority', async () => {
    writeFixture();
    let codes = mockExit();

    await expect(roadmapCommand(['validate-sources', '--source=missing.yaml'])).rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('manifest not found');

    vi.restoreAllMocks();
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
    codes = mockExit();
    await expect(roadmapCommand(['sync', '--source=missing.yaml', '--dry-run'])).rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('source YAML');
  });

  it('treats an explicit custom manifest as authoritative for projection mutations', async () => {
    writeFixture();
    renameSync(join(cwd, 'docs', 'roadmap'), join(cwd, 'docs', 'custom'));
    const codes = mockExit();

    await expect(roadmapCommand([
      'sync',
      '--source=docs/custom/project.yaml',
      '--dry-run',
    ])).rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('source YAML');
    expect(errors.join('\n')).toContain('roadmap compile');
  });

  it('reports an explicit missing manifest when no default authority exists', async () => {
    const codes = mockExit();

    await expect(roadmapCommand(['sync', '--source=missing.yaml', '--dry-run']))
      .rejects.toThrow('process.exit(1)');

    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('manifest not found');
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
  it('archives a phase containing .9 and .10 without a numeric split false positive', async () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Canonical Archive
output: ../backlog/roadmap.json
sources:
  - path: phases/canonical.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'canonical.yaml'), `
version: 1
phase:
  name: Canonical inserts
  status: complete
  sprints: ["458.9", "458.10"]
sprints:
  - id: "458.9"
    theme: Ninth insert
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S458.9-1, title: T1, club: wedge, complexity: small}
      - {key: S458.9-2, title: T2, club: wedge, complexity: small}
      - {key: S458.9-3, title: T3, club: wedge, complexity: small}
  - id: "458.10"
    theme: Tenth insert
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S458.10-1, title: T1, club: wedge, complexity: small}
      - {key: S458.10-2, title: T2, club: wedge, complexity: small}
      - {key: S458.10-3, title: T3, club: wedge, complexity: small}
scorecards:
  "458.9": docs/retros/sprint-458.9.json
  "458.10": docs/retros/sprint-458.10.json
`);
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-458.9.json'), JSON.stringify({ sprint_number: '458.9' }));
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-458.10.json'), JSON.stringify({ sprint_number: '458.10' }));
    await roadmapCommand(['compile']);

    logs = [];
    errors = [];
    const codes = mockExit();
    await expect(roadmapCommand(['archive', '--through=458.9', '--dry-run']))
      .rejects.toThrow('process.exit(1)');
    expect(codes).toEqual([1]);
    expect(errors.join('\n')).toContain('split phase "Canonical inserts"');

    logs = [];
    errors = [];
    await roadmapCommand(['archive', '--through=458.10', '--dry-run']);
    expect(logs.join('\n')).toContain('Roadmap archive through Sprint 458.10');
    expect(logs.join('\n')).toContain('phases/canonical.yaml -> archive/canonical.yaml');
    expect(errors).toEqual([]);
  });

  it('resolves a legacy encoded archive selector through the roadmap identity', async () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Legacy Archive
output: ../backlog/roadmap.json
sources:
  - path: phases/legacy.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'legacy.yaml'), `
version: 1
phase:
  name: Legacy insert
  status: complete
  sprints: [435]
sprints:
  - id: 435
    theme: Legacy insert
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S43.5-1, title: T1, club: wedge, complexity: small}
      - {key: S43.5-2, title: T2, club: wedge, complexity: small}
      - {key: S43.5-3, title: T3, club: wedge, complexity: small}
scorecards:
  "43.5": docs/retros/sprint-43.5.json
`);
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-43.5.json'), JSON.stringify({ sprint_number: '43.5' }));
    await roadmapCommand(['compile']);

    logs = [];
    await roadmapCommand(['archive', '--through=435', '--dry-run']);

    expect(logs.join('\n')).toContain('Roadmap archive through Sprint 43.5');
    expect(logs.join('\n')).toContain('phases/legacy.yaml -> archive/legacy.yaml');
  });

  it('validates coexisting .1 and .10 archive evidence by canonical key', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'archive'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Canonical Archive
output: ../backlog/roadmap.json
sources:
  - path: archive/phase-01.yaml
    kind: archive
`);
    writeFileSync(join(root, 'archive', 'phase-01.yaml'), `
version: 1
phase:
  name: Phase 1
  status: complete
  sprints: ["458.1", "458.10"]
sprints:
  - id: "458.1"
    theme: First insert
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S458.1-1, title: T1, club: wedge, complexity: small}
  - id: "458.10"
    theme: Tenth insert
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S458.10-1, title: T1, club: wedge, complexity: small}
scorecards:
  "458.1": docs/retros/sprint-458.1.json
  "458.10": docs/retros/sprint-458.10.json
`);
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-458.1.json'), JSON.stringify({ sprint_number: '458.1' }));
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-458.10.json'), JSON.stringify({ sprint_number: '458.10' }));

    let store = loadRoadmapSourceStore(cwd);
    let validation = validateRoadmapSourceStore(store, { checkProjection: false });
    expect(validation.errors).toEqual([]);

    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-458.10.json'), JSON.stringify({ sprint_number: '458.1' }));
    store = loadRoadmapSourceStore(cwd);
    validation = validateRoadmapSourceStore(store, { checkProjection: false });
    expect(validation.errors).toHaveLength(1);
    expect(validation.errors[0].code).toBe('archive_scorecard_mismatch');
    expect(validation.errors[0].message).toContain('Sprint S458.10');
  });

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

  it('replans under the federation lock and refuses a destination created after planning', async () => {
    writeFixture();
    addPhaseOneArchiveEvidence();
    await roadmapCommand(['compile']);
    const store = loadRoadmapSourceStore(cwd);
    const plan = planRoadmapSourceArchive(store, 8);
    const archivePath = join(cwd, 'docs', 'roadmap', 'archive', 'phase-01.yaml');
    mkdirSync(join(cwd, 'docs', 'roadmap', 'archive'), { recursive: true });
    writeFileSync(archivePath, 'conflicting bytes\n');

    expect(() => applyRoadmapSourceArchive(store, plan)).toThrow(/different content|changed before commit/);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml'))).toBe(true);
    expect(readFileSync(archivePath, 'utf8')).toBe('conflicting bytes\n');
    expect(readFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'utf8')).toContain('phases/phase-01.yaml');
  });

  it('refuses an archive destination that aliases the live source', async () => {
    writeFixture();
    addPhaseOneArchiveEvidence();
    await roadmapCommand(['compile']);
    const store = loadRoadmapSourceStore(cwd);
    const sourcePath = join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml');
    const archivePath = join(cwd, 'docs', 'roadmap', 'archive', 'phase-01.yaml');
    mkdirSync(join(cwd, 'docs', 'roadmap', 'archive'), { recursive: true });
    linkSync(sourcePath, archivePath);

    expect(() => planRoadmapSourceArchive(store, 8)).toThrow(/aliases the live source/);
    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'utf8')).toContain('phases/phase-01.yaml');
  });

  it('refuses an archive directory symlinked back to live phase sources', async () => {
    writeFixture();
    addPhaseOneArchiveEvidence();
    await roadmapCommand(['compile']);
    const store = loadRoadmapSourceStore(cwd);
    const phaseRoot = join(cwd, 'docs', 'roadmap', 'phases');
    const archiveRoot = join(cwd, 'docs', 'roadmap', 'archive');
    try {
      symlinkSync(phaseRoot, archiveRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return; // Host does not permit symlink/junction creation.
    }

    expect(() => planRoadmapSourceArchive(store, 8)).toThrow(/aliases the live source/);
    expect(existsSync(join(phaseRoot, 'phase-01.yaml'))).toBe(true);
    expect(readFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'utf8')).toContain('phases/phase-01.yaml');
  });
});

describe('completeRoadmapSourceSprint identity matching (#618)', () => {
  function writeDecimalFixture(statuses: { base: string; a: string; b: string }): string {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Decimal Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), `
version: 1
phase:
  name: Phase 1
  status: active
  sprints: [458, 458.1, 458.2]
sprints:
  - id: 458
    theme: Base
    par: 3
    slope: 1
    type: feature
    status: ${statuses.base}
    tickets:
      - {key: S458-1, title: T1, club: wedge, complexity: small}
  - id: 458.1
    theme: Variant A
    par: 3
    slope: 1
    type: feature
    status: ${statuses.a}
    tickets:
      - {key: S458.1-1, title: T1, club: wedge, complexity: small}
  - id: 458.2
    theme: Variant B
    par: 3
    slope: 1
    type: feature
    status: ${statuses.b}
    tickets:
      - {key: S458.2-1, title: T1, club: wedge, complexity: small}
`);
    return join(root, 'phases', 'phase-01.yaml');
  }

  it('reconciles only the exact decimal sprint, never an adjacent one', () => {
    const phasePath = writeDecimalFixture({ base: 'complete', a: 'planned', b: 'planned' });

    completeRoadmapSourceSprint(cwd, 458.1, { scorecardPath: 'docs/retros/sprint-458.1.json' });

    const store = loadRoadmapSourceStore(cwd);
    const byId = new Map(store.sources[0].document.sprints.map(item => [item.id, item.status]));
    expect(byId.get(458.1)).toBe('complete');
    expect(byId.get(458.2)).toBe('planned');
    expect(byId.get(458)).toBe('complete');
    expect(readFileSync(phasePath, 'utf8')).toContain('"458.1": docs/retros/sprint-458.1.json');
  });

  it('completes .10 without matching or mutating coexisting .1', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Canonical Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    const phasePath = join(root, 'phases', 'phase-01.yaml');
    writeFileSync(phasePath, `
version: 1
phase:
  name: Phase 1
  status: active
  sprints: ["458.1", "458.10"]
sprints:
  - id: "458.1"
    theme: First insert
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S458.1-1, title: T1, club: wedge, complexity: small}
  - id: "458.10"
    theme: Tenth insert
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S458.10-1, title: T1, club: wedge, complexity: small}
scorecards:
  "458.1": docs/retros/sprint-458.1.json
`);

    completeRoadmapSourceSprint(cwd, '458.10', {
      scorecardPath: 'docs/retros/sprint-458.10.json',
    });

    const store = loadRoadmapSourceStore(cwd);
    const statuses = new Map(store.sources[0].document.sprints.map(item => [item.id_key, item.status]));
    expect(statuses.get('458.1')).toBe('complete');
    expect(statuses.get('458.10')).toBe('complete');
    expect(store.sources[0].document.scorecards).toEqual({
      '458.1': 'docs/retros/sprint-458.1.json',
      '458.10': 'docs/retros/sprint-458.10.json',
    });
    const sourceText = readFileSync(phasePath, 'utf8');
    expect(sourceText).toContain('  - id: "458.1"\n    theme: First insert\n    par: 3\n    slope: 1\n    type: feature\n    status: complete');
    expect(sourceText).toContain('  - id: "458.10"\n    theme: Tenth insert\n    par: 3\n    slope: 1\n    type: feature\n    status: complete');
  });

  it('keeps adjacent decimal sprints untouched when re-reconciling an already complete sprint', () => {
    const phasePath = writeDecimalFixture({ base: 'complete', a: 'complete', b: 'planned' });
    writeFileSync(phasePath, `${readFileSync(phasePath, 'utf8')}scorecards:
  "458.1": docs/retros/sprint-458.1.json
`);

    completeRoadmapSourceSprint(cwd, 458.1, { scorecardPath: 'docs/retros/sprint-458.1.json' });

    const store = loadRoadmapSourceStore(cwd);
    const byId = new Map(store.sources[0].document.sprints.map(item => [item.id, item.status]));
    expect(byId.get(458.2)).toBe('planned');
  });

  it('matches a legacy encoded sprint id through its canonical label', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Encoded Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), `
version: 1
phase:
  name: Phase 1
  status: active
  sprints: [23, 235, 24]
sprints:
  - id: 23
    theme: Before
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S23-1, title: T1, club: wedge, complexity: small}
  - id: 235
    theme: Inserted
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S23.5-1, title: T1, club: wedge, complexity: small}
  - id: 24
    theme: After
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S24-1, title: T1, club: wedge, complexity: small}
`);

    completeRoadmapSourceSprint(cwd, 23.5, { scorecardPath: 'docs/retros/sprint-23.5.json' });

    const store = loadRoadmapSourceStore(cwd);
    const byId = new Map(store.sources[0].document.sprints.map(item => [item.id, item.status]));
    expect(byId.get(235)).toBe('complete');
    expect(byId.get(23)).toBe('complete');
    expect(byId.get(24)).toBe('planned');
    expect(store.sources[0].document.scorecards?.['23.5']).toBe('docs/retros/sprint-23.5.json');
  });

  it('preserves authored formatting end to end — only the status and scorecard lines change (#615, #617)', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Styled Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-48.yaml
    kind: phase
`);
    const styled = `version: "1"
phase:
  name: 'Phase 48 — Enforcement and Product'
  status: active
  sprints: [457, 458]
  note: >-
    A deliberately wrapped scalar that a canonical
    reserializer would reflow onto different lines.
sprints:
  - id: 457
    theme: 'Shipped work'  # trailing comment
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S457-1, title: 'Quoted title', club: wedge, complexity: small}
  - id: 458
    theme: Enforcement follow-up
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - key: S458-1
        title: T1
        club: wedge
        complexity: small
scorecards:
  "457": docs/retros/sprint-457.json
`;
    const phasePath = join(root, 'phases', 'phase-48.yaml');
    writeFileSync(phasePath, styled);

    const result = completeRoadmapSourceSprint(cwd, 458, { scorecardPath: 'docs/retros/sprint-458.json' });

    expect(result.reformatted).toBeFalsy();
    const after = readFileSync(phasePath, 'utf8');
    // The result is byte-for-byte the input with exactly two reconciled edits:
    // the targeted status line and the appended scorecards entry.
    const expected = styled
      .replace('    status: planned\n', '    status: complete\n')
      .replace(
        '  "457": docs/retros/sprint-457.json\n',
        '  "457": docs/retros/sprint-457.json\n  "458": docs/retros/sprint-458.json\n',
      );
    expect(after).toBe(expected);
  });

  it('normalizes dot-prefixed scorecard paths the same way the parser will', () => {
    writeFixture();

    const result = completeRoadmapSourceSprint(cwd, 9, { scorecardPath: './docs/retros/sprint-9.json' });

    expect(result.reformatted).toBeFalsy();
    const store = loadRoadmapSourceStore(cwd);
    const owner = store.sources.find(source => source.document.sprints.some(item => item.id === 9));
    expect(owner?.document.scorecards?.['9']).toBe('docs/retros/sprint-9.json');
  });

  it('falls back to a canonical rewrite with a warning for flow-style entries', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Flow Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), `version: 1
phase:
  name: Phase 1
  status: active
  sprints: [7]
sprints:
  - {id: 7, theme: T, par: 3, slope: 1, type: feature, status: planned, tickets: [{key: S7-1, title: T1, club: wedge, complexity: small}]}
`);

    const result = completeRoadmapSourceSprint(cwd, 7, {});

    expect(result.reformatted).toBe(true);
    const store = loadRoadmapSourceStore(cwd);
    expect(store.sources[0].document.sprints[0].status).toBe('complete');
  });

  // #702: 1.64.1 wrote depends_on as JSON numbers and 2.x writes canonical
  // strings, so each version rejected the other's projection and reported it
  // as the user's drift. Recompiling could not fix it.
  it('treats numeric and string dependency ids as the same projection', () => {
    // Generated projections are two-space JSON with a trailing newline; the
    // normalisation deliberately only applies to that canonical shape.
    const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const asStrings = canonical({ name: 'R', sprints: [{ id: '2', depends_on: ['1'] }] });
    const asNumbers = canonical({ name: 'R', sprints: [{ id: '2', depends_on: [1] }] });

    expect(roadmapProjectionMatches(asNumbers, asStrings)).toBe(true);
  });

  it('still reports a genuinely different projection as different', () => {
    const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const a = canonical({ name: 'R', sprints: [{ id: '2', depends_on: ['1'] }] });
    const b = canonical({ name: 'R', sprints: [{ id: '2', depends_on: ['3'] }] });

    expect(roadmapProjectionMatches(a, b)).toBe(false);
  });

  it('does not forgive a formatting difference as a version difference', () => {
    const canonical = `${JSON.stringify({ name: 'R', sprints: [] }, null, 2)}\n`;
    const reindented = `${JSON.stringify({ name: 'R', sprints: [] }, null, 4)}\n`;

    expect(roadmapProjectionMatches(reindented, canonical)).toBe(false);
  });

  // #700: sources is an explicit registry, not a glob, so a yaml file dropped
  // beside registered ones compiled to nothing with a clean exit.
  it('warns about a yaml file no registry entry produces', () => {
    writeFixture();
    const orphan = join(cwd, 'docs', 'roadmap', 'phases', 'phase-99-orphan.yaml');
    writeFileSync(orphan, 'version: 1\nphase:\n  name: Orphan\n  sprints: []\nsprints: []\n');

    const store = loadRoadmapSourceStore(cwd);
    const result = validateRoadmapSourceStore(store, { checkProjection: false });

    const warning = result.warnings.find(issue => issue.code === 'unregistered_source');
    expect(warning?.source).toContain('phase-99-orphan.yaml');
    // A warning, not an error: the roadmap itself is still valid.
    expect(result.errors.filter(e => e.code === 'unregistered_source')).toHaveLength(0);
  });

  it('does not warn about registered sources', () => {
    writeFixture();
    const store = loadRoadmapSourceStore(cwd);
    const result = validateRoadmapSourceStore(store, { checkProjection: false });

    expect(result.warnings.filter(issue => issue.code === 'unregistered_source')).toHaveLength(0);
  });

  // #706: the archive manifest rewrite had no surgical path at all, so it
  // discarded project.yaml's authored description block wholesale.
  it('preserves manifest comments when archiving moves sources', async () => {
    writeFixture();
    addPhaseOneArchiveEvidence();
    const manifestPath = join(cwd, 'docs', 'roadmap', 'project.yaml');
    writeFileSync(
      manifestPath,
      `# why this roadmap is shaped this way\n${readFileSync(manifestPath, 'utf8')}`,
    );
    await roadmapCommand(['compile']);

    const store = loadRoadmapSourceStore(cwd);
    const plan = planRoadmapSourceArchive(store, 8);

    expect(plan.manifestYaml).toContain('# why this roadmap is shaped this way');
    expect(plan.manifestYaml).toContain('archive/phase-01.yaml');
  });

  // Found by independent code review of S267.4. The document-level fallback
  // shipped without the over-reach check the surgical path runs, so an
  // anchored status shared by a later sprint let one reconcile mark a second
  // sprint complete. Worse than the comment loss the fallback exists to fix.
  it('refuses to reconcile when an anchored status would change another sprint', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Anchor Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), `version: 1
phase:
  name: Phase 1
  status: active
  sprints: [7, 8]
sprints:
  - {id: 7, theme: A, par: 3, slope: 1, type: feature, status: &planned planned, tickets: [{key: S7-1, title: T1, club: wedge, complexity: small}]}
  - {id: 8, theme: B, par: 3, slope: 1, type: feature, status: *planned, tickets: [{key: S8-1, title: T1, club: wedge, complexity: small}]}
`);

    completeRoadmapSourceSprint(cwd, 7, {});

    const store = loadRoadmapSourceStore(cwd);
    const seven = store.sources[0].document.sprints.find(item => item.id === 7);
    const eight = store.sources[0].document.sprints.find(item => item.id === 8);
    expect(seven?.status).toBe('complete');
    expect(eight?.status).toBe('planned');
  });

  // #706: "projection written" never said which tracked file changed, so a
  // reader watching the output could not tell what had been rewritten.
  it('reports the projection path alongside its status', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Path Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), `version: 1
phase:
  name: Phase 1
  status: active
  sprints: [7]
sprints:
  - id: 7
    theme: T
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - key: S7-1
        title: T1
        club: wedge
        complexity: small
`);

    const result = completeRoadmapSourceSprint(cwd, 7, {});

    expect(result.projectionPath).toBe('docs/backlog/roadmap.json');
    expect(result.projection).toBe('written');
  });

  // #706: the fallback rewrite serialised a fresh object, discarding every
  // comment in the bundle. An authored history note was deleted silently and
  // recovered only from git.
  it('preserves comments when the fallback rewrite runs', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Flow Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    // Flow-style sprint entry defeats the surgical patcher, so this exercises
    // the fallback path specifically.
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), `# authored history: why this phase exists
version: 1
phase:
  name: Phase 1
  # this note was silently deleted before the fix
  status: active
  sprints: [7]
sprints:
  - {id: 7, theme: T, par: 3, slope: 1, type: feature, status: planned, tickets: [{key: S7-1, title: T1, club: wedge, complexity: small}]}
`);

    const result = completeRoadmapSourceSprint(cwd, 7, {});
    expect(result.reformatted).toBe(true);

    const text = readFileSync(join(root, 'phases', 'phase-01.yaml'), 'utf8');
    expect(text).toContain('# authored history: why this phase exists');
    expect(text).toContain('# this note was silently deleted before the fix');

    const store = loadRoadmapSourceStore(cwd);
    expect(store.sources[0].document.sprints[0].status).toBe('complete');
  });

  it('refuses to reconcile when a sprint identity is ambiguous across sources', () => {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Ambiguous Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
  - path: phases/phase-02.yaml
    kind: phase
`);
    const sprintNine = `
version: 1
phase:
  name: PHASE_NAME
  status: active
  sprints: [9]
sprints:
  - id: 9
    theme: Duplicate
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S9-1, title: T1, club: wedge, complexity: small}
`;
    writeFileSync(join(root, 'phases', 'phase-01.yaml'), sprintNine.replace('PHASE_NAME', 'Phase 1'));
    writeFileSync(join(root, 'phases', 'phase-02.yaml'), sprintNine.replace('PHASE_NAME', 'Phase 2'));
    const before = readFileSync(join(root, 'phases', 'phase-01.yaml'), 'utf8');

    expect(() => completeRoadmapSourceSprint(cwd, 9, {}))
      .toThrow(/ambiguous identity/);
    expect(readFileSync(join(root, 'phases', 'phase-01.yaml'), 'utf8')).toBe(before);
  });
});

describe('completeRoadmapSourceSprint status safety (GH #660)', () => {
  function writeSingle(status: string): string {
    const root = join(cwd, 'docs', 'roadmap');
    mkdirSync(join(root, 'phases'), { recursive: true });
    writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Status Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
    const phasePath = join(root, 'phases', 'phase-01.yaml');
    writeFileSync(phasePath, `version: "1"
phase:
  name: Phase 1
  status: active
  sprints: [9]
sprints:
  - id: 9
    theme: Deliberate
    par: 3
    slope: 1
    type: feature
    status: ${status}
    tickets:
      - {key: S9-1, title: T1, club: wedge, complexity: small}
`);
    return phasePath;
  }

  for (const status of ['absorbed', 'blocked', 'deferred', 'superseded', 'cancelled', 'skipped']) {
    it(`refuses to overwrite a deliberate '${status}' status and leaves the source untouched`, () => {
      const phasePath = writeSingle(status);
      const before = readFileSync(phasePath, 'utf8');

      const result = completeRoadmapSourceSprint(cwd, 9, { scorecardPath: 'docs/retros/sprint-9.json' });

      expect(result.skipped).toBe('status_conflict');
      expect(result.authoredStatus).toBe(status);
      expect(result.changed).toBe(false);
      expect(result.projection).toBe('unchanged');
      // A scorecard records how a sprint was played, not its disposition —
      // nothing is written, so the authored status and scorecard map survive.
      expect(readFileSync(phasePath, 'utf8')).toBe(before);
    });
  }

  it('reports the conflict without writing under dryRun as well', () => {
    const phasePath = writeSingle('absorbed');
    const before = readFileSync(phasePath, 'utf8');

    const result = completeRoadmapSourceSprint(cwd, 9, {
      scorecardPath: 'docs/retros/sprint-9.json',
      dryRun: true,
    });

    expect(result.skipped).toBe('status_conflict');
    expect(result.authoredStatus).toBe('absorbed');
    expect(readFileSync(phasePath, 'utf8')).toBe(before);
  });

  for (const status of ['planned', 'active', 'in_progress', 'ready_for_pr']) {
    it(`still auto-promotes an in-flight '${status}' status to complete`, () => {
      writeSingle(status);

      const result = completeRoadmapSourceSprint(cwd, 9, { scorecardPath: 'docs/retros/sprint-9.json' });

      expect(result.skipped).toBeUndefined();
      const store = loadRoadmapSourceStore(cwd);
      expect(store.sources[0].document.sprints[0].status).toBe('complete');
      expect(store.sources[0].document.scorecards?.['9']).toBe('docs/retros/sprint-9.json');
    });
  }

  it('force overrides a deliberate status (the slope roadmap complete path)', () => {
    writeSingle('absorbed');

    const result = completeRoadmapSourceSprint(cwd, 9, {
      scorecardPath: 'docs/retros/sprint-9.json',
      force: true,
    });

    expect(result.skipped).toBeUndefined();
    const store = loadRoadmapSourceStore(cwd);
    expect(store.sources[0].document.sprints[0].status).toBe('complete');
    expect(store.sources[0].document.scorecards?.['9']).toBe('docs/retros/sprint-9.json');
  });

  it('treats an already-complete sprint as reconcilable, not a conflict', () => {
    writeSingle('complete');

    const result = completeRoadmapSourceSprint(cwd, 9, {});

    expect(result.skipped).toBeUndefined();
    const store = loadRoadmapSourceStore(cwd);
    expect(store.sources[0].document.sprints[0].status).toBe('complete');
  });

  it('reports an already-complete sprint as unchanged under dryRun', () => {
    writeSingle('complete');

    const result = completeRoadmapSourceSprint(cwd, 9, { dryRun: true });

    expect(result.skipped).toBeUndefined();
    expect(result.changed).toBe(false);
  });
});

describe('projection content-loss protection (GH #637)', () => {
  function projectionWithExtra(output: string, mutate: (data: Record<string, unknown>) => void): void {
    const data = JSON.parse(readFileSync(output, 'utf8')) as Record<string, unknown>;
    mutate(data);
    writeFileSync(output, `${JSON.stringify(data, null, 2)}
`);
  }

  it('refuses to discard a phase that exists only in the projection', () => {
    const output = writeFixture();
    let store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);

    projectionWithExtra(output, data => {
      (data.phases as unknown[]).push({ name: 'Phase 99 — Authored', sprints: [9001], status: 'in_progress' });
      (data.sprints as unknown[]).push({ id: 9001, theme: 'Authored', par: 3, slope: 1, status: 'planned', tickets: [] });
    });
    const before = readFileSync(output, 'utf8');

    store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    expect(() => writeRoadmapSourceProjection(store)).toThrow(/Phase 99 — Authored/);
    // The authored work must survive the refusal.
    expect(readFileSync(output, 'utf8')).toBe(before);
  });

  it('names the projection-only sprints in the refusal', () => {
    const output = writeFixture();
    let store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);
    projectionWithExtra(output, data => {
      (data.sprints as unknown[]).push({ id: 9002, theme: 'Only here', par: 3, slope: 1, status: 'planned', tickets: [] });
    });

    store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    expect(() => writeRoadmapSourceProjection(store)).toThrow(/S9002/);
  });

  it('overwrites projection-only content when --force is passed', () => {
    const output = writeFixture();
    let store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);
    projectionWithExtra(output, data => {
      (data.sprints as unknown[]).push({ id: 9003, theme: 'Discard me', par: 3, slope: 1, status: 'planned', tickets: [] });
    });

    store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    expect(writeRoadmapSourceProjection(store, { force: true })).toBe('written');
    expect(readFileSync(output, 'utf8')).not.toContain('9003');
  });

  it('still rewrites a merely stale projection without --force', () => {
    const output = writeFixture();
    let store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);
    // Staleness in the safe direction: the projection lags its sources, holding
    // nothing the sources do not produce.
    projectionWithExtra(output, data => {
      (data.sprints as unknown[]).pop();
      (data.phases as unknown[]).pop();
    });

    store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    expect(writeRoadmapSourceProjection(store)).toBe('written');
    expect(roadmapProjectionMatches(readFileSync(output, 'utf8'), store.projection)).toBe(true);
  });

  it('reports no divergence for an unparseable projection', () => {
    expect(findRoadmapProjectionDivergence('not json', { name: 'x', phases: [], sprints: [] })).toBeNull();
  });
});

describe('focused roadmap evidence labelling (GH #636)', () => {
  it('names the canonical manifest and owning bundle, and marks the projection generated', async () => {
    writeFixture();
    const store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);

    await roadmapCommand(['focus', '--sprint=7']);
    const output = logs.join(String.fromCharCode(10));

    expect(output).toContain('Roadmap source (canonical manifest): docs/roadmap/project.yaml');
    expect(output).toContain('Owning source bundle (phase): docs/roadmap/phases/phase-01.yaml');
    expect(output).toContain('Compatibility projection (generated, read-only): docs/backlog/roadmap.json');
    // The generated file must never be presented as the plain "Roadmap source".
    expect(output).not.toContain('Roadmap source: docs/backlog/roadmap.json');
  });
});

describe('generated-file marker (GH #644)', () => {
  it('writes the marker into the projection naming its source', () => {
    const output = writeFixture();
    const store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');

    expect(writeRoadmapSourceProjection(store)).toBe('written');

    const parsed = JSON.parse(readFileSync(output, 'utf8'));
    expect(parsed[ROADMAP_PROJECTION_MARKER_KEY]).toMatchObject({
      by: 'slope roadmap compile',
      source: 'docs/roadmap/project.yaml',
    });
    expect(parsed[ROADMAP_PROJECTION_MARKER_KEY].warning).toContain('GENERATED FILE');
    // The marker must not disturb the compiled content.
    expect(parsed.sprints.length).toBe(store.roadmap.sprints.length);
  });

  it('is idempotent — a marked projection is unchanged on re-compile', () => {
    writeFixture();
    let store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    expect(writeRoadmapSourceProjection(store)).toBe('written');

    store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    expect(writeRoadmapSourceProjection(store)).toBe('unchanged');
  });

  it('adds the marker to a current projection that lacks one', () => {
    const output = writeFixture();
    const store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);
    // Simulate a projection written before the marker existed, or by the
    // migration path, whose content is otherwise current.
    writeFileSync(output, store.projection);

    expect(writeRoadmapSourceProjection(loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml')))
      .toBe('written');
    expect(readFileSync(output, 'utf8')).toContain(ROADMAP_PROJECTION_MARKER_KEY);
  });

  it('does not report a marked projection as drift', () => {
    writeFixture();
    const store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    writeRoadmapSourceProjection(store);

    const fresh = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    const validation = validateRoadmapSourceStore(fresh);
    expect(validation.errors.map(e => e.code)).not.toContain('projection_drift');
  });

  it('round-trips marker add then strip back to canonical bytes', () => {
    writeFixture();
    const store = loadRoadmapSourceStore(cwd, 'docs/roadmap/project.yaml');
    const marked = withRoadmapProjectionMarker(store.projection, 'docs/roadmap/project.yaml');

    expect(marked).not.toBe(store.projection);
    expect(stripRoadmapProjectionMarker(marked)).toBe(store.projection);
    // Stripping an unmarked projection is a no-op.
    expect(stripRoadmapProjectionMarker(store.projection)).toBe(store.projection);
  });
});

describe('projection divergence ignores phase renames (GH #637 follow-up)', () => {
  const compiled = {
    name: 'r',
    phases: [{ name: 'Phase 58 — Current Name', sprints: [254] }],
    sprints: [{ id: 254, theme: 'T', par: 3 as const, slope: 1, type: 'feature', tickets: [] }],
  };

  it('does not treat a renamed phase as content loss when its sprints survive', () => {
    // Renaming a phase in the source used to look destructive, because phases were
    // matched by name — which blocked the compile on any rename.
    const disk = JSON.stringify({
      phases: [{ name: 'Phase 58 — Previous Name', sprints: [254] }],
      sprints: [{ id: 254 }],
    });

    expect(findRoadmapProjectionDivergence(disk, compiled)).toBeNull();
  });

  it('keeps canonical trailing-zero sprint identities distinct', () => {
    const canonical = {
      name: 'canonical',
      phases: [{
        name: 'Inserted',
        sprints: [458.1, 458.1],
        sprint_keys: ['458.1', '458.10'],
      }],
      sprints: [
        { id: 458.1, id_key: '458.1', theme: 'First', par: 3, slope: 1, type: 'feature', tickets: [] },
        { id: 458.1, id_key: '458.10', theme: 'Tenth', par: 3, slope: 1, type: 'feature', tickets: [] },
      ],
    } satisfies RoadmapDefinition;
    const disk = JSON.stringify({
      phases: [{ name: 'Inserted', sprints: [458.1, 458.1], sprint_keys: ['458.1', '458.10'] }],
      sprints: [
        { id: 458.1, id_key: '458.1' },
        { id: 458.1, id_key: '458.10' },
      ],
    });

    expect(findRoadmapProjectionDivergence(disk, canonical)).toBeNull();
  });

  it('still reports a phase whose sprints exist only in the projection', () => {
    // The original #637 loss: a phase plus six sprints that no source produced.
    const disk = JSON.stringify({
      phases: [
        { name: 'Phase 58 — Current Name', sprints: [254] },
        { name: 'Phase 49 — Authored Only', sprints: [464, 465] },
      ],
      sprints: [{ id: 254 }, { id: 464 }, { id: 465 }],
    });

    const divergence = findRoadmapProjectionDivergence(disk, compiled);
    expect(divergence?.phases).toEqual(['Phase 49 — Authored Only']);
    expect(divergence?.sprints).toEqual(['464', '465']);
  });

  it('still reports a projection-only phase that declares no sprints', () => {
    const disk = JSON.stringify({
      phases: [
        { name: 'Phase 58 — Current Name', sprints: [254] },
        { name: 'Phase 99 — Empty Authored', sprints: [] },
      ],
      sprints: [{ id: 254 }],
    });

    expect(findRoadmapProjectionDivergence(disk, compiled)?.phases)
      .toEqual(['Phase 99 — Empty Authored']);
  });
});
