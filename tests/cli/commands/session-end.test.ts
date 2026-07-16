import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionCommand } from '../../../src/cli/commands/session.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';

let tmpDir: string;
let logs: string[];
let errors: string[];
let savedEnvSession: string | undefined;

async function registerSession(id: string, extras: { worktree_path?: string; branch?: string } = {}): Promise<void> {
  const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
  try {
    await store.registerSession({ session_id: id, role: 'primary', ide: 'test', ...extras });
  } finally {
    store.close();
  }
}

async function activeSessionIds(): Promise<string[]> {
  const store = new SqliteSlopeStore(join(tmpDir, '.slope', 'slope.db'));
  try {
    return (await store.getActiveSessions()).map(session => session.session_id);
  } finally {
    store.close();
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-session-end-'));
  vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ store_path: '.slope/slope.db' }));
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.map(String).join(' ')); });
  savedEnvSession = process.env.SLOPE_SESSION_ID;
  delete process.env.SLOPE_SESSION_ID;
});

afterEach(() => {
  if (savedEnvSession === undefined) delete process.env.SLOPE_SESSION_ID;
  else process.env.SLOPE_SESSION_ID = savedEnvSession;
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope session end defaults (#620)', () => {
  it('defaults to the single active session when --session-id is omitted', async () => {
    await registerSession('only-session');

    await sessionCommand(['end']);

    expect(logs.join('\n')).toContain('Defaulting to the single active session: only-session');
    expect(logs.join('\n')).toContain('Session ended: only-session');
    expect(await activeSessionIds()).toEqual([]);
  });

  it('prefers SLOPE_SESSION_ID over the single-active default', async () => {
    await registerSession('env-session');
    await registerSession('other-session');
    process.env.SLOPE_SESSION_ID = 'env-session';

    await sessionCommand(['end']);

    expect(logs.join('\n')).toContain('Session ended: env-session');
    expect(await activeSessionIds()).toEqual(['other-session']);
  });

  it('ignores a stale SLOPE_SESSION_ID and still defaults to the single active session', async () => {
    await registerSession('real-session');
    process.env.SLOPE_SESSION_ID = 'gone-session';

    await sessionCommand(['end']);

    expect(logs.join('\n')).toContain('Defaulting to the single active session: real-session');
    expect(await activeSessionIds()).toEqual([]);
  });

  it('errors with the session list when several sessions are active', async () => {
    await registerSession('session-a');
    await registerSession('session-b');
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(sessionCommand(['end'])).rejects.toThrow('process.exit(1)');

    expect(errors.join('\n')).toContain('2 sessions are active');
    expect(errors.join('\n')).toContain('session-a');
    expect(errors.join('\n')).toContain('session-b');
    expect(await activeSessionIds()).toHaveLength(2);
  });

  it('keeps the installed hook shape failing when --session-id is empty', async () => {
    await registerSession('teammate-session');
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(sessionCommand(['end', '--session-id='])).rejects.toThrow('process.exit(1)');

    expect(errors.join('\n')).toContain('provided but empty');
    expect(await activeSessionIds()).toEqual(['teammate-session']);
  });

  it('refuses the default when the single active session belongs to another worktree', async () => {
    await registerSession('other-worktree-session', { worktree_path: join(tmpdir(), 'somewhere-else-entirely') });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(sessionCommand(['end'])).rejects.toThrow('process.exit(1)');

    expect(errors.join('\n')).toContain('different worktree or branch');
    expect(await activeSessionIds()).toEqual(['other-worktree-session']);
  });

  it('errors clearly when no sessions are active', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(sessionCommand(['end'])).rejects.toThrow('process.exit(1)');

    expect(errors.join('\n')).toContain('no active sessions to end');
  });
});
