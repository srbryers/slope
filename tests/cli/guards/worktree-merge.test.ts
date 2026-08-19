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

  // #683 — the guard matched the raw command text, so anything merely
  // carrying the flag as data was blocked, and the rewrite it suggested
  // edited that data instead of a command.
  describe('command-text precision (#683)', () => {
    it('does not fire on a gh pr merge without the flag in a compound command', async () => {
      const result = await worktreeMergeGuard(
        makeInput('gh pr merge 117 --squash --admin && git fetch && npm run deploy'),
        '/tmp/test',
      );
      expect(result).toEqual({});
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('does not fire when the flag only appears inside an issue body', async () => {
      const result = await worktreeMergeGuard(
        makeInput('gh issue create --title "bug" --body "gh pr merge --delete-branch fails in a worktree"'),
        '/tmp/test',
      );
      expect(result).toEqual({});
    });

    it('does not fire when the flag only appears inside a heredoc body', async () => {
      const command = [
        "python3 - <<'PY'",
        'notes = "`gh pr merge --delete-branch` exits 1 in a worktree despite succeeding."',
        'open("notes.md", "w").write(notes)',
        'PY',
      ].join('\n');
      const result = await worktreeMergeGuard(makeInput(command), '/tmp/test');
      expect(result).toEqual({});
    });

    it('does not fire on -d belonging to another program', async () => {
      const result = await worktreeMergeGuard(
        makeInput('gh pr merge 117 --squash | cut -d= -f2-'),
        '/tmp/test',
      );
      expect(result).toEqual({});
    });

    it('still fires when the flag is genuinely passed inside a compound command', async () => {
      mockWorktree();
      const result = await worktreeMergeGuard(
        makeInput('git fetch && gh pr merge 117 --squash --delete-branch && npm run deploy'),
        '/tmp/test',
      );
      expect(result.decision).toBe('deny');
    });

    it('suggests a command that is byte-identical apart from the removed flag', async () => {
      mockWorktree();
      const command = 'gh pr merge 117 --squash --delete-branch --admin | cut -d= -f2-';
      const result = await worktreeMergeGuard(makeInput(command), '/tmp/test');
      expect(result.blockReason).toContain('gh pr merge 117 --squash --admin | cut -d= -f2-');
      expect(result.blockReason).not.toContain('cut= -f2-');
    });

    it('names the flag that was actually passed', async () => {
      mockWorktree();
      const result = await worktreeMergeGuard(makeInput('gh pr merge 117 -d'), '/tmp/test');
      expect(result.blockReason).toContain('`-d`');
    });

    // Found by independent review of #692: `.find()` inspected only the FIRST
    // gh pr merge, so a stacked-PR set whose last merge carries the flag
    // fell through. The pre-#683 regex caught this, so it was a regression.
    it('checks every merge in the invocation, not just the first', async () => {
      mockWorktree();
      const result = await worktreeMergeGuard(
        makeInput('gh pr merge 100 --squash && gh pr merge 101 --squash --delete-branch'),
        '/tmp/test',
      );
      expect(result.decision).toBe('deny');
      expect(result.blockReason).toContain('gh pr merge 100 --squash && gh pr merge 101 --squash');
    });

    it('does not fire when no merge in the set carries the flag', async () => {
      const result = await worktreeMergeGuard(
        makeInput('gh pr merge 100 --squash && gh pr merge 101 --squash'),
        '/tmp/test',
      );
      expect(result).toEqual({});
    });
  });
});
