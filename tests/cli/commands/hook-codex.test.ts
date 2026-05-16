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
});
