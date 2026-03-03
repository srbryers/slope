import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HookInput, GuardResult } from '../../core/index.js';
import { SlopeStoreError } from '../../core/store.js';
import { resolveStore } from '../store.js';

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
 * Hard-blocks (deny) when a concurrent session exists in the same working
 * directory without worktree isolation. Auto-registers the current session
 * in the store on first fire to close the detection gap.
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

  // If git-common-dir is not '.git', we're in a worktree (already isolated)
  if (gitCommonDir !== '.git') return {};

  // Get current branch for session registration
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
  } catch {
    branch = 'unknown';
  }

  // Query store for concurrent sessions
  let store;
  try {
    store = await resolveStore(cwd);
  } catch {
    // Store unavailable — fall back to soft warning
    return {
      decision: 'ask',
      context: `Could not check for concurrent sessions (store unavailable). Consider using a worktree for isolation: use \`EnterWorktree\` to create an isolated working copy.`,
    };
  }

  try {
    // Clean stale sessions first to reduce false positives
    await store.cleanStaleSessions(7_200_000); // 2 hours

    // Auto-register the current session
    try {
      await store.registerSession({
        session_id: sessionId,
        role: 'primary',
        ide: 'claude-code',
        branch,
      });
    } catch (err) {
      // SESSION_CONFLICT means this session is already registered — that's fine
      if (!(err instanceof SlopeStoreError && err.code === 'SESSION_CONFLICT')) {
        throw err;
      }
    }

    // Check for concurrent sessions in the same repo (no worktree_path)
    const active = await store.getActiveSessions();
    const others = active.filter(s => s.session_id !== sessionId);
    const conflicting = others.filter(s => !s.worktree_path);

    if (conflicting.length > 0) {
      const sessionList = conflicting
        .map(s => `  - ${s.session_id} [${s.role}] ${s.ide} (branch: ${s.branch ?? '-'})`)
        .join('\n');
      return {
        decision: 'deny',
        context: `Concurrent session(s) detected in the same working directory without worktree isolation:\n${sessionList}\n\nUse \`EnterWorktree\` to create an isolated working copy, or end the other session(s) with \`slope session end --session-id=<id>\`.`,
      };
    }

    return {};
  } catch (err) {
    // If anything goes wrong querying the store, fall back to soft warning
    if (store) {
      try { store.close(); } catch { /* ignore */ }
    }
    return {
      decision: 'ask',
      context: `Could not check for concurrent sessions (${err instanceof Error ? err.message : 'unknown error'}). Consider using a worktree for isolation: use \`EnterWorktree\` to create an isolated working copy.`,
    };
  } finally {
    if (store) {
      try { store.close(); } catch { /* ignore */ }
    }
  }
}
