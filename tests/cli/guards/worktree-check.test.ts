import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeCheckGuard, resetWorktreeCheckState } from '../../../src/cli/guards/worktree-check.js';
import type { HookInput } from '../../../src/core/index.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Track sentinel files in memory instead of real filesystem
const sentinelFiles = new Set<string>();

vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => sentinelFiles.has(p)),
  writeFileSync: vi.fn((p: string) => { sentinelFiles.add(p); }),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn((p: string) => { sentinelFiles.delete(p); }),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

import { execSync } from 'node:child_process';

const mockExecSync = vi.mocked(execSync);

function makeInput(sessionId = 'test-session'): HookInput {
  return {
    session_id: sessionId,
    cwd: '/tmp/test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/test/src/foo.ts', old_string: 'a', new_string: 'b' },
  };
}

describe('worktreeCheckGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentinelFiles.clear();
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

  it('fires only once per session (sentinel file)', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const first = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(first.decision).toBe('ask');

    // Second invocation with same session_id — sentinel exists, should be silent
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const second = await worktreeCheckGuard(makeInput(), '/tmp/test');
    expect(second).toEqual({});
  });

  it('fires separately for different sessions', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const first = await worktreeCheckGuard(makeInput('session-a'), '/tmp/test');
    expect(first.decision).toBe('ask');

    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const second = await worktreeCheckGuard(makeInput('session-b'), '/tmp/test');
    expect(second.decision).toBe('ask');
  });

  it('resets state correctly via unlinkSync', async () => {
    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    await worktreeCheckGuard(makeInput('reset-test'), '/tmp/test');

    resetWorktreeCheckState('reset-test');

    mockExecSync
      .mockReturnValueOnce('.git' as never)
      .mockReturnValueOnce('main' as never);
    const result = await worktreeCheckGuard(makeInput('reset-test'), '/tmp/test');
    expect(result.decision).toBe('ask');
  });
});
