import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storeCommand } from '../../src/cli/commands/store.js';
import { getStoreInfo } from '../../src/cli/store.js';

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
    expect(parsed.schemaVersion).toBe(3);
    expect(typeof parsed.sessions).toBe('number');
    expect(typeof parsed.claims).toBe('number');
    expect(typeof parsed.scorecards).toBe('number');
    expect(typeof parsed.events).toBe('number');
  });
});

describe('slope store migrate status', () => {
  it('shows version 3 and up to date', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await storeCommand(['migrate', 'status']);

    const output = logs.join('\n');
    spy.mockRestore();

    expect(output).toContain('Current schema version: 3');
    expect(output).toContain('Total migrations:       3');
    expect(output).toContain('up to date');
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
