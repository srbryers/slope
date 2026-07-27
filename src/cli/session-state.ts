import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveRepoStatePath } from '../core/index.js';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';
import { isActiveSprintState, loadSprintState } from './sprint-state.js';

const SESSION_STATE_FILE = '.slope/.session-state.json';

export type SessionMode = 'sprint' | 'adhoc';

interface SessionState {
  /** Session ID for the briefing guard */
  briefing_session_id?: string;
  /** Session ID for the post-push guard (legacy — kept for backward compat) */
  push_prompted_session_id?: string;
  /** Number of pushes in current session (stored as string) */
  push_count?: string;
  /** Last push command string (dedup repeated retries) */
  last_push_command?: string;
  /** Session ID for the claim-required guard */
  claim_warned_session_id?: string;
  /** Session ID for handoff read in explore guard */
  handoff_read_session_id?: string;
  /** Current session mode — adhoc skips sprint-workflow guards */
  session_mode?: SessionMode;
  /** Session ID that set the mode (mode expires when session changes) */
  session_mode_id?: string;
}

/** Load consolidated session state. Returns empty object if missing/corrupt. */
export function loadSessionState(cwd: string): SessionState {
  const statePath = sessionStatePath(cwd);
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
}

function sessionStatePath(cwd: string): string {
  return resolveRepoStatePath(cwd, SESSION_STATE_FILE);
}

function saveSessionStateUnlocked(filePath: string, state: SessionState): void {
  atomicWriteFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

function mutateSessionState(cwd: string, mutator: (state: SessionState) => boolean): SessionState {
  const filePath = sessionStatePath(cwd);
  return withFileLockSync(filePath, () => {
    const state = loadSessionState(cwd);
    if (mutator(state)) {
      saveSessionStateUnlocked(filePath, state);
    }
    return state;
  });
}

/** Save consolidated session state atomically via unique tmp + rename. */
export function saveSessionState(cwd: string, state: SessionState): void {
  const filePath = sessionStatePath(cwd);
  withFileLockSync(filePath, () => saveSessionStateUnlocked(filePath, state));
}

/** Update a single field in session state and save atomically. */
export function updateSessionState(cwd: string, field: keyof SessionState, value: string): void {
  mutateSessionState(cwd, state => {
    (state as Record<string, unknown>)[field] = value;
    return true;
  });
}

/** Set the session mode (adhoc or sprint) for a given session. */
export function setSessionMode(cwd: string, sessionId: string, mode: SessionMode): void {
  mutateSessionState(cwd, state => {
    state.session_mode = mode;
    state.session_mode_id = sessionId;
    return true;
  });
}

/** Check if the current session is in adhoc mode.
 *  Returns true if mode is explicitly 'adhoc' for this session.
 *  Returns false if mode is 'sprint', unset, or set by a different session. */
export function isAdhocSession(cwd: string, sessionId: string): boolean {
  if (!sessionId) return false;
  const mode = syncSessionModeWithSprintState(cwd, sessionId);
  return mode === 'adhoc';
}

/** Keep pinned session mode aligned with live sprint-state.
 *  If a sprint starts after a session was pinned adhoc, promote the session
 *  back to sprint mode so sprint-workflow guards do not stay suppressed. */
export function syncSessionModeWithSprintState(cwd: string, sessionId: string): SessionMode | null {
  if (!sessionId) return null;
  const sprintState = loadSprintState(cwd);

  if (isActiveSprintState(sprintState)) {
    mutateSessionState(cwd, state => {
      if (state.session_mode === 'sprint' && state.session_mode_id === sessionId) {
        return false;
      }
      state.session_mode = 'sprint';
      state.session_mode_id = sessionId;
      return true;
    });
    return 'sprint';
  }

  const state = loadSessionState(cwd);
  if (state.session_mode_id !== sessionId) return null;
  return state.session_mode ?? null;
}

// ── Context dedup ───────────────────────────────────

/** File for context dedup hashes (separate from session-state for performance) */
const CONTEXT_DEDUP_FILE = '.slope/.context-dedup.json';

/** Default token budget: ~4k tokens worth of context chars (chars ≈ tokens × 4) */
const DEFAULT_CONTEXT_BUDGET_CHARS = 16000;

interface ContextDedupState {
  session_id: string;
  /** Map of content hash → { guard, count, timestamp } */
  seen: Record<string, { guard: string; count: number; ts: number }>;
  /** Cumulative chars of context injected this session */
  total_chars: number;
}

function loadDedupState(cwd: string): ContextDedupState | null {
  const path = dedupStatePath(cwd);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function dedupStatePath(cwd: string): string {
  return resolveRepoStatePath(cwd, CONTEXT_DEDUP_FILE);
}

function saveDedupStateUnlocked(filePath: string, state: ContextDedupState): void {
  atomicWriteFileSync(filePath, JSON.stringify(state) + '\n');
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Check if context has already been injected this session.
 * Returns null if new (caller should inject full context).
 * Returns a compressed reference string if duplicate.
 */
export function dedupGuardContext(
  cwd: string,
  sessionId: string,
  guardName: string,
  context: string,
): string | null {
  if (!sessionId || !context) return null;

  const hash = hashContent(context);
  const filePath = dedupStatePath(cwd);

  return withFileLockSync(filePath, () => {
    let state = loadDedupState(cwd);

    // Reset if session changed
    if (!state || state.session_id !== sessionId) {
      state = { session_id: sessionId, seen: {}, total_chars: 0 };
    }

    // Prune entries older than 24 hours (prevents unbounded growth across long sessions)
    const DEDUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [h, entry] of Object.entries(state.seen)) {
      if (entry.ts && (now - entry.ts) > DEDUP_MAX_AGE_MS) {
        delete state.seen[h];
      }
    }

    const existing = state.seen[hash];
    if (existing) {
      // Already injected — return compressed reference
      existing.count++;
      existing.ts = now;
      saveDedupStateUnlocked(filePath, state);
      return `SLOPE ${guardName}: (same as prior warning, shown ${existing.count}x)`;
    }

    // Budget exhausted: stay silent. This previously substituted a note about the
    // budget itself, which every guard then repeated on every fire — spending
    // context to announce that there is no context left, naming no file and no
    // action. A guard with nothing useful left to say should say nothing (GH #651).
    const budget = DEFAULT_CONTEXT_BUDGET_CHARS;
    if ((state.total_chars ?? 0) + context.length > budget) {
      saveDedupStateUnlocked(filePath, state);
      return '';
    }

    // New content — track chars and record
    state.total_chars = (state.total_chars ?? 0) + context.length;
    state.seen[hash] = { guard: guardName, count: 1, ts: now };
    saveDedupStateUnlocked(filePath, state);
    return null;
  });
}
