import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
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

import { enrichCommand } from '../../src/cli/commands/enrich.js';
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

function writeConfig(dir: string): void {
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
  }));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-enrich-cli-'));
  origCwd = process.cwd();
  process.chdir(tmpDir);

  writeConfig(tmpDir);
  gitInit(tmpDir);
  gitAdd(tmpDir, 'src/store.ts', 'export class Store { save() {} find() {} }');
  gitCommit(tmpDir, 'initial');
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope enrich', () => {
  it('prints help with --help', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await enrichCommand(['--help']);

    const output = logs.join('\n');
    expect(output).toContain('slope enrich');
    expect(output).toContain('--output');
    expect(output).toContain('--with-plans');

    vi.restoreAllMocks();
  });

  it('errors when backlog is missing', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(enrichCommand([])).rejects.toThrow('exit');
    expect(errors.join('\n')).toContain('not found');

    vi.restoreAllMocks();
    mockExit.mockRestore();
  });

  it('enriches default backlog after indexing', async () => {
    // Build index
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    // Create backlog
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{
        id: 'S1',
        tickets: [{
          key: 'S1-1', title: 'Store feature', description: 'stuff',
          modules: [], acceptance_criteria: [], club: 'putter', max_files: 1,
        }],
      }],
    }));

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await enrichCommand([]);

    expect(logs.join('\n')).toContain('Enriched');

    // Verify enriched file
    const enriched = JSON.parse(readFileSync(join(tmpDir, 'slope-loop/backlog.json'), 'utf8'));
    expect(enriched._enrichMeta).toBeDefined();
    expect(enriched._enrichMeta.version).toBe(1);
    expect(enriched.sprints[0].tickets[0].files).toBeDefined();

    vi.restoreAllMocks();
  });

  it('supports custom --output path', async () => {
    // Build index
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    // Create backlog
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ id: 'S1', tickets: [{ key: 'S1-1', title: 'X', description: '', modules: [], acceptance_criteria: [], club: 'putter', max_files: 1 }] }],
    }));

    const outputPath = join(tmpDir, 'output.json');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await enrichCommand([`--output=${outputPath}`]);

    expect(existsSync(outputPath)).toBe(true);
    const result = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(result._enrichMeta).toBeDefined();

    vi.restoreAllMocks();
  });

  it('generates plans with --with-plans', async () => {
    // Build index
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    // Create backlog
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ id: 'S1', tickets: [{ key: 'S1-1', title: 'Store feature', description: 'Build store', modules: [], acceptance_criteria: [], club: 'short_iron', max_files: 1 }] }],
    }));

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await enrichCommand(['--with-plans']);

    expect(logs.join('\n')).toContain('Plans written');
    expect(existsSync(join(tmpDir, 'slope-loop/plans/S1-1.md'))).toBe(true);

    const planContent = readFileSync(join(tmpDir, 'slope-loop/plans/S1-1.md'), 'utf8');
    expect(planContent).toContain('Execution Plan');

    vi.restoreAllMocks();
  });
});
