import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { QUIET_STDIO } from '../../core/process.js';
import { findCommands, positionalArgs } from './command-parse.js';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Worktree-self-remove guard: fires PreToolUse on Bash.
 * Blocks `git worktree remove` when the target path is the current working
 * directory — running this inside the worktree permanently breaks the shell.
 */
export async function worktreeSelfRemoveGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire on an actual `git worktree remove`, never on text that merely
  // contains the phrase — a heredoc, an issue body, a commit message (#683).
  const removes = findCommands(command, ['git', 'worktree', 'remove']);
  if (removes.length === 0) return {};

  // Check if we're in a worktree (not the main working tree)
  let inWorktree = false;
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
    const gitDir = execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
    // In the main working tree, git-dir === git-common-dir (both are .git)
    // In a worktree, git-dir is .git/worktrees/<name> while common-dir is .git
    inWorktree = gitDir !== commonDir && gitDir !== '.git';
  } catch {
    return {};
  }

  if (!inWorktree) return {};

  // The target is the first positional after `remove`, whatever flags precede it.
  const cwdResolved = resolve(cwd);
  const target = removes
    .map(cmd => positionalArgs(cmd, 3)[0])
    .find(token => token != null && resolve(cwd, token.value) === cwdResolved);
  if (!target) return {};

  const targetRaw = target.value;

  return {
    decision: 'deny',
    blockReason: [
      'SLOPE: Cannot remove worktree from within it — shell will break.',
      '',
      'Call ExitWorktree first to return to the main repo, then run cleanup:',
      `  git worktree remove ${targetRaw}`,
      '  git branch -d <branch>',
      '  git push origin --delete <branch>',
      '',
      'Or run: slope worktree cleanup',
    ].join('\n'),
  };
}
