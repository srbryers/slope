import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { HookInput, GuardResult } from '../../core/index.js';
import { STALE_SESSION_THRESHOLD_MS } from '../../core/constants.js';
import { SlopeStoreError } from '../../core/store.js';
import type { SlopeSession } from '../../core/store.js';
import { resolveStore } from '../store.js';
import { resolveSessionStoreCwd } from '../session-scope.js';

const COMMAND_TEXT_KEYS = ['command', 'cmd', 'input'] as const;
const FILE_PATH_KEYS = ['file_path', 'path'] as const;

interface GitWorktreeInfo {
  path: string;
  branch?: string;
}

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
  if (isRemoteOrReadOnlyCommandInput(input)) return {};

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
  if (gitCommonDir !== '.git') {
    await reconcileWorktreeSession(input, cwd, sessionId);
    return {};
  }

  // Get current branch for session registration
  let branch: string;
  try {
    branch = gitRevParse(cwd, '--abbrev-ref', 'HEAD');
  } catch {
    branch = 'unknown';
  }

  // Query store for concurrent sessions. gitCommonDir === '.git' above already
  // establishes that cwd is the primary checkout, so this is the repo-scoped
  // session store that `slope session list|prune|end` now also resolves to via
  // resolveSessionStoreCwd — the two agree, so the printed remediation can
  // actually clear what the guard blocks on (GH #630, #631).
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

    // Inspect existing sessions BEFORE registering. Registering first meant a
    // session that was about to be denied still got written as
    // `role: primary` on the launch-dir branch, leaving a phantom primary that
    // could then block the legitimate primary session (GH #631).
    let active = await store.getActiveSessions();
    const existing = active.find(s => s.session_id === sessionId);
    const currentSwarmId = existing?.swarm_id;

    // An already-registered worktree session is isolated by definition, even
    // when the hook payload still reports the launch directory (GH #630, #631).
    if (existing?.worktree_path) {
      writeFileSync(sentinel, new Date().toISOString());
      return {};
    }

    // Check for concurrent sessions in the same store (no worktree_path).
    // Swarm members are excluded — they coordinate via claims, not worktrees.
    const others = active.filter(s => s.session_id !== sessionId);
    const now = Date.now();
    const conflicting = others.filter(s =>
      !isStaleSession(s, now) &&
      !s.worktree_path &&
      !(currentSwarmId && s.swarm_id === currentSwarmId),
    );

    if (conflicting.length > 0) {
      // The hook payload's cwd is the session's *launch* directory. A session
      // moved into a worktree (WorktreeCreate at launch, or EnterWorktree
      // mid-session) keeps reporting the launch dir, so the git-common-dir check
      // above misses it and the session gets judged against the primary
      // checkout's sessions. That was a permanent deadlock whose printed
      // remediation could not help: there is nothing left to enter, and the
      // session is already isolated. Trust where the work actually lands
      // (GH #630, #631). Checked here rather than earlier so the common pass
      // path spawns no extra git processes.
      const worktrees = listGitWorktreeInfo(cwd);
      const targetWorktree = resolveTargetWorktree(input, cwd, worktrees);
      if (targetWorktree) {
        await reconcileWorktreeSession(input, cwd, sessionId, targetWorktree);
        writeFileSync(sentinel, new Date().toISOString());
        return {};
      }

      const sessionList = conflicting
        .map(s => `  - ${s.session_id} [${s.role}] ${s.ide} (branch: ${s.branch ?? '-'})`)
        .join('\n');
      const existingWorktreeGuidance = formatExistingWorktreeGuidance(cwd, input, conflicting, branch, worktrees);
      // Do NOT write sentinel — denied sessions should re-check next invocation
      return {
        decision: 'deny',
        blockReason: `BLOCKED: Another session is active in this directory:\n${sessionList}${existingWorktreeGuidance}\n\nCreate an isolated working copy before proceeding:\n  slope worktree start --branch=<branch> --role=secondary --ide=<ide>\n\nSLOPE worktrees default to .slope/worktrees/<branch>, outside Claude Code's protected .claude/ tree. Avoid Claude Code's native .claude/worktrees/ default because ordinary source edits there can trigger self-configuration permission prompts. If the listed session is stale, run \`slope session list\`, then \`slope session prune\` or \`slope session end --session-id=<id>\`. Do not attempt implementation work until you are in a worktree.`,
      };
    }

    // No conflict — register this session so the next one can see it, then
    // write the sentinel so we don't re-check.
    if (!existing) {
      try {
        await store.registerSession({
          session_id: sessionId,
          role: 'primary',
          ide: 'claude-code',
          branch,
        });
      } catch (err) {
        // Already registered by a concurrent invocation — harmless.
        if (!(err instanceof SlopeStoreError && err.code === 'SESSION_CONFLICT')) throw err;
      }
    }
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

function isRemoteOrReadOnlyCommandInput(input: HookInput): boolean {
  if (input.tool_name !== 'Bash') return false;

  const command = extractCommandText(input);
  const segments = splitShellSegments(command);
  if (segments.length !== 1) return false;

  const words = tokenizeShellWords(segments[0]);
  const start = skipCommandPrefix(words, 0);
  if (words[start] === 'gh') return isAllowedGhCommand(words.slice(start + 1));
  if (words[start] === 'git') return isAllowedGitCommand(normalizeGitArgs(words.slice(start + 1)));
  return false;
}

function isAllowedGhCommand(args: string[]): boolean {
  if (args[0] === 'pr') {
    return ['view', 'checks', 'status', 'list', 'merge'].includes(args[1] ?? '');
  }
  return false;
}

function isAllowedGitCommand(args: string[]): boolean {
  const sub = args[0];
  if (['status', 'log', 'diff', 'show', 'rev-parse', 'fetch', 'ls-remote'].includes(sub ?? '')) {
    return true;
  }
  if (sub === 'branch') {
    return args.length === 1
      || args.length === 2 && ['--show-current', '-v', '-vv'].includes(args[1] ?? '');
  }
  if (sub === 'remote') {
    return args.length === 1
      || args.length === 2 && ['-v', '--verbose'].includes(args[1] ?? '')
      || ['get-url', 'show'].includes(args[1] ?? '');
  }
  return false;
}

function normalizeGitArgs(args: string[]): string[] {
  const normalized = [...args];
  for (let i = 0; i < normalized.length;) {
    const arg = normalized[i];
    if (arg === '-C' || arg === '-c') {
      normalized.splice(i, 2);
      continue;
    }
    if (arg?.startsWith('--git-dir=') || arg?.startsWith('--work-tree=')) {
      normalized.splice(i, 1);
      continue;
    }
    break;
  }
  return normalized;
}

function isStaleSession(session: SlopeSession, now: number): boolean {
  const heartbeat = Date.parse(session.last_heartbeat_at);
  return Number.isFinite(heartbeat) && now - heartbeat > STALE_SESSION_THRESHOLD_MS;
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

  // `start` and `heartbeat` must be exempt: registering is the one action that
  // lets a legitimately isolated session prove itself, so denying it makes the
  // block permanent (GH #631).
  return args[1] === 'end'
    || args[1] === 'list'
    || args[1] === 'prune'
    || args[1] === 'dashboard'
    || args[1] === 'start'
    || args[1] === 'heartbeat';
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
    if (!quote && char === '&' && command[i - 1] === '>') {
      current += char;
      continue;
    }
    if (!quote && (char === ';' || char === '\n' || char === '&' || char === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if ((char === '&' && command[i + 1] === '&') || (char === '|' && command[i + 1] === '|')) i++;
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

function formatExistingWorktreeGuidance(
  cwd: string,
  input: HookInput,
  conflicting: SlopeSession[],
  currentBranch: string,
  allWorktrees: GitWorktreeInfo[],
): string {
  const worktrees = allWorktrees.filter(wt => resolve(wt.path) !== resolve(cwd));
  if (worktrees.length === 0) return '';

  const filePath = extractFilePath(input);
  const branchHints = new Set(
    [currentBranch, ...conflicting.map(s => s.branch)]
      .filter((branch): branch is string => !!branch && branch !== 'unknown' && branch !== '-'),
  );

  const matched = worktrees.filter(wt =>
    (filePath && pathContains(wt.path, filePath))
    || (wt.branch && branchHints.has(wt.branch)),
  );
  const suggested = matched.length > 0 ? matched : worktrees.slice(0, 3);
  const heading = matched.length > 0
    ? 'Existing matching worktree detected:'
    : 'Existing git worktree(s) detected:';
  const lines = suggested.map(wt => {
    const branch = wt.branch ? ` (branch: ${wt.branch})` : '';
    return `  - ${wt.path}${branch}`;
  });
  const firstPath = suggested[0]?.path ?? '<path>';

  return [
    '',
    '',
    heading,
    ...lines,
    '',
    'Prefer entering the existing worktree instead of creating another one:',
    `  Claude Code/Codex: use the EnterWorktree tool with path: ${firstPath}`,
    `  Other harnesses: cd "${firstPath}" and relaunch the session there.`,
    'SLOPE will re-evaluate the session branch and mode after entering the worktree.',
  ].join('\n');
}

function extractFilePath(input: HookInput): string | undefined {
  const toolInput = input.tool_input ?? {};
  for (const key of FILE_PATH_KEYS) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pathContains(root: string, filePath: string): boolean {
  const absoluteFile = isAbsolute(filePath) ? filePath : resolve(filePath);
  const absoluteRoot = resolve(root);
  const rel = relative(absoluteRoot, absoluteFile);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolve the worktree that a tool call's target path belongs to, if any.
 *
 * Only called from the primary-checkout branch, so `cwd` is the primary checkout
 * and is excluded: an edit landing in the primary checkout is not isolated and
 * must still be denied so the #499 "enter the existing worktree" guidance fires.
 * A relative path is likewise not evidence — it resolves against the launch dir,
 * which is exactly the value we cannot trust here (GH #630, #631).
 */
function resolveTargetWorktree(
  input: HookInput,
  cwd: string,
  worktrees: GitWorktreeInfo[],
): string | null {
  const filePath = extractFilePath(input);
  if (!filePath || !isAbsolute(filePath)) return null;

  for (const worktree of worktrees) {
    if (resolve(worktree.path) === resolve(cwd)) continue;
    if (pathContains(worktree.path, filePath)) return worktree.path;
  }
  return null;
}

async function reconcileWorktreeSession(
  input: HookInput,
  cwd: string,
  sessionId: string,
  explicitWorktreePath?: string,
): Promise<void> {
  let store;
  try {
    const stateCwd = resolveSessionStoreCwd(cwd);
    store = await resolveStore(stateCwd);

    const worktreePath = explicitWorktreePath ?? gitRevParse(cwd, '--show-toplevel');
    const branchCwd = explicitWorktreePath ?? cwd;
    const branch = safeGitRevParse(branchCwd, '--abbrev-ref', 'HEAD') ?? 'unknown';

    try {
      await store.updateSession(sessionId, {
        role: 'secondary',
        branch,
        worktree_path: worktreePath,
      });
    } catch (err) {
      if (err instanceof SlopeStoreError && err.code === 'NOT_FOUND') {
        await store.registerSession({
          session_id: sessionId,
          role: 'secondary',
          ide: resolveIde(input),
          branch,
          worktree_path: worktreePath,
        });
      } else {
        throw err;
      }
    }
  } catch {
    // Worktree sessions are already isolated; reconciliation is best-effort.
  } finally {
    try { store?.close(); } catch { /* ignore */ }
  }
}

function listGitWorktreeInfo(cwd: string): GitWorktreeInfo[] {
  try {
    const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const worktrees: GitWorktreeInfo[] = [];
    let current: GitWorktreeInfo | null = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice('worktree '.length).trim() };
      } else if (current && line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim();
      } else if (line === '' && current) {
        worktrees.push(current);
        current = null;
      }
    }
    if (current) worktrees.push(current);
    return worktrees.filter(wt => wt.path);
  } catch {
    return [];
  }
}

function safeGitRevParse(cwd: string, ...args: string[]): string | undefined {
  try {
    return gitRevParse(cwd, ...args);
  } catch {
    return undefined;
  }
}

function resolveIde(input: HookInput): string {
  const metadata = input.tool_input ?? {};
  for (const key of ['ide', 'agent', 'harness']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return process.env.SLOPE_IDE || 'unknown';
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
