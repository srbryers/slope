import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execSync before importing the module
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { worktreeCommand } from '../../../src/cli/commands/worktree.js';

const mockExecSync = vi.mocked(execSync);

describe('slope worktree cleanup', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
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
      .mockReturnValueOnce(porcelainOutput as any) // git worktree list --porcelain
      .mockImplementation(() => { throw new Error('no gh'); }); // gh --version fails

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
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cleanup'));
  });
});
