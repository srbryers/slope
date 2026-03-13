import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Worktree-self-remove guard: fires PreToolUse on Bash.
 * Blocks `git worktree remove` when the target path is the current working
 * directory — running this inside the worktree permanently breaks the shell.
 */
export async function worktreeSelfRemoveGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire on git worktree remove
  if (!/git\s+worktree\s+remove/.test(command)) return {};

  // Check if we're in a worktree (not the main working tree)
  let inWorktree = false;
  try {
    const commonDir = execSync('git rev-parse --git-common-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    const gitDir = execSync('git rev-parse --git-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    // In the main working tree, git-dir === git-common-dir (both are .git)
    // In a worktree, git-dir is .git/worktrees/<name> while common-dir is .git
    inWorktree = gitDir !== commonDir && gitDir !== '.git';
  } catch {
    return {};
  }

  if (!inWorktree) return {};

  // Parse the target path from command: git worktree remove [--force] <path>
  const match = command.match(/git\s+worktree\s+remove\s+(?:--force\s+)?(.+?)(?:\s|$)/);
  if (!match) return {};

  const targetRaw = match[1].trim();
  const targetPath = resolve(cwd, targetRaw);
  const cwdResolved = resolve(cwd);

  if (targetPath !== cwdResolved) return {};

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
