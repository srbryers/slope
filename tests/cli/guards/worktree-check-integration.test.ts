import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { worktreeCheckGuard, resetWorktreeCheckState } from '../../../src/cli/guards/worktree-check.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';
import type { HookInput } from '../../../src/core/index.js';

let cwd: string;
let extraDirs: string[];

const SESSION_IDS = [
  'candidate-session',
  'recovery-session',
  'worktree-session',
] as const;

function resetSentinels(): void {
  for (const id of SESSION_IDS) resetWorktreeCheckState(id);
}

function git(args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeHookInput(sessionId: string, command?: string, inputCwd = cwd): HookInput {
  return {
    session_id: sessionId,
    cwd: inputCwd,
    hook_event_name: 'PreToolUse',
    tool_name: command ? 'Bash' : 'Edit',
    tool_input: command
      ? { command }
      : { file_path: join(inputCwd, 'src/foo.ts'), old_string: 'a', new_string: 'b' },
  };
}

async function seedPrimarySession(): Promise<void> {
  await registerSession('orphan-primary', 'primary', 'main');
}

async function registerSession(
  sessionId: string,
  role: 'primary' | 'secondary',
  branch: string,
): Promise<void> {
  const store = new SqliteSlopeStore(join(cwd, '.slope/slope.db'));
  try {
    await store.registerSession({ session_id: sessionId, role, ide: 'codex', branch });
  } finally {
    store.close();
  }
}

async function listSessionIds(): Promise<string[]> {
  const store = new SqliteSlopeStore(join(cwd, '.slope/slope.db'));
  try {
    const sessions = await store.getActiveSessions();
    return sessions.map(s => s.session_id);
  } finally {
    store.close();
  }
}

async function getSession(sessionId: string) {
  const store = new SqliteSlopeStore(join(cwd, '.slope/slope.db'));
  try {
    const sessions = await store.getActiveSessions();
    return sessions.find(s => s.session_id === sessionId);
  } finally {
    store.close();
  }
}

async function claimForSession(sessionId: string): Promise<void> {
  const store = new SqliteSlopeStore(join(cwd, '.slope/slope.db'));
  try {
    await store.claim({
      session_id: sessionId,
      sprint_number: 129,
      player: 'agent',
      target: 'S129-3',
      scope: 'ticket',
    });
  } finally {
    store.close();
  }
}

async function listClaims(): Promise<unknown[]> {
  const store = new SqliteSlopeStore(join(cwd, '.slope/slope.db'));
  try {
    return await store.getActiveClaims(129);
  } finally {
    store.close();
  }
}

describe('worktreeCheckGuard SQLite deadlock recovery', () => {
  beforeEach(() => {
    // The pass-sentinel lives in the real tmpdir and outlives the process, so a
    // leftover from an earlier run would short-circuit the guard before it can
    // reconcile. Reset on entry as well as exit.
    resetSentinels();
    cwd = mkdtempSync(join(tmpdir(), 'slope-worktree-check-'));
    extraDirs = [];
    git(['init', '-q']);
    git(['checkout', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test User']);
    git(['commit', '--allow-empty', '-m', 'init']);

    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(join(cwd, '.slope/config.json'), JSON.stringify({
      store: 'sqlite',
      store_path: '.slope/slope.db',
    }));
  });

  afterEach(() => {
    resetSentinels();
    for (const dir of extraDirs) rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reproduces a recent orphaned primary session blocking a new main-checkout session', async () => {
    await seedPrimarySession();

    const result = await worktreeCheckGuard(makeHookInput('candidate-session'), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('orphan-primary');
    expect(result.blockReason).toContain('slope session end --session-id=<id>');
  });

  it('allows slope worktree recovery commands before opening the SQLite store', async () => {
    await seedPrimarySession();

    const result = await worktreeCheckGuard(
      makeHookInput('recovery-session', 'slope worktree start --branch=fix/deadlock --role=secondary --ide=codex'),
      cwd,
    );

    expect(result).toEqual({});
    expect(await listSessionIds()).toEqual(['orphan-primary']);
  });

  it('allows a session whose edit lands in a worktree even when the payload reports the launch dir (GH #630, #631)', async () => {
    await seedPrimarySession();

    const worktreePath = join(tmpdir(), `slope-worktree-launchdir-${basename(cwd)}`);
    extraDirs.push(worktreePath);
    git(['worktree', 'add', '-q', worktreePath, '-b', 'launchdir-worktree']);

    // Claude Code keeps reporting the launch directory after WorktreeCreate /
    // EnterWorktree, so cwd is the primary checkout while the edit target is
    // inside the worktree. This used to deadlock: denied on the primary
    // checkout's sessions, with no remediation able to clear them.
    const input: HookInput = {
      session_id: 'worktree-session',
      cwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(worktreePath, 'src/foo.ts'), old_string: 'a', new_string: 'b' },
    };

    const result = await worktreeCheckGuard(input, cwd);

    expect(result).toEqual({});
    const reconciled = await getSession('worktree-session');
    expect(reconciled?.role).toBe('secondary');
    expect(reconciled?.worktree_path ? realpathSync(reconciled.worktree_path) : '')
      .toBe(realpathSync(worktreePath));
  });

  it('still denies an edit that lands in the primary checkout while a worktree exists', async () => {
    await seedPrimarySession();

    const worktreePath = join(tmpdir(), `slope-worktree-primaryedit-${basename(cwd)}`);
    extraDirs.push(worktreePath);
    git(['worktree', 'add', '-q', worktreePath, '-b', 'primaryedit-worktree']);

    const result = await worktreeCheckGuard(makeHookInput('candidate-session'), cwd);

    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('EnterWorktree');
  });

  it('does not register a denied session as a phantom primary (GH #631)', async () => {
    await seedPrimarySession();

    const result = await worktreeCheckGuard(makeHookInput('candidate-session'), cwd);

    expect(result.decision).toBe('deny');
    // A denied session used to be written as role:primary on the launch-dir
    // branch before the conflict check ran, leaving a phantom that could then
    // block the legitimate primary session.
    expect(await listSessionIds()).toEqual(['orphan-primary']);
  });

  it('reconciles a denied main-checkout session after it enters a git worktree', async () => {
    await seedPrimarySession();
    const denied = await worktreeCheckGuard(makeHookInput('candidate-session'), cwd);
    expect(denied.decision).toBe('deny');
    // The guard no longer auto-registers a denied session, so register the way a
    // real recovery does (`slope session start`) before claiming work.
    await registerSession('candidate-session', 'primary', 'main');
    await claimForSession('candidate-session');

    const worktreePath = join(tmpdir(), `slope-worktree-child-${basename(cwd)}`);
    extraDirs.push(worktreePath);
    git(['worktree', 'add', '-q', worktreePath, '-b', 'candidate-worktree']);

    const result = await worktreeCheckGuard(makeHookInput('candidate-session', undefined, worktreePath), worktreePath);

    expect(result).toEqual({});
    const reconciled = await getSession('candidate-session');
    expect(reconciled?.role).toBe('secondary');
    expect(reconciled?.branch).toBe('candidate-worktree');
    expect(reconciled?.worktree_path ? realpathSync(reconciled.worktree_path) : '').toBe(realpathSync(worktreePath));
    expect(await listClaims()).toHaveLength(1);
  });
});
