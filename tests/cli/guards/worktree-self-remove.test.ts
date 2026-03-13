import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeSelfRemoveGuard } from '../../../src/cli/guards/worktree-self-remove.js';
import type { HookInput } from '../../../src/core/index.js';

// Mock execSync to control worktree detection
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

function makeInput(command: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp/test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: {},
  };
}

function mockWorktree() {
  mockExecSync
    .mockReturnValueOnce('/repo/.git' as any) // git-common-dir
    .mockReturnValueOnce('/repo/.git/worktrees/my-branch' as any); // git-dir
}

function mockMainWorkingTree() {
  mockExecSync
    .mockReturnValueOnce('.git' as any) // git-common-dir
    .mockReturnValueOnce('.git' as any); // git-dir
}

describe('worktreeSelfRemoveGuard', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns empty for non-worktree-remove commands', async () => {
    const result = await worktreeSelfRemoveGuard(makeInput('git push origin main'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('returns empty for git worktree list', async () => {
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree list'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('returns empty when not in a worktree', async () => {
    mockMainWorkingTree();
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree remove .'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('blocks git worktree remove . in a worktree', async () => {
    mockWorktree();
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree remove .'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Cannot remove worktree from within it');
    expect(result.blockReason).toContain('ExitWorktree');
    expect(result.blockReason).toContain('slope worktree cleanup');
  });

  it('blocks git worktree remove with absolute path matching cwd', async () => {
    mockWorktree();
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree remove /tmp/test'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Cannot remove worktree from within it');
  });

  it('allows git worktree remove targeting a different path', async () => {
    mockWorktree();
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree remove /other/worktree'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('blocks git worktree remove --force . in a worktree', async () => {
    mockWorktree();
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree remove --force .'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('Cannot remove worktree from within it');
  });

  it('returns empty when git commands fail (not a git repo)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const result = await worktreeSelfRemoveGuard(makeInput('git worktree remove .'), '/tmp/test');
    expect(result).toEqual({});
  });
});
