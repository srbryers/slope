import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contextCommand } from '../../../src/cli/commands/context.js';
import { enrichCommand } from '../../../src/cli/commands/enrich.js';
import { indexCommand } from '../../../src/cli/commands/index-cmd.js';
import { initCommand } from '../../../src/cli/commands/init.js';
import { interviewCommand } from '../../../src/cli/commands/interview.js';
import { prepCommand } from '../../../src/cli/commands/prep.js';
import { storeCommand } from '../../../src/cli/commands/store.js';

let originalCwd: string;
let primary: string;
let worktree: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('linked-worktree state consumers', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    primary = mkdtempSync(join(tmpdir(), 'slope-command-state-'));
    worktree = `${primary}-worktree`;
    git(primary, ['init', '-q', '-b', 'main']);
    git(primary, ['config', 'user.email', 'test@example.com']);
    git(primary, ['config', 'user.name', 'Test User']);
    writeFileSync(join(primary, 'README.md'), 'test\n');
    git(primary, ['add', 'README.md']);
    git(primary, ['commit', '-q', '-m', 'init']);

    mkdirSync(join(primary, '.slope'), { recursive: true });
    writeFileSync(join(primary, '.slope', 'config.json'), JSON.stringify({
      projectName: 'shared-owner-marker',
      store_path: '.slope/slope.db',
      embedding: {
        endpoint: 'http://127.0.0.1:1/v1/embeddings',
        model: 'test',
        dimensions: 3,
      },
    }, null, 2));
    git(primary, ['worktree', 'add', '-q', worktree, '-b', 'feature']);
    process.chdir(worktree);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(worktree, { recursive: true, force: true });
    rmSync(primary, { recursive: true, force: true });
  });

  it('keeps all direct SQLite command access in the primary state owner', async () => {
    await indexCommand(['--status', '--json']);
    await expect(contextCommand(['shared state'])).rejects.toThrow('Semantic index is empty');
    await expect(prepCommand(['S1-1'])).rejects.toThrow('Semantic index is empty');

    const backlogPath = join(worktree, 'backlog.json');
    writeFileSync(backlogPath, JSON.stringify({ sprints: [] }));
    await expect(enrichCommand([backlogPath])).rejects.toThrow('Semantic index is empty');

    const backupPath = join(primary, 'slope-backup.db');
    await storeCommand(['backup', `--output=${backupPath}`]);
    expect(existsSync(backupPath)).toBe(true);
    await storeCommand(['restore', `--from=${backupPath}`]);

    expect(existsSync(join(primary, '.slope', 'slope.db'))).toBe(true);
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('blocks init and interview before they can overwrite shared state', async () => {
    const configPath = join(primary, '.slope', 'config.json');
    const originalConfig = readFileSync(configPath, 'utf8');
    vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code ?? 0})`);
    });

    await expect(initCommand(['--generic'])).rejects.toThrow('process.exit(1)');
    await expect(interviewCommand(['--agent'])).rejects.toThrow('process.exit(1)');

    expect(readFileSync(configPath, 'utf8')).toBe(originalConfig);
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });
});
