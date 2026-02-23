import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import type { FlowsFile } from '../../src/core/index.js';

// Mock process.cwd and process.exit
let tmpDir: string;
let exitCode: number | undefined;

vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
  exitCode = code as number;
  throw new Error(`process.exit(${code})`);
});

import { flowsCommand } from '../../src/cli/commands/flows.js';

function makeFlowsFile(overrides: Partial<FlowsFile> = {}): FlowsFile {
  return {
    version: '1',
    last_generated: '2026-02-23T00:00:00Z',
    flows: [],
    ...overrides,
  };
}

function initGitRepo(dir: string): string {
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), '// index');
  execSync('git add -A && git commit -m "init"', { cwd: dir });
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-cli-flows-'));
  // Create .slope/config.json
  const slopeDir = join(tmpDir, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    flowsPath: '.slope/flows.json',
  }));
  exitCode = undefined;
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope flows init', () => {
  it('creates flows.json with example template', async () => {
    await flowsCommand(['init']);
    const flowsPath = join(tmpDir, '.slope', 'flows.json');
    expect(existsSync(flowsPath)).toBe(true);
    const data = JSON.parse(readFileSync(flowsPath, 'utf8'));
    expect(data.version).toBe('1');
    expect(data.flows).toHaveLength(1);
    expect(data.flows[0].id).toBe('example-flow');
  });

  it('does not overwrite existing flows.json', async () => {
    const flowsPath = join(tmpDir, '.slope', 'flows.json');
    writeFileSync(flowsPath, JSON.stringify(makeFlowsFile({ flows: [] })));
    await flowsCommand(['init']);
    // Should still be the original (empty flows)
    const data = JSON.parse(readFileSync(flowsPath, 'utf8'));
    expect(data.flows).toHaveLength(0);
  });
});

describe('slope flows list', () => {
  it('shows message when no flows file exists', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await flowsCommand(['list']);
    spy.mockRestore();
    expect(logged.some(l => l.includes('No flows defined'))).toBe(true);
  });

  it('lists flows with table format', async () => {
    const sha = initGitRepo(tmpDir);
    const flows = makeFlowsFile({
      flows: [{
        id: 'oauth',
        title: 'OAuth Login',
        description: 'OAuth flow',
        entry_point: 'src/index.ts',
        steps: [],
        files: ['src/index.ts'],
        tags: ['auth'],
        last_verified_sha: sha,
        last_verified_at: '2026-02-23T00:00:00Z',
      }],
    });
    writeFileSync(join(tmpDir, '.slope', 'flows.json'), JSON.stringify(flows));

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await flowsCommand(['list']);
    spy.mockRestore();

    expect(logged.some(l => l.includes('oauth'))).toBe(true);
    expect(logged.some(l => l.includes('OAuth Login'))).toBe(true);
    expect(logged.some(l => l.includes('1 flow(s)'))).toBe(true);
  });
});

describe('slope flows check', () => {
  it('exits 1 when no flows file exists', async () => {
    await expect(flowsCommand(['check'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('passes with valid current flows', async () => {
    const sha = initGitRepo(tmpDir);
    const flows = makeFlowsFile({
      flows: [{
        id: 'test',
        title: 'Test Flow',
        description: 'A test',
        entry_point: 'src/index.ts',
        steps: [{ name: 'S1', description: 'step', file_paths: ['src/index.ts'] }],
        files: ['src/index.ts'],
        tags: ['test'],
        last_verified_sha: sha,
        last_verified_at: '2026-02-23T00:00:00Z',
      }],
    });
    writeFileSync(join(tmpDir, '.slope', 'flows.json'), JSON.stringify(flows));

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await flowsCommand(['check']);
    spy.mockRestore();

    expect(logged.some(l => l.includes('valid and current'))).toBe(true);
  });

  it('exits 1 when files are missing', async () => {
    initGitRepo(tmpDir);
    const flows = makeFlowsFile({
      flows: [{
        id: 'bad',
        title: 'Bad Flow',
        description: 'Has missing files',
        entry_point: 'src/missing.ts',
        steps: [],
        files: ['src/missing.ts'],
        tags: [],
        last_verified_sha: '',
        last_verified_at: '',
      }],
    });
    writeFileSync(join(tmpDir, '.slope', 'flows.json'), JSON.stringify(flows));

    await expect(flowsCommand(['check'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('exits 1 when flows are stale', async () => {
    const sha = initGitRepo(tmpDir);
    // Make another commit that modifies a tracked file
    writeFileSync(join(tmpDir, 'src', 'index.ts'), '// modified');
    execSync('git add -A && git commit -m "modify"', { cwd: tmpDir });

    const flows = makeFlowsFile({
      flows: [{
        id: 'stale-flow',
        title: 'Stale Flow',
        description: 'Will be stale',
        entry_point: 'src/index.ts',
        steps: [{ name: 'S1', description: 'step', file_paths: ['src/index.ts'] }],
        files: ['src/index.ts'],
        tags: ['test'],
        last_verified_sha: sha,
        last_verified_at: '2026-02-23T00:00:00Z',
      }],
    });
    writeFileSync(join(tmpDir, '.slope', 'flows.json'), JSON.stringify(flows));

    await expect(flowsCommand(['check'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });
});

describe('slope flows (no subcommand)', () => {
  it('prints usage', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await flowsCommand([]);
    spy.mockRestore();
    expect(logged.some(l => l.includes('slope flows'))).toBe(true);
  });
});
