import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionCommand } from '../../../src/cli/commands/session.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';
import { makeTempDir } from '../../helpers/temp-dir.js';

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
    tmpDir = makeTempDir('slope-session-command-');
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

  it('does not release stale-owned claims during ordinary session start', async () => {
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'stale-owner',
        role: 'observer',
        ide: 'codex',
      });
      await store.claim({
        sprint_number: 262,
        player: 'stale-agent',
        target: 'S262-stale',
        scope: 'ticket',
        session_id: 'stale-owner',
      });
      const rawStore = store as unknown as {
        db: { prepare: (sql: string) => { run: (...params: unknown[]) => unknown } };
      };
      rawStore.db.prepare(
        'UPDATE sessions SET last_heartbeat_at = ? WHERE session_id = ?',
      ).run('2020-01-01T00:00:00.000Z', 'stale-owner');
    } finally {
      store.close();
    }

    await sessionCommand(['start', '--session-id=new-session', '--ide=codex']);

    const after = createStore();
    try {
      expect((await after.getActiveSessions()).map(session => session.session_id))
        .toEqual(expect.arrayContaining(['stale-owner', 'new-session']));
      expect((await after.getActiveClaims(262)).map(claim => claim.target))
        .toEqual(['S262-stale']);
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

  it('keeps 458.10 session coordination distinct from 458.1', async () => {
    const store = createStore();
    try {
      await store.registerSession({
        session_id: 'canonical-source',
        role: 'primary',
        ide: 'codex',
        metadata: { sprint: '458.10' },
      });
      await store.registerSession({
        session_id: 'canonical-target',
        role: 'secondary',
        ide: 'codex',
        metadata: { sprint: '458.10' },
      });
      await store.claim({
        sprint_number: '458.1',
        player: 'agent',
        target: 'S458.1-1',
        scope: 'ticket',
        session_id: 'canonical-source',
      });
      await store.claim({
        sprint_number: '458.10',
        player: 'agent',
        target: 'S458.10-1',
        scope: 'ticket',
        session_id: 'canonical-source',
      });
    } finally {
      store.close();
    }

    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await sessionCommand(['plan', '--sprint=458.10', '--json=true']);
    const plan = JSON.parse(logs.at(-1) ?? '{}') as {
      sprint?: string;
      assignments?: Array<{ target: string }>;
    };
    expect(plan.sprint).toBe('458.10');
    expect(plan.assignments?.map(claim => claim.target)).toEqual(['S458.10-1']);

    logs.length = 0;
    await sessionCommand(['dashboard', '--json=true']);
    const dashboard = JSON.parse(logs.at(-1) ?? '{}') as {
      claims?: Array<{ target: string }>;
    };
    expect(dashboard.claims?.map(claim => claim.target)).toEqual(['S458.10-1']);

    logs.length = 0;
    await sessionCommand([
      'assign',
      '--ticket=S458.10-2',
      '--agent=canonical-target',
      '--sprint=458.10',
    ]);
    await sessionCommand([
      'handoff',
      '--from=canonical-source',
      '--to=canonical-target',
    ]);
    log.mockRestore();

    const handoff = JSON.parse(readFileSync(
      join(tmpDir, '.slope', 'handoffs', 'transfer-canonica-canonica.json'),
      'utf8',
    )) as { claims: Array<{ target: string }> };
    expect(handoff.claims.map(claim => claim.target)).toEqual(['S458.10-1']);

    const after = createStore();
    try {
      expect((await after.list('458.10')).map(claim => claim.target))
        .toEqual(['S458.10-1', 'S458.10-2']);
      expect((await after.list('458.1')).map(claim => claim.target))
        .toEqual(['S458.1-1']);
    } finally {
      after.close();
    }
  });
});
