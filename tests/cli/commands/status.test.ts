import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { statusCommand } from '../../../src/cli/commands/status.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

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
});
