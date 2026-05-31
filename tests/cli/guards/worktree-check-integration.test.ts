import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { worktreeCheckGuard, resetWorktreeCheckState } from '../../../src/cli/guards/worktree-check.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';
import type { HookInput } from '../../../src/core/index.js';

let cwd: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeHookInput(sessionId: string, command?: string): HookInput {
  return {
    session_id: sessionId,
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: command ? 'Bash' : 'Edit',
    tool_input: command
      ? { command }
      : { file_path: join(cwd, 'src/foo.ts'), old_string: 'a', new_string: 'b' },
  };
}

async function seedPrimarySession(): Promise<void> {
  const store = new SqliteSlopeStore(join(cwd, '.slope/slope.db'));
  try {
    await store.registerSession({
      session_id: 'orphan-primary',
      role: 'primary',
      ide: 'codex',
      branch: 'main',
    });
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

describe('worktreeCheckGuard SQLite deadlock recovery', () => {
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'slope-worktree-check-'));
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
    resetWorktreeCheckState('candidate-session');
    resetWorktreeCheckState('recovery-session');
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
});
