import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Mock embedding client — no real HTTP calls
vi.mock('../../src/core/embedding-client.js', () => ({
  embed: vi.fn(async (texts: string[]) => {
    return texts.map(() => new Float32Array(768));
  }),
  embedBatch: vi.fn(async (chunks: Array<{ filePath: string; chunkIndex: number; content: string }>) => {
    return chunks.map(c => ({
      filePath: c.filePath,
      chunkIndex: c.chunkIndex,
      chunkText: c.content,
      vector: new Float32Array(768),
    }));
  }),
}));

import { contextCommand } from '../../src/cli/commands/context.js';
import { indexCommand } from '../../src/cli/commands/index-cmd.js';

let tmpDir: string;
let origCwd: string;

function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
}

function gitAdd(dir: string, file: string, content: string): void {
  const fullPath = join(dir, file);
  const parent = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(parent, { recursive: true });
  writeFileSync(fullPath, content);
  execSync(`git add "${file}"`, { cwd: dir, stdio: 'ignore' });
}

function gitCommit(dir: string, msg: string): void {
  execSync(`git commit -m "${msg}" --allow-empty`, { cwd: dir, stdio: 'ignore' });
}

function writeConfig(dir: string, extra: Record<string, unknown> = {}): void {
  mkdirSync(join(dir, '.slope'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
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
    embedding: {
      endpoint: 'http://localhost:11434/v1/embeddings',
      model: 'nomic-embed-text',
      dimensions: 768,
    },
    ...extra,
  }));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-context-'));
  origCwd = process.cwd();
  process.chdir(tmpDir);

  writeConfig(tmpDir);

  // Init git repo with source files
  gitInit(tmpDir);
  gitAdd(tmpDir, 'src/store.ts', 'export class Store { save() {} find() {} }');
  gitAdd(tmpDir, 'src/config.ts', 'export interface Config { name: string; }');
  gitCommit(tmpDir, 'initial');
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope context', () => {
  it('prints help with --help', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await contextCommand(['--help']);

    const output = logs.join('\n');
    expect(output).toContain('slope context');
    expect(output).toContain('--ticket');
    expect(output).toContain('--format');

    vi.restoreAllMocks();
  });

  it('errors without a query', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(contextCommand([])).rejects.toThrow('exit');

    expect(errors.join('\n')).toContain('Provide a search query');

    vi.restoreAllMocks();
    mockExit.mockRestore();
  });

  it('errors when index is empty', async () => {
    await expect(contextCommand(['store logic'])).rejects.toThrow('empty');
  });

  it('returns results after indexing', async () => {
    // Build index first
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    // Now search
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await contextCommand(['store logic']);

    const output = logs.join('\n');
    // Should have some output (snippets format by default)
    expect(output.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it('supports --format=paths', async () => {
    // Build index first
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await contextCommand(['store', '--format=paths']);

    const output = logs.join('\n');
    // Paths mode should output file paths without markdown
    expect(output).not.toContain('```');

    vi.restoreAllMocks();
  });

  it('resolves --ticket from roadmap', async () => {
    // Create roadmap with a ticket
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
      sprints: [{
        id: 'S1',
        tickets: [{
          key: 'S1-1',
          title: 'Store implementation',
          description: 'Build the data store',
          modules: ['src/store'],
        }],
      }],
    }));

    // Build index first
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await contextCommand(['--ticket=S1-1', '--format=paths']);

    // Should not throw — ticket resolved to query text
    const output = logs.join('\n');
    expect(output.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it('resolves --file to file content as query', async () => {
    // Build index first
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await contextCommand(['--file=src/store.ts', '--format=paths']);

    const output = logs.join('\n');
    expect(output.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });
});
