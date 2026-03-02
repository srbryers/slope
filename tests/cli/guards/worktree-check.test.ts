import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeCheckGuard, resetWorktreeCheckState } from '../../../src/cli/guards/worktree-check.js';
import type { HookInput } from '../../../src/core/index.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

const mockExecSync = vi.mocked(execSync);

function makeInput(): HookInput {
  return {
    session_id: 'test-session',
    cwd: '/tmp/test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/test/src/foo.ts', old_string: 'a', new_string: 'b' },
  };
}

describe('worktreeCheckGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorktreeCheckState();
  });

  it('warns when in main repo on main branch', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)       // git-common-dir
      .mockReturnValueOnce('main' as never);       // branch
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('ask');
    expect(result.context).toContain('worktree');
    expect(result.context).toContain('main');
  });

  it('warns when in main repo on master branch', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('master' as never);
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('ask');
    expect(result.context).toContain('master');
  });

  it('returns empty when in a worktree', async () => {
    mockExecSync
      .mockReturnValueOnce('../../.git' as never); // git-common-dir != '.git'
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('returns empty on a feature branch', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('feat/worktree-guard' as never);
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('returns empty when not a git repo', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result).toEqual({});
  });

  it('fires only once per session', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const first = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(first.decision).toBe('ask');

    // Second invocation — should be silent
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const second = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(second).toEqual({});
  });

  it('resets state correctly', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    await worktreeCheckGuard(makeInput(), '/tmp/test');

    resetWorktreeCheckState();

    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const result = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(result.decision).toBe('ask');
  });
});
