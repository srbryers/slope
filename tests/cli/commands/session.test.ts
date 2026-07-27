import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionCommand } from '../../../src/cli/commands/session.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';

let tmpDir: string;
let originalCwd: string;
const linkedWorktrees: string[] = [];

function setupProject(dir: string): void {
  mkdirSync(join(dir, '.slope'), { recursive: true });
  writeFileSync(join(dir, '.slope/config.json'), JSON.stringify({
    store: 'sqlite',
    store_path: '.slope/slope.db',
  }));
}

function createStore(): SqliteSlopeStore {
  return new SqliteSlopeStore(join(tmpDir, '.slope/slope.db'));
}

describe('slope session command', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-session-command-'));
    setupProject(tmpDir);
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const worktree of linkedWorktrees.splice(0)) {
      rmSync(worktree, { recursive: true, force: true });
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints prune in session help', async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sessionCommand([]);

    log.mockRestore();
    expect(logs.join('\n')).toContain('slope session prune');
  });

  it('prints nested start help without registering a session (#501)', async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sessionCommand(['start', '--help']);

    log.mockRestore();
    expect(logs.join('\n')).toContain('slope session start');

    const after = createStore();
    try {
      expect(await after.getActiveSessions()).toHaveLength(0);
    } finally {
      after.close();
    }
  });

  it('prints nested prune help without pruning stale sessions (#501)', async () => {
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'stale-help-session',
        role: 'primary',
        ide: 'codex',
        branch: 'main',
      });
    } finally {
      store.close();
    }

    await new Promise(resolve => setTimeout(resolve, 20));

    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sessionCommand(['prune', '--max-age-ms=1', '--help']);

    log.mockRestore();
    expect(logs.join('\n')).toContain('slope session prune');

    const after = createStore();
    try {
      expect(await after.getActiveSessions()).toHaveLength(1);
    } finally {
      after.close();
    }
  });

  it('prunes stale sessions and their claims with a custom max age', async () => {
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'stale-session',
        role: 'primary',
        ide: 'codex',
        branch: 'main',
      });
      await store.claim({
        session_id: 'stale-session',
        sprint_number: 129,
        player: 'agent',
        target: 'S129-4',
        scope: 'ticket',
      });
    } finally {
      store.close();
    }

    await new Promise(resolve => setTimeout(resolve, 20));

    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sessionCommand(['prune', '--max-age-ms=1']);

    log.mockRestore();
    expect(logs.join('\n')).toContain('Removed: 1 session');

    const after = createStore();
    try {
      expect(await after.getActiveSessions()).toHaveLength(0);
      expect(await after.getActiveClaims()).toHaveLength(0);
    } finally {
      after.close();
    }
  });

  it('refreshes the stored branch when heartbeat runs after checkout', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'branch-session',
        role: 'primary',
        ide: 'codex',
        branch: 'main',
      });
    } finally {
      store.close();
    }
    execFileSync('git', ['checkout', '-q', '-b', 'feature/current'], { cwd: tmpDir });

    await sessionCommand(['heartbeat', '--session-id=branch-session']);

    const after = createStore();
    try {
      expect((await after.getActiveSessions())[0].branch).toBe('feature/current');
    } finally {
      after.close();
    }
  });

  it('rejects the primary checkout as an explicit worktree path', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sessionCommand([
      'start',
      '--session-id=primary-as-worktree',
      `--worktree-path=${tmpDir}`,
    ])).rejects.toThrow('process.exit(1)');

    expect(error).toHaveBeenCalledWith(
      'Error: --worktree-path must identify the current non-primary linked worktree.',
    );
    error.mockRestore();
    exit.mockRestore();
    const after = createStore();
    try {
      expect(await after.getActiveSessions()).toHaveLength(0);
    } finally {
      after.close();
    }
  });

  it('shows the live branch on session list without trusting the stored branch', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'listed-session',
        role: 'primary',
        ide: 'codex',
        branch: 'main',
      });
    } finally {
      store.close();
    }
    execFileSync('git', ['checkout', '-q', '-b', 'feature/listed'], { cwd: tmpDir });
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await sessionCommand(['list']);

    log.mockRestore();
    expect(logs.join('\n')).toContain('Branch: feature/listed');
    expect(logs.join('\n')).not.toContain('Branch: main');
  });

  it('reconciles an unscoped heartbeat into the linked worktree', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    writeFileSync(join(tmpDir, 'README.md'), 'test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmpDir });
    const linkedWorktree = `${tmpDir}-linked`;
    linkedWorktrees.push(linkedWorktree);
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature/linked', linkedWorktree], {
      cwd: tmpDir,
    });
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'linked-session',
        role: 'observer',
        ide: 'codex',
        branch: 'main',
      });
    } finally {
      store.close();
    }
    process.chdir(linkedWorktree);

    await sessionCommand(['heartbeat', '--session-id=linked-session']);

    const after = createStore();
    try {
      expect((await after.getActiveSessions())[0]).toMatchObject({
        session_id: 'linked-session',
        role: 'observer',
        branch: 'feature/linked',
        worktree_path: realpathSync(linkedWorktree),
      });
    } finally {
      after.close();
    }
  });

  it('rejects a heartbeat from a checkout other than the recorded worktree', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    writeFileSync(join(tmpDir, 'README.md'), 'test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmpDir });
    const linkedWorktree = `${tmpDir}-scoped`;
    linkedWorktrees.push(linkedWorktree);
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature/scoped', linkedWorktree], {
      cwd: tmpDir,
    });
    const store = createStore();
    let beforeHeartbeat = '';
    try {
      const session = await store.registerSession({
        session_id: 'scoped-session',
        role: 'observer',
        ide: 'codex',
        branch: 'feature/scoped',
        worktree_path: realpathSync(linkedWorktree),
      });
      beforeHeartbeat = session.last_heartbeat_at;
    } finally {
      store.close();
    }
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sessionCommand(['heartbeat', '--session-id=scoped-session']))
      .rejects.toThrow('process.exit(1)');

    error.mockRestore();
    exit.mockRestore();
    const after = createStore();
    try {
      expect((await after.getActiveSessions())[0]).toMatchObject({
        branch: 'feature/scoped',
        role: 'observer',
        worktree_path: realpathSync(linkedWorktree),
        last_heartbeat_at: beforeHeartbeat,
      });
    } finally {
      after.close();
    }
  });
});
