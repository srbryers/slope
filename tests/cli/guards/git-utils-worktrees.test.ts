import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getActiveWorktrees } from '../../../src/cli/guards/git-utils.js';

/**
 * `getActiveWorktrees` had no test anywhere, and it compared git's output to
 * `cwd` as raw strings. `git worktree list --porcelain` reports forward
 * slashes on every platform, so on Windows the primary checkout never matched
 * and was reported as an agent worktree. The next-action guard then raised
 * `worktrees-active` against the directory the operator was standing in,
 * listing their own unpushed commits as somebody else's (#712).
 *
 * Real git, real worktrees. A mock of `git worktree list` would have to invent
 * the separator style, which is the thing under test.
 */

const dirs: string[] = [];

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function setupRepoWithWorktree(): { primary: string; linked: string } {
  const primary = mkdtempSync(join(tmpdir(), 'slope-worktrees-'));
  dirs.push(primary);
  git(primary, ['init', '-b', 'main']);
  git(primary, ['config', 'user.email', 't@t']);
  git(primary, ['config', 'user.name', 't']);
  writeFileSync(join(primary, 'README.md'), 'primary\n');
  git(primary, ['add', 'README.md']);
  git(primary, ['commit', '-m', 'init']);

  const linked = `${primary}-linked`;
  dirs.push(linked);
  git(primary, ['worktree', 'add', '-b', 'feat/side', linked]);
  return { primary, linked };
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('getActiveWorktrees (#712)', () => {
  it('excludes the checkout it was called from', () => {
    const { primary, linked } = setupRepoWithWorktree();

    const fromPrimary = getActiveWorktrees(primary);

    // Only the linked worktree is an "active agent worktree" from here.
    expect(fromPrimary).toHaveLength(1);
    expect(fromPrimary[0].branch).toBe('feat/side');
    expect(resolve(fromPrimary[0].path)).toBe(resolve(linked));
  });

  it('excludes the linked worktree when called from inside it', () => {
    const { primary, linked } = setupRepoWithWorktree();

    const fromLinked = getActiveWorktrees(linked);

    expect(fromLinked).toHaveLength(1);
    expect(fromLinked[0].branch).toBe('main');
    expect(resolve(fromLinked[0].path)).toBe(resolve(primary));
  });

  it('reports unpushed work on the other worktree, not on its own', () => {
    const { primary, linked } = setupRepoWithWorktree();
    writeFileSync(join(linked, 'side.md'), 'work\n');
    git(linked, ['add', 'side.md']);
    git(linked, ['commit', '-m', 'side work']);

    const fromPrimary = getActiveWorktrees(primary);

    expect(fromPrimary).toHaveLength(1);
    expect(fromPrimary[0].branch).toBe('feat/side');
    // No upstream configured, so the count is 0 rather than a crash. The
    // assertion that matters is that the primary is absent: reporting it
    // would attribute the operator's own commits to another agent.
    expect(fromPrimary.some(w => w.branch === 'main')).toBe(false);
  });
});
