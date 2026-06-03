import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const createStoreMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/store/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/store/index.js')>();
  return {
    ...actual,
    createStore: createStoreMock,
  };
});

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-sprint-status-native-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ currentSprint: 133 }));
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=22 <23' } }));
  writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  process.exitCode = undefined;
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('slope sprint status native SQLite recovery', () => {
  it('prints explicit ABI recovery guidance for stale better-sqlite3 bindings', async () => {
    createStoreMock.mockImplementation(() => {
      throw new Error("The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 147.");
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sprintCommand } = await import('../../src/cli/commands/sprint.js');

    await sprintCommand(['status']);

    const output = errSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('NODE_MODULE_VERSION 127');
    expect(output).toContain(`Active Node: ${process.version}`);
    expect(output).toContain('compiled NODE_MODULE_VERSION 127');
    expect(output).toContain('runtime requires NODE_MODULE_VERSION 147');
    expect(output).toContain('pnpm install');
    expect(process.exitCode).toBe(1);
  });
});
