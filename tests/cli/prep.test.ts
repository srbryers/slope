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

import { prepCommand } from '../../src/cli/commands/prep.js';
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
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-prep-cli-'));
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

describe('slope prep', () => {
  it('prints help with --help', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await prepCommand(['--help']);

    const output = logs.join('\n');
    expect(output).toContain('slope prep');
    expect(output).toContain('--json');

    vi.restoreAllMocks();
  });

  it('errors without ticket-id', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(prepCommand([])).rejects.toThrow('exit');
    expect(errors.join('\n')).toContain('ticket ID');

    vi.restoreAllMocks();
    mockExit.mockRestore();
  });

  it('errors when index is empty', async () => {
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{ tickets: [{ key: 'S1-1', title: 'Test', description: '' }] }],
    }));

    await expect(prepCommand(['S1-1'])).rejects.toThrow('empty');
  });

  it('generates markdown output after indexing', async () => {
    // Build index
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    // Create backlog with ticket
    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{
        tickets: [{
          key: 'S1-1',
          title: 'Store feature',
          description: 'Build the store',
          modules: ['src'],
          acceptance_criteria: ['tests pass'],
          club: 'short_iron',
        }],
      }],
    }));

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await prepCommand(['S1-1']);

    const output = logs.join('\n');
    expect(output).toContain('Execution Plan');
    expect(output).toContain('S1-1');
    expect(output).toContain('Verification');

    vi.restoreAllMocks();
  });

  it('outputs JSON with --json flag', async () => {
    // Build index
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await indexCommand(['--full']);
    vi.restoreAllMocks();

    mkdirSync(join(tmpDir, 'slope-loop'), { recursive: true });
    writeFileSync(join(tmpDir, 'slope-loop/backlog.json'), JSON.stringify({
      sprints: [{
        tickets: [{
          key: 'S1-1',
          title: 'Store',
          description: '',
          modules: [],
          club: 'putter',
        }],
      }],
    }));

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await prepCommand(['S1-1', '--json']);

    const output = logs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.ticket).toBe('S1-1');
    expect(parsed.metadata.version).toBe(1);

    vi.restoreAllMocks();
  });
});
