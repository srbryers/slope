import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { computeScorecardDrift, statusCommand } from '../../../src/cli/commands/status.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';
import { createStore } from '../../../src/store/index.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-status-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    currentSprint: 18,
    store_path: '.slope/slope.db',
  }));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  try {
    await fn();
  } finally {
    vi.restoreAllMocks();
  }
  return logs.join('\n');
}

function gitInit(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@test', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
}

function gitCommit(dir: string, message: string): void {
  writeFileSync(join(dir, `commit-${Date.now()}-${Math.random()}.txt`), message);
  execSync('git add -A', { cwd: dir });
  execSync('git commit -q -m "' + message.replaceAll('"', '\\"') + '"', { cwd: dir });
}

describe('slope status', () => {
  it('prefers live sprint-state over stale configured sprint context', async () => {
    saveSprintState(tmpDir, createSprintState(74, 'planning'));

    const output = await captureLog(() => statusCommand([]));

    expect(output).toContain('S74 — Course Status');
    expect(output).not.toContain('S18 — Course Status');
  });

  it('keeps explicit --sprint override behavior', async () => {
    saveSprintState(tmpDir, createSprintState(74, 'planning'));

    const output = await captureLog(() => statusCommand(['--sprint=18']));

    expect(output).toContain('S18 — Course Status');
  });

  it('preserves decimal --sprint overrides', async () => {
    saveSprintState(tmpDir, createSprintState(74, 'planning'));

    const output = await captureLog(() => statusCommand(['--sprint=143.5']));

    expect(output).toContain('S143.5 — Course Status');
    expect(output).not.toContain('S143 — Course Status');
  });

  it('rejects invalid --sprint overrides', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(statusCommand(['--sprint=143.nope'])).rejects.toThrow('process.exit(1)');

    const output = consoleErrorSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('Error: --sprint must be a positive sprint id, e.g. 114 or 114.5');
  });

  it('marks stored swarm branches as start-time identity when the checkout is unregistered', async () => {
    gitInit(tmpDir);
    const unregistered = mkdtempSync(join(tmpdir(), 'slope-status-unregistered-'));
    gitInit(unregistered);
    execSync('git checkout -q -b secret/unrelated', { cwd: unregistered });

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    await store.registerSession({
      session_id: 'swarm-session',
      role: 'observer',
      ide: 'codex',
      branch: 'main',
      worktree_path: unregistered,
      swarm_id: 'review-swarm',
    });
    store.close();

    try {
      const output = await captureLog(() => statusCommand(['--swarm=review-swarm']));

      expect(output).toContain('Branch at start: main');
      expect(output).not.toContain('secret/unrelated');
    } finally {
      rmSync(unregistered, { recursive: true, force: true });
    }
  });

  it('filters scorecard drift to sprint ids present in the roadmap', () => {
    gitInit(tmpDir);
    mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
      name: 'Test Roadmap',
      phases: [{ name: 'Current', sprints: [7] }],
      sprints: [
        {
          id: 7,
          theme: 'Current',
          par: 4,
          slope: 2,
          type: 'feature',
          tickets: [
            { key: 'S7-1', title: 'T1', club: 'short_iron', complexity: 'standard' },
            { key: 'S7-2', title: 'T2', club: 'short_iron', complexity: 'standard' },
            { key: 'S7-3', title: 'T3', club: 'wedge', complexity: 'small' },
          ],
        },
      ],
    }));

    gitCommit(tmpDir, 'feat(S194-5): historical import-era work');
    gitCommit(tmpDir, 'feat(S7): current roadmap work');

    expect(computeScorecardDrift(tmpDir).missing).toEqual(['7']);
  });
});
