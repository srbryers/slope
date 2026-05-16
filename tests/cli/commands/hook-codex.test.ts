import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hookCommand } from '../../../src/cli/commands/hook.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slope-hook-codex-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

type CodexHookEntry = { matcher?: string; hooks: Array<{ command: string }> };

function findHookGroupForCommand(groups: CodexHookEntry[] | undefined, commandPart: string): CodexHookEntry | undefined {
  return groups?.find(group => group.hooks.some(hook => hook.command.includes(commandPart)));
}

describe('slope hook add --harness=codex', () => {
  let cwd: string;
  let origCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(cwd);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      metaphor: 'golf',
    }));
    writeFileSync(join(cwd, '.slope', 'hooks.json'), JSON.stringify({ installed: {} }));
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('registers the Codex adapter for explicit project-local guard installs', async () => {
    await hookCommand(['add', '--level=essential', '--harness=codex']);

    const scriptPath = join(cwd, '.codex', 'hooks', 'slope-guard.sh');
    const configPath = join(cwd, '.codex', 'hooks.json');
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const codexConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(codexConfig.hooks).toBeDefined();

    const slopeConfig = JSON.parse(readFileSync(join(cwd, '.slope', 'hooks.json'), 'utf8'));
    expect(Object.keys(slopeConfig.installed).some(k => k.startsWith('guard-'))).toBe(true);
  });

  it('reports installed guard definitions instead of persisted unique guard names', async () => {
    const log = vi.mocked(console.log);

    await hookCommand(['add', '--level=full', '--harness=codex']);

    const output = log.mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('Installed 30 of 31 guard hooks (level: full)');
    expect(output).toContain('compaction');
    expect(output).toContain('unsupported by harness');
  });

  it('installs claim-required under the Codex write matcher for project-local full installs', async () => {
    await hookCommand(['add', '--level=full', '--harness=codex']);

    const codexConfig = JSON.parse(readFileSync(join(cwd, '.codex', 'hooks.json'), 'utf8'));
    const group = findHookGroupForCommand(codexConfig.hooks.PreToolUse, 'claim-required');

    expect(group).toBeDefined();
    expect(group?.matcher?.split('|')).toEqual(expect.arrayContaining(['apply_patch', 'Edit', 'Write']));
  });
});
