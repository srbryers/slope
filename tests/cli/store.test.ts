import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { assessMigrationDoctor, storeCommand } from '../../src/cli/commands/store.js';
import { getStoreInfo } from '../../src/cli/store.js';
import { LATEST_SCHEMA_VERSION, SqliteSlopeStore } from '../../src/store/index.js';

let tmpDir: string;
let originalCwd: string;

function setupProject(dir: string): void {
  const slopeDir = join(dir, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    commonIssuesPath: '.slope/common-issues.json',
    sessionsPath: '.slope/sessions.json',
    registry: 'file',
    claimsPath: '.slope/claims.json',
    roadmapPath: 'docs/backlog/roadmap.json',
    flowsPath: '.slope/flows.json',
    visionPath: '.slope/vision.json',
    repoProfilePath: '.slope/repo-profile.json',
    transcriptsPath: '.slope/transcripts',
    metaphor: 'golf',
  }));
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-store-test-'));
  setupProject(tmpDir);
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getStoreInfo', () => {
  it('returns sqlite info by default', () => {
    const info = getStoreInfo(tmpDir);
    expect(info.type).toBe('sqlite');
    expect(info.path).toBe('.slope/slope.db');
  });

  it('returns postgres info with sanitized URL', () => {
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      commonIssuesPath: '.slope/common-issues.json',
      sessionsPath: '.slope/sessions.json',
      registry: 'file',
      claimsPath: '.slope/claims.json',
      roadmapPath: 'docs/backlog/roadmap.json',
      flowsPath: '.slope/flows.json',
      visionPath: '.slope/vision.json',
      repoProfilePath: '.slope/repo-profile.json',
      transcriptsPath: '.slope/transcripts',
      metaphor: 'golf',
      store: 'postgres',
      postgres: {
        connectionString: 'postgres://user:secret@host:5432/mydb',
        projectId: 'proj-1',
      },
    }));
    const info = getStoreInfo(tmpDir);
    expect(info.type).toBe('postgres');
    expect(info.sanitizedUrl).toContain('***');
    expect(info.sanitizedUrl).not.toContain('secret');
    expect(info.projectId).toBe('proj-1');
  });
});

describe('slope store status', () => {
  it('outputs expected fields for SQLite', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['status']);

    const output = logs.join('\n');
    spy.mockRestore();

    expect(output).toContain('Store type:');
    expect(output).toContain('sqlite');
    expect(output).toContain('Schema version:');
    expect(output).toContain('Sessions:');
    expect(output).toContain('Claims:');
    expect(output).toContain('Scorecards:');
    expect(output).toContain('Events:');
  });

  it('--json outputs valid JSON', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['status', '--json']);

    const output = logs.join('\n');
    spy.mockRestore();

    const parsed = JSON.parse(output);
    expect(parsed.type).toBe('sqlite');
    expect(parsed.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(typeof parsed.sessions).toBe('number');
    expect(typeof parsed.claims).toBe('number');
    expect(typeof parsed.scorecards).toBe('number');
    expect(typeof parsed.events).toBe('number');
  });

  it('--json includes recovery suggestions for native SQLite setup errors', async () => {
    const modulePath = join(tmpDir, 'native-error-store.mjs');
    writeFileSync(modulePath, `
      export function createStore() {
        throw new Error("The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 141.");
      }
    `);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=22 <23' } }));
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      store: pathToFileURL(modulePath).href,
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      metaphor: 'golf',
    }));
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['status', '--json']);

    spy.mockRestore();
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.error).toContain('NODE_MODULE_VERSION');
    expect(parsed.recovery.join('\n')).toContain(`Active Node: ${process.version}`);
    expect(parsed.recovery.join('\n')).toContain('compiled NODE_MODULE_VERSION 127');
    expect(parsed.recovery.join('\n')).toContain('runtime requires NODE_MODULE_VERSION 141');
    expect(parsed.recovery).toContain('Install this worktree\'s dependencies first: pnpm install.');
    expect(parsed.recovery.join('\n')).toContain('package.json engines.node (>=22 <23)');
  });
});

describe('slope store migrate status', () => {
  it('shows the latest version and up to date', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'status']);

    const output = logs.join('\n');
    spy.mockRestore();

    expect(output).toContain(`Current schema version: ${LATEST_SCHEMA_VERSION}`);
    expect(output).toContain(`Total migrations:       ${LATEST_SCHEMA_VERSION}`);
    expect(output).toContain('up to date');
  });
});

describe('slope store migrate doctor', () => {
  function legacyColumnTypes(type: string): Map<string, string> {
    return new Map([
      ['claims.sprint_number', type],
      ['scorecards.sprint_number', type],
      ['events.sprint_number', type],
      ['testing_sessions.sprint', type],
    ]);
  }

  it('reports an absent SQLite store without creating it', async () => {
    const dbPath = join(tmpDir, '.slope', 'slope.db');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'doctor', '--json']);

    spy.mockRestore();
    const report = JSON.parse(logs.join('\n'));
    expect(report).toMatchObject({
      type: 'sqlite',
      initialized: false,
      currentSchemaVersion: 0,
      targetSchemaVersion: LATEST_SCHEMA_VERSION,
      pendingMigrations: 0,
      migrationRequired: false,
      status: 'not_initialized',
      readOnly: true,
    });
    expect(existsSync(dbPath)).toBe(false);
  });

  it('reports an existing SQLite file without schema metadata as inconsistent', async () => {
    const dbPath = join(tmpDir, '.slope', 'slope.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
    db.close();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'doctor', '--json']);

    spy.mockRestore();
    const report = JSON.parse(logs.join('\n'));
    expect(report).toMatchObject({
      initialized: false,
      status: 'inconsistent',
      migrationRequired: false,
      issues: ['SQLite store exists but schema_version is missing'],
      readOnly: true,
    });
    const inspected = new Database(dbPath, { readonly: true });
    expect(inspected.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all()).toEqual([{ name: 'unrelated' }]);
    inspected.close();
  });

  it('reports a current SQLite store as ready', async () => {
    const dbPath = join(tmpDir, '.slope', 'slope.db');
    const store = new SqliteSlopeStore(dbPath);
    store.close();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'doctor', '--json']);

    spy.mockRestore();
    const report = JSON.parse(logs.join('\n'));
    expect(report).toMatchObject({
      initialized: true,
      currentSchemaVersion: LATEST_SCHEMA_VERSION,
      targetSchemaVersion: LATEST_SCHEMA_VERSION,
      pendingMigrations: 0,
      migrationRequired: false,
      status: 'ready',
    });
    expect(report.identityColumns).toHaveLength(4);
    expect(report.identityColumns.every((column: { ok: boolean }) => column.ok)).toBe(true);
  });

  it('reports a legacy SQLite store without applying its migrations', async () => {
    const dbPath = join(tmpDir, '.slope', 'slope.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (8, '2026-01-01T00:00:00Z');
      CREATE TABLE claims (sprint_number INTEGER NOT NULL);
      CREATE TABLE scorecards (sprint_number INTEGER PRIMARY KEY);
      CREATE TABLE events (sprint_number INTEGER);
      CREATE TABLE testing_sessions (sprint INTEGER);
    `);
    db.close();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'doctor', '--json']);

    spy.mockRestore();
    const report = JSON.parse(logs.join('\n'));
    expect(report).toMatchObject({
      currentSchemaVersion: 8,
      targetSchemaVersion: LATEST_SCHEMA_VERSION,
      pendingMigrations: 2,
      migrationRequired: true,
      status: 'upgrade_required',
      readOnly: true,
    });
    expect(report.issues).toHaveLength(4);

    const inspected = new Database(dbPath, { readonly: true });
    expect(inspected.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 8 });
    const claimColumn = inspected.prepare('PRAGMA table_info(claims)').all()
      .find((column: unknown) => (column as { name: string }).name === 'sprint_number') as { type: string };
    expect(claimColumn.type).toBe('INTEGER');
    inspected.close();
  });

  it('prints backup guidance and a read-only guarantee for pending migrations', async () => {
    const dbPath = join(tmpDir, '.slope', 'slope.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (8, '2026-01-01T00:00:00Z');
    `);
    db.close();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'doctor']);

    spy.mockRestore();
    const output = logs.join('\n');
    expect(output).toContain('Sprint ID migration doctor (read-only)');
    expect(output).toContain('Status:                 upgrade required');
    expect(output).toContain('create a verified backup');
    expect(output).toContain('No migrations were run.');
  });

  it('classifies PostgreSQL metadata against its own schema target', () => {
    const pending = assessMigrationDoctor({
      type: 'postgres',
      initialized: true,
      currentSchemaVersion: 5,
      targetSchemaVersion: 7,
      columnTypes: legacyColumnTypes('integer'),
    });
    expect(pending).toMatchObject({
      type: 'postgres',
      pendingMigrations: 2,
      migrationRequired: true,
      status: 'upgrade_required',
    });

    const ready = assessMigrationDoctor({
      type: 'postgres',
      initialized: true,
      currentSchemaVersion: 7,
      targetSchemaVersion: 7,
      columnTypes: legacyColumnTypes('text'),
    });
    expect(ready).toMatchObject({
      pendingMigrations: 0,
      migrationRequired: false,
      status: 'ready',
    });
  });
});

describe('slope store backup', () => {
  it('creates backup file at expected path', async () => {
    // Create the store first by resolving it
    const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    await store.registerSession({ session_id: 'backup-test', role: 'primary', ide: 'vscode' });
    store.close();

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['backup']);

    const output = logs.join('\n');
    spy.mockRestore();

    expect(output).toContain('Backup created:');
    // Extract the backup path from output
    const match = output.match(/Backup created: (.+)/);
    expect(match).toBeTruthy();
    expect(existsSync(match![1].trim())).toBe(true);
  });

  it('creates backup at custom output path', async () => {
    const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
    store.close();

    const customPath = join(tmpDir, 'my-backup.db');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['backup', `--output=${customPath}`]);

    spy.mockRestore();

    expect(existsSync(customPath)).toBe(true);
  });

  it('fails gracefully for non-existent store', async () => {
    // Don't create any store file
    const errLogs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errLogs.push(args.join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(storeCommand(['backup'])).rejects.toThrow('exit');

    spy.mockRestore();
    exitSpy.mockRestore();

    expect(errLogs.join('\n')).toContain('Store not found');
  });
});

describe('slope store restore', () => {
  it('restores from a valid backup', async () => {
    // Create a store and back it up
    const dbPath = join(tmpDir, '.slope', 'slope.db');
    const store = new SqliteSlopeStore(dbPath);
    await store.registerSession({ session_id: 'restore-test', role: 'primary', ide: 'vscode' });
    store.close();

    const backupPath = join(tmpDir, 'backup.db');
    const { copyFileSync: copy } = await import('node:fs');
    copy(dbPath, backupPath);

    // Delete the original store
    rmSync(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    // Restore
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['restore', `--from=${backupPath}`]);

    spy.mockRestore();

    expect(existsSync(dbPath)).toBe(true);
    expect(logs.join('\n')).toContain('Store created from');

    // Verify restored data
    const restored = new SqliteSlopeStore(dbPath);
    const sessions = await restored.getActiveSessions();
    expect(sessions.find(s => s.session_id === 'restore-test')).toBeTruthy();
    restored.close();
  });

  it('fails with clear error for invalid file', async () => {
    const badFile = join(tmpDir, 'not-a-db.txt');
    writeFileSync(badFile, 'this is not a database');

    const errLogs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errLogs.push(args.join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(storeCommand(['restore', `--from=${badFile}`])).rejects.toThrow('exit');

    spy.mockRestore();
    exitSpy.mockRestore();

    expect(errLogs.join('\n')).toContain('Cannot read backup file');
  });

  it('fails when --from is missing', async () => {
    const errLogs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errLogs.push(args.join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(storeCommand(['restore'])).rejects.toThrow('exit');

    spy.mockRestore();
    exitSpy.mockRestore();

    expect(errLogs.join('\n')).toContain('--from=<path> is required');
  });

  it('fails when backup file does not exist', async () => {
    const errLogs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errLogs.push(args.join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(storeCommand(['restore', '--from=/nonexistent/file.db'])).rejects.toThrow('exit');

    spy.mockRestore();
    exitSpy.mockRestore();

    expect(errLogs.join('\n')).toContain('Backup file not found');
  });
});

describe('slope store (help)', () => {
  it('shows help for unknown subcommand', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(storeCommand(['unknown'])).rejects.toThrow('exit');

    const output = logs.join('\n');
    spy.mockRestore();
    exitSpy.mockRestore();

    expect(output).toContain('slope store');
    expect(output).toContain('status');
  });
});
