import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { HookInput, GuardResult } from '../../core/index.js';
import { STALE_SESSION_THRESHOLD_MS } from '../../core/constants.js';
import { SlopeStoreError } from '../../core/store.js';
import { resolveStore } from '../store.js';

const COMMAND_TEXT_KEYS = ['command', 'cmd', 'input'] as const;

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
  if (isWorktreeRecoveryInput(input)) return {};

  // Use a stable ID; hook payloads can omit session_id, and a fresh random
  // value on every invocation makes one session look like many sessions.
  const sessionId = resolveSessionId(input, cwd);
  const sentinel = sentinelPath(sessionId);
  // Only fire once per session on pass — denied sessions re-check next time
  if (existsSync(sentinel)) return {};

  // Check if we're in a worktree: git-common-dir returns '.git' for main repo,
  // or a path like '../../.git' for a worktree
  let gitCommonDir: string;
  try {
    gitCommonDir = gitRevParse(cwd, '--git-common-dir');
  } catch {
    // Not a git repo — allow
    return {};
  }

  // If git-common-dir is not '.git', we're in a worktree (already isolated)
  if (gitCommonDir !== '.git') return {};

  // Get current branch for session registration
  let branch: string;
  try {
    branch = gitRevParse(cwd, '--abbrev-ref', 'HEAD');
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
        blockReason: `BLOCKED: Another session is active in this directory:\n${sessionList}\n\nYou MUST use \`EnterWorktree\` to create an isolated working copy before proceeding. If this harness does not expose EnterWorktree, run \`slope worktree start --branch=<branch> --role=secondary --ide=<ide>\` from the primary checkout. If the listed session is stale, run \`slope session list\` and then \`slope session end --session-id=<id>\`. Do not attempt implementation work until you are in a worktree.`,
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

function isWorktreeRecoveryInput(input: HookInput): boolean {
  if (input.tool_name === 'EnterWorktree') return true;

  const command = extractCommandText(input);
  if (command === 'EnterWorktree') return true;
  const segments = splitShellSegments(command);
  if (segments.length !== 1) return false;

  const words = tokenizeShellWords(segments[0]);
  return isGitWorktreeAdd(words) || isSlopeRecoveryCommand(words);
}

function isGitWorktreeAdd(words: string[]): boolean {
  const start = skipCommandPrefix(words, 0);
  if (words[start] !== 'git') return false;

  if (words[start + 1] === 'worktree' && words[start + 2] === 'add') return true;
  return words[start + 1] === '-C'
    && !!words[start + 2]
    && words[start + 3] === 'worktree'
    && words[start + 4] === 'add';
}

function isSlopeRecoveryCommand(words: string[]): boolean {
  const slopeIndex = findSlopeExecutableIndex(words);
  if (slopeIndex < 0) return false;

  const args = words.slice(slopeIndex + 1);
  if (args[0] === 'worktree' && args[1] === 'start') return true;
  if (args[0] !== 'session') return false;

  return args[1] === 'end'
    || args[1] === 'list'
    || args[1] === 'prune'
    || args[1] === 'dashboard';
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      current += char;
      if (i + 1 < command.length) current += command[++i];
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (!quote && (char === ';' || char === '\n' || (char === '&' && command[i + 1] === '&') || (char === '|' && command[i + 1] === '|'))) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if (char === '&' || char === '|') i++;
      continue;
    }
    current += char;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function tokenizeShellWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    if (char === '\\' && quote !== "'") {
      if (i + 1 < segment.length) current += segment[++i];
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) words.push(current);
  return words;
}

function findSlopeExecutableIndex(words: string[]): number {
  const i = skipCommandPrefix(words, 0);

  if (words[i] === 'slope') return i;
  if ((words[i] === 'npx' || words[i] === 'bunx') && words[i + 1] === 'slope') return i + 1;
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(words[i])) {
    if (words[i + 1] === 'exec' && words[i + 2] === 'slope') return i + 2;
    if (words[i + 1] === 'slope') return i + 1;
  }

  return -1;
}

function skipCommandPrefix(words: string[], start: number): number {
  let i = start;
  if (words[i] === 'env') i++;
  while (isEnvAssignment(words[i])) i++;
  if (words[i] === 'command') i++;
  return i;
}

function isEnvAssignment(word: string | undefined): boolean {
  return !!word && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function gitRevParse(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['rev-parse', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function resolveSessionId(input: HookInput, cwd: string): string {
  const explicit = typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (explicit) return explicit;

  const source = typeof input.transcript_path === 'string' && input.transcript_path.trim()
    ? `transcript:${input.transcript_path.trim()}`
    : `cwd:${cwd}`;
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return `anonymous-${digest}`;
}

function extractCommandText(input: HookInput): string {
  const toolInput = input.tool_input ?? {};
  for (const key of COMMAND_TEXT_KEYS) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
