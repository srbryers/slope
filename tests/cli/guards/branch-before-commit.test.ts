import { describe, it, expect, vi, beforeEach } from 'vitest';
import { branchBeforeCommitGuard } from '../../../src/cli/guards/branch-before-commit.js';
import type { HookInput } from '../../../src/core/index.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../../src/cli/config.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

import { execSync } from 'node:child_process';
import { loadConfig } from '../../../src/cli/config.js';

const mockExecSync = vi.mocked(execSync);
const mockLoadConfig = vi.mocked(loadConfig);

function makeInput(command: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: '/tmp/test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

describe('branchBeforeCommitGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({} as ReturnType<typeof loadConfig>);
  });

  it('denies git commit on main', async () => {
    mockExecSync.mockReturnValue('main');
    const result = await branchBeforeCommitGuard(makeInput('git commit -m "feat: stuff"'), '/tmp/test');
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('feature branch');
  });

  it('denies git commit on master', async () => {
    mockExecSync.mockReturnValue('master');
    const result = await branchBeforeCommitGuard(makeInput('git commit -m "fix: bug"'), '/tmp/test');
    expect(result.decision).toBe('deny');
  });

  it('denies git commit --amend on main', async () => {
    mockExecSync.mockReturnValue('main');
    const result = await branchBeforeCommitGuard(makeInput('git commit --amend'), '/tmp/test');
    expect(result.decision).toBe('deny');
  });

  it('allows git commit on feature branch', async () => {
    mockExecSync.mockReturnValue('feat/my-feature');
    const result = await branchBeforeCommitGuard(makeInput('git commit -m "feat: new"'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows git commit-tree on main (not a commit)', async () => {
    mockExecSync.mockReturnValue('main');
    const result = await branchBeforeCommitGuard(makeInput('git commit-tree abc123'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows non-git commands', async () => {
    const result = await branchBeforeCommitGuard(makeInput('pnpm test'), '/tmp/test');
    expect(result).toEqual({});
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('allows when not a git repo (execSync throws)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const result = await branchBeforeCommitGuard(makeInput('git commit -m "test"'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows when HEAD is detached (initial repo)', async () => {
    mockExecSync.mockReturnValue('HEAD');
    const result = await branchBeforeCommitGuard(makeInput('git commit -m "initial"'), '/tmp/test');
    expect(result).toEqual({});
  });

  it('allows when allowMainCommitPatterns matches commit message', async () => {
    mockExecSync.mockReturnValue('main');
    mockLoadConfig.mockReturnValue({
      guidance: { allowMainCommitPatterns: ['^chore\\(release\\)'] },
    } as ReturnType<typeof loadConfig>);

    const result = await branchBeforeCommitGuard(
      makeInput('git commit -m "chore(release): bump version to 1.6.0"'),
      '/tmp/test',
    );
    expect(result).toEqual({});
  });

  it('denies when allowMainCommitPatterns does not match', async () => {
    mockExecSync.mockReturnValue('main');
    mockLoadConfig.mockReturnValue({
      guidance: { allowMainCommitPatterns: ['^chore\\(release\\)'] },
    } as ReturnType<typeof loadConfig>);

    const result = await branchBeforeCommitGuard(
      makeInput('git commit -m "feat: new feature"'),
      '/tmp/test',
    );
    expect(result.decision).toBe('deny');
  });

  it('allows single-quoted commit messages matching pattern', async () => {
    mockExecSync.mockReturnValue('main');
    mockLoadConfig.mockReturnValue({
      guidance: { allowMainCommitPatterns: ['^chore\\(release\\)'] },
    } as ReturnType<typeof loadConfig>);

    const result = await branchBeforeCommitGuard(
      makeInput("git commit -m 'chore(release): v2.0.0'"),
      '/tmp/test',
    );
    expect(result).toEqual({});
  });
});
