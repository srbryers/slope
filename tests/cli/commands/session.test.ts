import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionCommand } from '../../../src/cli/commands/session.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';

let tmpDir: string;
let originalCwd: string;

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
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints prune in session help', async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sessionCommand([]);

    log.mockRestore();
    expect(logs.join('\n')).toContain('slope session prune');
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
});
