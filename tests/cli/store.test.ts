import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storeCommand } from '../../src/cli/commands/store.js';
import { getStoreInfo } from '../../src/cli/store.js';
import { SqliteSlopeStore } from '../../src/store/index.js';

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
    expect(parsed.schemaVersion).toBe(7);
    expect(typeof parsed.sessions).toBe('number');
    expect(typeof parsed.claims).toBe('number');
    expect(typeof parsed.scorecards).toBe('number');
    expect(typeof parsed.events).toBe('number');
  });
});

describe('slope store migrate status', () => {
  it('shows version 7 and up to date', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'status']);

    const output = logs.join('\n');
    spy.mockRestore();

    expect(output).toContain('Current schema version: 7');
    expect(output).toContain('Total migrations:       7');
    expect(output).toContain('up to date');
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
