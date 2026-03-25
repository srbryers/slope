import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SESSION_STATE_FILE = '.slope/.session-state.json';

export type SessionMode = 'sprint' | 'adhoc';

interface SessionState {
  /** Session ID for the briefing guard */
  briefing_session_id?: string;
  /** Session ID for the post-push guard */
  push_prompted_session_id?: string;
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
  const statePath = join(cwd, SESSION_STATE_FILE);
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
}

/** Save consolidated session state atomically via tmp + rename. */
export function saveSessionState(cwd: string, state: SessionState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });

  const filePath = join(cwd, SESSION_STATE_FILE);
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmpPath, filePath);
}

/** Update a single field in session state and save atomically. */
export function updateSessionState(cwd: string, field: keyof SessionState, value: string): void {
  const state = loadSessionState(cwd);
  (state as Record<string, unknown>)[field] = value;
  saveSessionState(cwd, state);
}

/** Set the session mode (adhoc or sprint) for a given session. */
export function setSessionMode(cwd: string, sessionId: string, mode: SessionMode): void {
  const state = loadSessionState(cwd);
  state.session_mode = mode;
  state.session_mode_id = sessionId;
  saveSessionState(cwd, state);
}

/** Check if the current session is in adhoc mode.
 *  Returns true if mode is explicitly 'adhoc' for this session.
 *  Returns false if mode is 'sprint', unset, or set by a different session. */
export function isAdhocSession(cwd: string, sessionId: string): boolean {
  if (!sessionId) return false;
  const state = loadSessionState(cwd);
  return state.session_mode === 'adhoc' && state.session_mode_id === sessionId;
}

// ── Context dedup ───────────────────────────────────

/** File for context dedup hashes (separate from session-state for performance) */
const CONTEXT_DEDUP_FILE = '.slope/.context-dedup.json';

interface ContextDedupState {
  session_id: string;
  /** Map of content hash → { guard, count, timestamp } */
  seen: Record<string, { guard: string; count: number; ts: number }>;
}

function loadDedupState(cwd: string): ContextDedupState | null {
  const path = join(cwd, CONTEXT_DEDUP_FILE);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function saveDedupState(cwd: string, state: ContextDedupState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  const filePath = join(cwd, CONTEXT_DEDUP_FILE);
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(state) + '\n');
  renameSync(tmpPath, filePath);
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
  let state = loadDedupState(cwd);

  // Reset if session changed
  if (!state || state.session_id !== sessionId) {
    state = { session_id: sessionId, seen: {} };
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
    saveDedupState(cwd, state);
    return `SLOPE ${guardName}: (same as prior warning, shown ${existing.count}x)`;
  }

  // New content — record and return null (caller injects full)
  state.seen[hash] = { guard: guardName, count: 1, ts: now };
  saveDedupState(cwd, state);
  return null;
}
