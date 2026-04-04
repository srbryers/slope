import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { HookInput, GuardResult } from '../../core/index.js';
import { STALE_SESSION_THRESHOLD_MS } from '../../core/constants.js';
import { SlopeStoreError } from '../../core/store.js';
import { resolveStore } from '../store.js';

/** Get the sentinel file path for a session (persists across process invocations) */
function sentinelPath(sessionId: string): string {
  const dir = join(tmpdir(), 'slope-guards');
  mkdirSync(dir, { recursive: true });
  // Sanitize sessionId to prevent path traversal
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(dir, `worktree-check-${safe}`);
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
 * Hard-blocks (deny) when a concurrent session exists in the same store
 * without worktree isolation. Auto-registers the current session
 * in the store on first fire to close the detection gap.
 *
 * Sentinel file is only written on pass — denied sessions re-check
 * on subsequent invocations so they can recover once conflicts resolve.
 */
export async function worktreeCheckGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Use stable session ID, or generate one for unidentified sessions
  const sessionId = input.session_id || randomUUID();
  const sentinel = sentinelPath(sessionId);
  // Only fire once per session on pass — denied sessions re-check next time
  if (existsSync(sentinel)) return {};

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
    // Store unavailable — silently pass (no-op). Don't warn on every tool call (#263)
    return {};
  }

  try {
    // Clean stale sessions first to reduce false positives
    await store.cleanStaleSessions(STALE_SESSION_THRESHOLD_MS);

    // Auto-register the current session
    let currentSwarmId: string | undefined;
    let active: Awaited<ReturnType<typeof store.getActiveSessions>> | undefined;
    try {
      const registered = await store.registerSession({
        session_id: sessionId,
        role: 'primary',
        ide: 'claude-code',
        branch,
      });
      currentSwarmId = registered.swarm_id;
    } catch (err) {
      // SESSION_CONFLICT means this session is already registered — that's fine
      if (err instanceof SlopeStoreError && err.code === 'SESSION_CONFLICT') {
        // Fetch active sessions once — reuse for both swarm lookup and conflict check
        active = await store.getActiveSessions();
        const existing = active.find(s => s.session_id === sessionId);
        currentSwarmId = existing?.swarm_id;
      } else {
        throw err;
      }
    }

    // Check for concurrent sessions in the same store (no worktree_path).
    // Swarm members are excluded — they coordinate via claims, not worktrees.
    if (!active) active = await store.getActiveSessions();
    const others = active.filter(s => s.session_id !== sessionId);
    const conflicting = others.filter(s =>
      !s.worktree_path &&
      !(currentSwarmId && s.swarm_id === currentSwarmId),
    );

    if (conflicting.length > 0) {
      const sessionList = conflicting
        .map(s => `  - ${s.session_id} [${s.role}] ${s.ide} (branch: ${s.branch ?? '-'})`)
        .join('\n');
      // Do NOT write sentinel — denied sessions should re-check next invocation
      return {
        decision: 'deny',
        blockReason: `BLOCKED: Another session is active in this directory:\n${sessionList}\n\nYou MUST use \`EnterWorktree\` to create an isolated working copy before proceeding. Do not attempt any other tool calls until you are in a worktree.`,
      };
    }

    // No conflict — write sentinel so we don't re-check this session
    writeFileSync(sentinel, new Date().toISOString());
    return {};
  } catch {
    // Silently pass on error — don't warn on every tool call (#263)
    return {};
  } finally {
    try { store.close(); } catch { /* ignore */ }
  }
}
