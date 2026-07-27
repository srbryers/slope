import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadConfig,
  resolvePrimaryCheckout,
  resolveRepoStateCwd,
  resolveRepoStatePath,
} from '../../src/core/index.js';
import { createStore } from '../../src/store/index.js';

let primary: string;
let worktree: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('repository state scope', () => {
  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), 'slope-state-primary-'));
    worktree = `${primary}-worktree`;
    git(primary, ['init', '-q', '-b', 'main']);
    git(primary, ['config', 'user.email', 'test@example.com']);
    git(primary, ['config', 'user.name', 'Test User']);
    writeFileSync(join(primary, 'README.md'), 'test\n');
    git(primary, ['add', 'README.md']);
    git(primary, ['commit', '-q', '-m', 'init']);

    mkdirSync(join(primary, '.slope'), { recursive: true });
    writeFileSync(join(primary, '.slope', 'config.json'), JSON.stringify({
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
      minSprint: 1,
      metaphor: 'golf',
      store_path: '.slope/slope.db',
    }));
    git(primary, ['worktree', 'add', '-q', worktree, '-b', 'feature']);
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(primary, { recursive: true, force: true });
  });

  it('resolves linked worktrees to the primary SLOPE state owner', () => {
    const canonicalPrimary = realpathSync(primary);
    expect(resolvePrimaryCheckout(worktree)).toBe(canonicalPrimary);
    expect(resolveRepoStateCwd(worktree)).toBe(canonicalPrimary);
    expect(resolveRepoStatePath(worktree, '.slope/slope.db'))
      .toBe(join(canonicalPrimary, '.slope', 'slope.db'));
  });

  it('loads config from the primary checkout without creating local state', () => {
    expect(loadConfig(worktree).store_path).toBe('.slope/slope.db');
    expect(existsSync(join(worktree, '.slope'))).toBe(false);
  });

  it('ignores a legacy copied config at a linked worktree root', () => {
    mkdirSync(join(worktree, '.slope'), { recursive: true });
    writeFileSync(join(worktree, '.slope', 'config.json'), JSON.stringify({
      store_path: '.slope/local.db',
    }));

    expect(loadConfig(worktree).store_path).toBe('.slope/slope.db');
    expect(resolveRepoStateCwd(worktree)).toBe(realpathSync(primary));
  });

  it('keeps an explicitly nested SLOPE project locally scoped', () => {
    const nested = join(worktree, 'fixtures', 'standalone');
    mkdirSync(join(nested, '.slope'), { recursive: true });
    writeFileSync(join(nested, '.slope', 'config.json'), JSON.stringify({
      store_path: '.slope/nested.db',
    }));

    expect(resolveRepoStateCwd(nested)).toBe(nested);
    expect(loadConfig(nested).store_path).toBe('.slope/nested.db');
  });

  it('opens the same SQLite store from the primary and linked worktree', async () => {
    const fromWorktree = createStore({ storePath: '.slope/slope.db', cwd: worktree });
    await fromWorktree.registerSession({
      session_id: 'worktree-session',
      role: 'secondary',
      ide: 'test',
    });
    fromWorktree.close();

    expect(existsSync(join(primary, '.slope', 'slope.db'))).toBe(true);
    expect(existsSync(join(worktree, '.slope', 'slope.db'))).toBe(false);

    const fromPrimary = createStore({ storePath: '.slope/slope.db', cwd: primary });
    const sessions = await fromPrimary.getActiveSessions();
    fromPrimary.close();
    expect(sessions.map(session => session.session_id)).toContain('worktree-session');
  });

  it('falls back to the local cwd when the primary is not SLOPE-enabled', () => {
    rmSync(join(primary, '.slope'), { recursive: true, force: true });
    expect(resolveRepoStateCwd(worktree)).toBe(worktree);
  });
});
