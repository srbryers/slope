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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-index-'));
  origCwd = process.cwd();
  process.chdir(tmpDir);

  // Create .slope/config.json with embedding config
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
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
    embedding: {
      endpoint: 'http://localhost:11434/v1/embeddings',
      model: 'nomic-embed-text',
      dimensions: 768,
    },
  }));

  // Init git repo with a source file
  gitInit(tmpDir);
  gitAdd(tmpDir, 'src/hello.ts', 'export function hello() { return "world"; }\n');
  gitCommit(tmpDir, 'initial');
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope index', () => {
  it('--status shows empty index initially', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await indexCommand(['--status']);

    const output = logs.join('\n');
    expect(output).toContain('empty');

    vi.restoreAllMocks();
  });

  it('--status --json outputs valid JSON', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await indexCommand(['--status', '--json']);

    const output = logs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.fileCount).toBe(0);
    expect(parsed.chunkCount).toBe(0);

    vi.restoreAllMocks();
  });

  it('--full indexes all files', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await indexCommand(['--full']);

    const output = logs.join('\n');
    expect(output).toContain('Rebuilding semantic index');
    expect(output).toContain('nomic-embed-text');

    vi.restoreAllMocks();

    // Verify status shows indexed content
    const logs2: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs2.push(args.join(' ')); });

    await indexCommand(['--status']);
    const status = logs2.join('\n');
    expect(status).toContain('Files:');
    expect(status).toContain('Model:      nomic-embed-text');

    vi.restoreAllMocks();
  });

  it('incremental index does full on first run', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await indexCommand([]);

    const output = logs.join('\n');
    expect(output).toContain('Rebuilding semantic index');

    vi.restoreAllMocks();
  });

  it('incremental index skips when up to date', async () => {
    // First: full index
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    // Second: incremental should say up to date
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    await indexCommand([]);

    const output = logs.join('\n');
    expect(output).toContain('up to date');

    vi.restoreAllMocks();
  });

  it('--prune removes orphaned embeddings', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await indexCommand(['--prune']);

    const output = logs.join('\n');
    expect(output).toContain('No orphaned embeddings');

    vi.restoreAllMocks();
  });

  it('errors without embedding config', async () => {
    // Overwrite config without embedding section
    writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      metaphor: 'golf',
    }));

    await expect(indexCommand(['--full'])).rejects.toThrow('No embedding config');
  });
});
