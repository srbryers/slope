import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeMergeGuard } from '../../../src/cli/guards/worktree-merge.js';
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

describe('worktreeMergeGuard', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns empty for non-merge commands', async () => {
    const result = await worktreeMergeGuard(makeInput('git push origin main'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('returns empty for gh pr merge without --delete-branch', async () => {
    const result = await worktreeMergeGuard(makeInput('gh pr merge 117 --squash'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('returns empty for --delete-branch in main working tree', async () => {
    mockMainWorkingTree();
    const result = await worktreeMergeGuard(makeInput('gh pr merge 117 --squash --delete-branch'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('blocks --delete-branch in a worktree', async () => {
    mockWorktree();
    const result = await worktreeMergeGuard(makeInput('gh pr merge 117 --squash --delete-branch'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('worktree');
    // The suggested fix command should not include --delete-branch
    expect(result.blockReason).toContain('gh pr merge 117 --squash');
  });

  it('blocks short -d flag in a worktree', async () => {
    mockWorktree();
    const result = await worktreeMergeGuard(makeInput('gh pr merge 117 --squash -d'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('gh pr merge 117 --squash');
  });

  it('returns empty when git commands fail (not a git repo)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const result = await worktreeMergeGuard(makeInput('gh pr merge 117 --squash --delete-branch'), '/tmp/test');
    expect(result).toEqual({});
  });
});
