import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HookInput, GuardResult } from '../../core/index.js';

/** Get the sentinel file path for a session (persists across process invocations) */
function sentinelPath(sessionId: string): string {
  const dir = join(tmpdir(), 'slope-guards');
  mkdirSync(dir, { recursive: true });
  return join(dir, `worktree-check-${sessionId}`);
}

/** Reset fired state for a session (for testing) */
export function resetWorktreeCheckState(sessionId = ''): void {
  if (sessionId) {
    const p = sentinelPath(sessionId);
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * Worktree-check guard: fires PreToolUse on Edit|Write.
 * Warns (soft 'ask') when editing in the main repo on main/master.
 * Suggests using EnterWorktree for isolation.
 */
export async function worktreeCheckGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Only fire once per session — use temp file since each invocation is a new process
  const sessionId = input.session_id || 'unknown';
  const sentinel = sentinelPath(sessionId);
  if (existsSync(sentinel)) return {};
  writeFileSync(sentinel, new Date().toISOString());

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
