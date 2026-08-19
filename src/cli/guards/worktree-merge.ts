import { execSync } from 'node:child_process';
import { QUIET_STDIO } from '../../core/process.js';
import { parseShellCommands, commandMatches, findFlagToken, removeToken } from './command-parse.js';
import type { HookInput, GuardResult } from '../../core/index.js';

/** `gh pr merge` spellings for deleting the branch after the merge. */
const DELETE_BRANCH_FLAGS = ['--delete-branch', '-d'];

/**
 * Worktree-merge guard: fires PreToolUse on Bash.
 * Detects `gh pr merge --delete-branch` in a worktree and rewrites the
 * command to drop `--delete-branch`, which fails because the worktree
 * holds the target branch. The merge itself succeeds but the exit code
 * is 1, causing the agent to think it failed and retry.
 *
 * The flag is located by parsing the invocation into commands and argv
 * tokens, never by matching the raw text: the guard used to fire on any
 * command that merely carried the flag as data, and its suggested rewrite
 * edited that data rather than a command (#683).
 */
export async function worktreeMergeGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire when the flag is genuinely an argument of a `gh pr merge`.
  // Check EVERY merge in the invocation, not just the first: merging a
  // stacked-PR set runs several in one command and it is typically the last
  // that carries the flag, which a first-match lookup would miss entirely.
  const flag = parseShellCommands(command)
    .filter(cmd => commandMatches(cmd, ['gh', 'pr', 'merge']))
    .map(cmd => findFlagToken(cmd, DELETE_BRANCH_FLAGS))
    .find((token): token is NonNullable<typeof token> => token != null);
  if (!flag) return {};

  // Check if we're in a worktree (not the main working tree)
  try {
    const listOutput = execSync('git rev-parse --git-common-dir', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
    const gitDir = execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
    // In the main working tree, git-dir === git-common-dir (both are .git)
    // In a worktree, git-dir is .git/worktrees/<name> while common-dir is .git
    if (gitDir === listOutput || gitDir === '.git') return {};
  } catch {
    return {};
  }

  // Splice the flag out of the original text: every other byte is preserved,
  // so the suggestion is safe to run verbatim.
  const fixed = removeToken(command, flag);

  return {
    decision: 'deny',
    blockReason: [
      `SLOPE worktree-merge: \`${flag.value}\` will fail in a worktree (local branch cleanup can't switch to main).`,
      `The merge succeeds but exits with code 1, making it look like it failed.`,
      ``,
      `Use this instead:`,
      `  ${fixed}`,
      ``,
      `The remote branch will be deleted by GitHub when the PR merges. The local worktree branch is cleaned up when the worktree is removed.`,
    ].join('\n'),
  };
}
