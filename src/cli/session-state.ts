import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

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
