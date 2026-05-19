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
});
