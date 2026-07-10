import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roadmapCommand } from '../../src/cli/commands/roadmap.js';
import {
  applyRoadmapSourceMigration,
  prepareRoadmapSourceMigration,
} from '../../src/cli/roadmap-source-migration.js';

let cwd: string;
let originalCwd: string;
let logs: string[];
let errors: string[];

function roadmap(extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    name: 'Migration Fixture',
    phases: [
      { name: 'History', status: 'complete', sprints: [1] },
      { name: 'Next', status: 'planned', sprints: [2] },
    ],
    sprints: [
      {
        id: 1,
        theme: 'History',
        par: 3,
        slope: 1,
        type: 'feature',
        status: 'complete',
        tickets: [
          { key: 'S1-1', title: 'One', club: 'wedge', complexity: 'small' },
          { key: 'S1-2', title: 'Two', club: 'wedge', complexity: 'small' },
          { key: 'S1-3', title: 'Three', club: 'wedge', complexity: 'small' },
        ],
      },
      {
        id: 2,
        theme: 'Next',
        par: 3,
        slope: 1,
        type: 'feature',
        status: 'planned',
        depends_on: [1],
        tickets: [
          { key: 'S2-1', title: 'One', club: 'short_iron', complexity: 'standard' },
          { key: 'S2-2', title: 'Two', club: 'short_iron', complexity: 'standard' },
          { key: 'S2-3', title: 'Three', club: 'short_iron', complexity: 'standard' },
        ],
      },
    ],
    release_train: { channel: 'stable', owner: 'platform' },
    ...extra,
  }, null, 2)}\n`;
}

function validScorecard(sprint = 1): Record<string, unknown> {
  return {
    sprint_number: sprint,
    theme: 'History',
    par: 3,
    slope: 1,
    score: 3,
    score_label: 'par',
    date: '2026-07-10',
    shots: [
      { ticket_key: 'S1-1', title: 'One', club: 'wedge', result: 'green', hazards: [] },
      { ticket_key: 'S1-2', title: 'Two', club: 'wedge', result: 'green', hazards: [] },
      { ticket_key: 'S1-3', title: 'Three', club: 'wedge', result: 'in_the_hole', hazards: [] },
    ],
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 3,
      fairways_total: 3,
      greens_in_regulation: 3,
      greens_total: 3,
      putts: 1,
      penalties: 0,
      hazards_hit: 0,
      hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    training: [],
    nutrition: [],
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
  };
}

function writeFixture(options: { scorecard?: boolean } = {}): string {
  const path = join(cwd, 'docs', 'backlog', 'roadmap.json');
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  writeFileSync(path, roadmap());
  if (options.scorecard) {
    mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-1.json'), JSON.stringify(validScorecard(), null, 2));
  }
  return path;
}

function mappingYaml(source: Buffer, scorecardPath: string): string {
  return [
    'version: 1',
    `source_sha256: ${createHash('sha256').update(source).digest('hex')}`,
    'ownership: {}',
    'ticket_repairs: {}',
    'phase_kinds: {}',
    'scorecards:',
    `  "1": ${scorecardPath}`,
    '',
  ].join('\n');
}

function rewriteCrlf(path: string): void {
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'slope-roadmap-migrate-'));
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

describe('slope roadmap migrate transaction', () => {
  it('documents migrate and its explicit mapping input in roadmap help', async () => {
    await roadmapCommand([]);
    expect(logs.join('\n')).toContain('roadmap migrate');
    expect(logs.join('\n')).toContain('--mapping=<file>');
  });

  it('keeps dry-run strictly read-only and reports history without evidence', async () => {
    const source = writeFixture();
    const original = readFileSync(source, 'utf8');

    await roadmapCommand(['migrate', '--dry-run']);

    expect(readFileSync(source, 'utf8')).toBe(original);
    expect(existsSync(join(cwd, 'docs', 'roadmap'))).toBe(false);
    expect(logs.join('\n')).toContain('history-unverified: 1');
  });

  it('fails closed on unknown or duplicate migration flags before writing', async () => {
    const source = writeFixture();
    const original = readFileSync(source, 'utf8');
    vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`process.exit(${code})`); });

    await expect(roadmapCommand(['migrate', '--dryrun'])).rejects.toThrow('process.exit(1)');
    expect(errors.join('\n')).toContain('Unknown roadmap migrate option');
    expect(readFileSync(source, 'utf8')).toBe(original);
    expect(existsSync(join(cwd, 'docs', 'roadmap'))).toBe(false);
  });

  it('prints a complete ownership mapping template without writing blocked dry-runs', async () => {
    const source = writeFixture();
    writeFileSync(source, roadmap({ phases: [{ name: 'History', status: 'complete', sprints: [1] }] }));
    vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`process.exit(${code})`); });

    await expect(roadmapCommand(['migrate', '--dry-run'])).rejects.toThrow('process.exit(1)');
    expect(existsSync(join(cwd, 'docs', 'roadmap'))).toBe(false);
    expect(logs.join('\n')).toContain('Explicit repair mapping required');
    expect(logs.join('\n')).toContain('source_sha256');
    expect(readFileSync(source, 'utf8')).toContain('release_train');
  });

  it('writes validated bundles and sidecars, commits the manifest last, and is idempotent', () => {
    const source = writeFixture({ scorecard: true });
    const prepared = prepareRoadmapSourceMigration({ cwd, recordedAt: '2026-07-10T20:00:00.000Z' });
    expect(prepared.status).toBe('ready');
    if (prepared.status === 'ready') {
      const projection = prepared.artifacts.find(artifact => artifact.role === 'projection');
      expect(projection?.sha256).toBe(prepared.plan.expected_projection_sha256);
    }

    const writes: string[] = [];
    const result = applyRoadmapSourceMigration(prepared, {
      afterWrite: (role, path) => writes.push(`${role}:${path}`),
    });
    expect(result.status).toBe('applied');
    expect(result.archives).toBe(1);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))).toBe(true);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'migration', 'audit.json'))).toBe(true);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'migration', 'non-core.json'))).toBe(true);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'migration', 'receipt.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(cwd, 'docs', 'roadmap', 'migration', 'non-core.json'), 'utf8')).fields)
      .toEqual({ release_train: { channel: 'stable', owner: 'platform' } });
    expect(existsSync(join(cwd, 'docs', 'roadmap', '.federation', 'migration-journal.json'))).toBe(false);
    expect(existsSync(join(cwd, 'docs', 'roadmap', '.federation', 'migration-backup.json'))).toBe(false);
    expect(writes.at(-1)).toBe('manifest:docs/roadmap/project.yaml');

    const repeated = prepareRoadmapSourceMigration({ cwd });
    expect(repeated.status).toBe('unchanged');
    expect(applyRoadmapSourceMigration(repeated).status).toBe('unchanged');
    expect(JSON.parse(readFileSync(source, 'utf8')).name).toBe('Migration Fixture');
  });

  it('discovers historical scorecards even when config.minSprint excludes them', () => {
    writeFixture({ scorecard: true });
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({ minSprint: 100 }));

    const prepared = prepareRoadmapSourceMigration({ cwd });
    expect(prepared.status).toBe('ready');
    if (prepared.status === 'ready') {
      expect(prepared.plan.sources.find(source => source.phase_name === 'History')?.classification).toBe('archive');
    }
  });

  it('accepts strict YAML mappings, verifies explicit scorecards, and binds supplied mapping bytes in the receipt', () => {
    const source = writeFixture();
    mkdirSync(join(cwd, 'evidence'), { recursive: true });
    writeFileSync(join(cwd, 'evidence', 'history.json'), JSON.stringify(validScorecard(), null, 2));
    const mappingPath = join(cwd, 'migration-mapping.yaml');
    writeFileSync(mappingPath, mappingYaml(readFileSync(source), './evidence\\history.json'));

    const prepared = prepareRoadmapSourceMigration({ cwd, mapping: 'migration-mapping.yaml' });
    expect(prepared.status).toBe('ready');
    if (prepared.status === 'ready') {
      expect(prepared.plan.sources.find(item => item.phase_name === 'History')?.classification).toBe('archive');
    }
    expect(applyRoadmapSourceMigration(prepared).status).toBe('applied');

    const receiptPath = join(cwd, 'docs', 'roadmap', 'migration', 'receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      outputs: Array<{ path: string }>;
      inputs: { scorecards: Array<{ path: string }> };
    };
    for (const path of new Set([
      ...receipt.outputs.map(output => output.path),
      ...receipt.inputs.scorecards.map(scorecard => scorecard.path),
      'migration-mapping.yaml',
    ])) rewriteCrlf(join(cwd, ...path.split('/')));
    rewriteCrlf(receiptPath);
    expect(prepareRoadmapSourceMigration({ cwd, mapping: 'migration-mapping.yaml' }).status).toBe('unchanged');

    const auditPath = join(cwd, 'docs', 'roadmap', 'migration', 'audit.json');
    const audit = readFileSync(auditPath, 'utf8');
    writeFileSync(auditPath, `${audit} `);
    expect(() => prepareRoadmapSourceMigration({ cwd, mapping: 'migration-mapping.yaml' }))
      .toThrow(/refusing to replace hand-authored sources/);
    writeFileSync(auditPath, audit);

    writeFileSync(mappingPath, `${readFileSync(mappingPath, 'utf8')}# changed after apply\n`);
    expect(() => prepareRoadmapSourceMigration({ cwd, mapping: 'migration-mapping.yaml' }))
      .toThrow(/refusing to replace hand-authored sources/);
    expect(prepareRoadmapSourceMigration({ cwd }).status).toBe('unchanged');
  });

  it('binds receipt idempotency only to scorecards referenced by generated sources', () => {
    writeFixture({ scorecard: true });
    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-99.json'), JSON.stringify(validScorecard(99), null, 2));
    const prepared = prepareRoadmapSourceMigration({ cwd });
    expect(prepared.status).toBe('ready');
    expect(applyRoadmapSourceMigration(prepared).status).toBe('applied');

    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-99.json'), JSON.stringify({ changed: true }));
    expect(prepareRoadmapSourceMigration({ cwd }).status).toBe('unchanged');

    writeFileSync(join(cwd, 'docs', 'retros', 'sprint-1.json'), JSON.stringify({ changed: true }));
    expect(() => prepareRoadmapSourceMigration({ cwd })).toThrow(/refusing to replace hand-authored sources/);
  });

  it('keeps a mapped missing scorecard out of evidence and blocks apply', () => {
    const source = writeFixture();
    writeFileSync(join(cwd, 'migration-mapping.yaml'), mappingYaml(readFileSync(source), 'evidence/missing.json'));

    const prepared = prepareRoadmapSourceMigration({ cwd, mapping: 'migration-mapping.yaml' });

    expect(prepared.status).toBe('blocked');
    if (prepared.status === 'blocked') {
      expect(prepared.plan.diagnostics.some(item => item.code.includes('scorecard'))).toBe(true);
    }
    expect(existsSync(join(cwd, 'docs', 'roadmap'))).toBe(false);
  });

  it('applies and reports a migration through the public roadmap command', async () => {
    writeFixture();

    await roadmapCommand(['migrate']);

    expect(existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))).toBe(true);
    expect(logs.join('\n')).toContain('Roadmap migration applied');
    expect(logs.join('\n')).toContain('Receipt: docs/roadmap/migration/receipt.json');
  });

  it('refuses an altered output instead of trusting a matching-looking receipt', () => {
    writeFixture();
    const prepared = prepareRoadmapSourceMigration({ cwd, recordedAt: '2026-07-10T20:00:00.000Z' });
    expect(prepared.status).toBe('ready');
    applyRoadmapSourceMigration(prepared);
    const auditPath = join(cwd, 'docs', 'roadmap', 'migration', 'audit.json');
    writeFileSync(auditPath, `${readFileSync(auditPath, 'utf8')} `);

    expect(() => prepareRoadmapSourceMigration({ cwd })).toThrow(/refusing to replace hand-authored sources/);
  });

  it('refuses hand-authored manifests and a source path different from configured roadmapPath', () => {
    writeFixture();
    mkdirSync(join(cwd, 'docs', 'roadmap'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap', 'project.yaml'), 'version: 1\n');
    expect(() => prepareRoadmapSourceMigration({ cwd })).toThrow(/refusing to replace hand-authored sources/);

    rmSync(join(cwd, 'docs', 'roadmap'), { recursive: true, force: true });
    const alternate = join(cwd, 'alternate.json');
    writeFileSync(alternate, roadmap());
    expect(() => prepareRoadmapSourceMigration({ cwd, path: 'alternate.json' })).toThrow(/must equal configured roadmapPath/);
  });

  it('replans under the federation lock and refuses source TOCTOU changes without transaction writes', () => {
    const source = writeFixture();
    const prepared = prepareRoadmapSourceMigration({ cwd, recordedAt: '2026-07-10T20:00:00.000Z' });
    expect(prepared.status).toBe('ready');
    writeFileSync(source, roadmap({ description: 'changed after dry-run' }));
    const changed = readFileSync(source, 'utf8');

    expect(() => applyRoadmapSourceMigration(prepared)).toThrow(/inputs changed before the federation lock/);
    expect(readFileSync(source, 'utf8')).toBe(changed);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))).toBe(false);
    expect(existsSync(join(cwd, 'docs', 'roadmap', '.federation', 'migration-journal.json'))).toBe(false);
  });

  it('rolls back exact source bytes on a manifest-commit failure and recovers on retry', () => {
    const source = writeFixture();
    const original = readFileSync(source);
    const prepared = prepareRoadmapSourceMigration({ cwd, recordedAt: '2026-07-10T20:00:00.000Z' });
    expect(prepared.status).toBe('ready');

    expect(() => applyRoadmapSourceMigration(prepared, {
      afterWrite: role => {
        if (role === 'manifest') throw new Error('injected post-manifest failure');
      },
    })).toThrow(/injected post-manifest failure/);
    expect(readFileSync(source).equals(original)).toBe(true);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))).toBe(false);
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'migration', 'receipt.json'))).toBe(false);
    expect(existsSync(join(cwd, 'docs', 'roadmap', '.federation', 'migration-journal.json'))).toBe(true);
    expect(existsSync(join(cwd, 'docs', 'roadmap', '.federation', 'migration-backup.json'))).toBe(true);

    const recovery = prepareRoadmapSourceMigration({ cwd });
    expect(recovery.status).toBe('recovery_required');
    expect(applyRoadmapSourceMigration(recovery).status).toBe('applied');
    expect(existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))).toBe(true);
  });

  it('safely recovers a backup written before the journal', () => {
    const source = writeFixture();
    const original = readFileSync(source);
    const prepared = prepareRoadmapSourceMigration({ cwd, recordedAt: '2026-07-10T20:00:00.000Z' });
    expect(prepared.status).toBe('ready');
    expect(() => applyRoadmapSourceMigration(prepared, {
      afterWrite: role => {
        if (role === 'bundle') throw new Error('injected early failure');
      },
    })).toThrow(/injected early failure/);
    rmSync(join(cwd, 'docs', 'roadmap', '.federation', 'migration-journal.json'));

    const recovery = prepareRoadmapSourceMigration({ cwd });
    expect(recovery.status).toBe('recovery_required');
    expect(applyRoadmapSourceMigration(recovery).status).toBe('applied');
    expect(JSON.parse(readFileSync(source, 'utf8')).name).toBe('Migration Fixture');
    expect(original.equals(Buffer.from(roadmap()))).toBe(true);
  });
});
