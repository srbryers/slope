import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Worktree-merge guard: fires PreToolUse on Bash.
 * Detects `gh pr merge --delete-branch` in a worktree and rewrites the
 * command to drop `--delete-branch`, which fails because the worktree
 * holds the target branch. The merge itself succeeds but the exit code
 * is 1, causing the agent to think it failed and retry.
 */
export async function worktreeMergeGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire on gh pr merge with --delete-branch
  if (!/gh\s+pr\s+merge/.test(command)) return {};
  if (!/(--delete-branch|-d\b)/.test(command)) return {};

  // Check if we're in a worktree (not the main working tree)
  try {
    const listOutput = execSync('git rev-parse --git-common-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    const gitDir = execSync('git rev-parse --git-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    // In the main working tree, git-dir === git-common-dir (both are .git)
    // In a worktree, git-dir is .git/worktrees/<name> while common-dir is .git
    if (gitDir === listOutput || gitDir === '.git') return {};
  } catch {
    return {};
  }

  // Rewrite the command: strip --delete-branch / -d
  const fixed = command
    .replace(/\s+--delete-branch/, '')
    .replace(/\s+-d\b/, '');

  return {
    decision: 'deny',
    blockReason: [
      `SLOPE worktree-merge: \`--delete-branch\` will fail in a worktree (local branch cleanup can't switch to main).`,
      `The merge succeeds but exits with code 1, making it look like it failed.`,
      ``,
      `Use this instead:`,
      `  ${fixed}`,
      ``,
      `The remote branch will be deleted by GitHub when the PR merges. The local worktree branch is cleaned up when the worktree is removed.`,
    ].join('\n'),
  };
}
