import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execSync before importing the module
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFileSync, execSync } from 'node:child_process';
import { worktreeCommand } from '../../../src/cli/commands/worktree.js';

const mockExecSync = vi.mocked(execSync);
const mockExecFileSync = vi.mocked(execFileSync);

describe('slope worktree cleanup', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExecFileSync.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('errors when inside a worktree', async () => {
    // Mock isInsideWorktree: common-dir ≠ git-dir
    mockExecSync
      .mockReturnValueOnce('/repo/.git' as any) // git-common-dir
      .mockReturnValueOnce('/repo/.git/worktrees/my-wt' as any); // git-dir

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(worktreeCommand(['cleanup', '--all'])).rejects.toThrow('exit');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Cannot run worktree cleanup from inside a worktree'));

    exitSpy.mockRestore();
  });

  it('reports no worktrees when list is empty', async () => {
    // Mock isInsideWorktree: not in worktree
    mockExecSync
      .mockReturnValueOnce('.git' as any) // git-common-dir
      .mockReturnValueOnce('.git' as any) // git-dir
      .mockReturnValueOnce('' as any); // git worktree list --porcelain

    await worktreeCommand(['cleanup', '--all']);
    expect(console.log).toHaveBeenCalledWith('No worktrees found.');
  });

  it('shows dry-run output for --all', async () => {
    const porcelainOutput = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.claude/worktrees/my-wt',
      'HEAD def456',
      'branch refs/heads/feat/my-feature',
      '',
    ].join('\n');

    // isInsideWorktree: not in worktree
    mockExecSync
      .mockReturnValueOnce('.git' as any) // git-common-dir
      .mockReturnValueOnce('.git' as any) // git-dir
      .mockReturnValueOnce(porcelainOutput as any); // git worktree list --porcelain
    mockExecFileSync.mockImplementation(() => { throw new Error('no gh'); }); // gh --version fails

    await worktreeCommand(['cleanup', '--all', '--dry-run']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would remove worktree'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 worktree(s) would be cleaned'));
  });

  it('reports no secondary worktrees when only main exists', async () => {
    const porcelainOutput = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
    ].join('\n');

    mockExecSync
      .mockReturnValueOnce('.git' as any)
      .mockReturnValueOnce('.git' as any)
      .mockReturnValueOnce(porcelainOutput as any);

    await worktreeCommand(['cleanup', '--all']);
    expect(console.log).toHaveBeenCalledWith('No secondary worktrees to clean up.');
  });

  it('prints help for --help flag', async () => {
    await worktreeCommand(['--help']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('slope worktree'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('start'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cleanup'));
  });

  it('surfaces sibling worktree status and touched-path overlap', async () => {
    const porcelainOutput = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.slope/worktrees/feature',
      'HEAD def456',
      'branch refs/heads/feat/parallel',
      '',
    ].join('\n');

    mockExecFileSync.mockImplementation((cmd, args, options) => {
      const argv = Array.isArray(args) ? args : [];
      const cwd = typeof options === 'object' && options && 'cwd' in options ? String(options.cwd) : '';
      const key = `${cmd} ${argv.join(' ')}`;

      if (key === 'git worktree list --porcelain') return porcelainOutput as any;
      if (key === 'git rev-parse --show-toplevel') return '/repo' as any;
      if (cwd === '/repo/.slope/worktrees/feature' && key === 'git status --porcelain=v1 --untracked-files=all') {
        return ' M src/api.ts\n?? drizzle/0017_new.sql\n' as any;
      }
      if (cwd === '/repo/.slope/worktrees/feature' && key === 'git diff --name-only origin/main...HEAD') {
        return 'src/api.ts\n' as any;
      }
      if (cwd === '/repo/.slope/worktrees/feature' && key === 'git rev-list --left-right --count origin/main...HEAD') {
        return '1\t2\n' as any;
      }
      return '' as any;
    });

    await worktreeCommand(['status', '--base=origin/main', '--touches=src']);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('WORKTREE CONFLICT SURFACE'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('feat/parallel'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('dirty: src/api.ts'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('migrations: drizzle/0017_new.sql'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Potential overlap'));
  });

  it('previews persistent worktree start with session and claim metadata', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as any) // git-common-dir
      .mockReturnValueOnce('.git' as any); // git-dir
    mockExecFileSync.mockReturnValueOnce('/repo' as any); // git rev-parse --show-toplevel

    await worktreeCommand([
      'start',
      '--branch=codex/example',
      '--base=HEAD',
      '--role=secondary',
      '--ide=codex',
      '--target=423',
      '--dry-run',
    ]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('git worktree add'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('register session role=secondary ide=codex branch=codex/example'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('claim 423 (ticket)'));
  });
});
