import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';

/** Module-level flag: only fire once per session (process lifetime) */
let hasFired = false;

/** Reset fired state (for testing) */
export function resetWorktreeCheckState(): void {
  hasFired = false;
}

/**
 * Worktree-check guard: fires PreToolUse on Edit|Write.
 * Warns (soft 'ask') when editing in the main repo on main/master.
 * Suggests using EnterWorktree for isolation.
 */
export async function worktreeCheckGuard(_input: HookInput, cwd: string): Promise<GuardResult> {
  // Only fire once per session
  if (hasFired) return {};
  hasFired = true;

  // Check if we're in a worktree: git-common-dir returns '.git' for main repo,
  // or a path like '../../.git' for a worktree
  let gitCommonDir: string;
  try {
    gitCommonDir = execSync('git rev-parse --git-common-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
  } catch {
    // Not a git repo — allow
    return {};
  }

  // If git-common-dir is '.git', we're in the main repo (not a worktree)
  if (gitCommonDir !== '.git') return {};

  // Check current branch — only warn on main/master
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return {};
  }

  if (branch !== 'main' && branch !== 'master') return {};

  return {
    decision: 'ask',
    context: `You are editing in the main repository on \`${branch}\`. Consider using a worktree for isolation to avoid conflicts with concurrent sessions (e.g. slope-loop). Use \`EnterWorktree\` to create an isolated working copy, or create a feature branch with \`git checkout -b feat/<name>\` before making changes.`,
  };
}
