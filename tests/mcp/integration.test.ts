import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSlopeToolsServer } from '../../src/mcp/index.js';
import { createStore } from '../../src/store/index.js';
import type { SlopeStore } from '../../src/core/index.js';

let tmpDir: string;
let store: SlopeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-mcp-int-'));
  // Create .slope/config.json so it looks like a real project
  const slopeDir = join(tmpDir, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
  }));
  store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP integration with real SQLite store', () => {
  it('session_status with real store returns empty on fresh DB', async () => {
    const sessions = await store.getActiveSessions();
    const claims = await store.getActiveClaims();
    expect(sessions).toHaveLength(0);
    expect(claims).toHaveLength(0);
  });

  it('acquire_claim creates real entry in SQLite', async () => {
    await store.registerSession({ session_id: 'int-s1', role: 'primary', ide: 'claude-code' });
    const claim = await store.claim({
      sprint_number: 1,
      player: 'integration-tester',
      target: 'INT-1',
      scope: 'ticket',
      session_id: 'int-s1',
    });

    expect(claim.id).toMatch(/^claim-/);
    expect(claim.target).toBe('INT-1');

    // Verify persisted
    const retrieved = await store.get(claim.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.player).toBe('integration-tester');
  });

  it('check_conflicts detects real conflicts', async () => {
    const { checkConflicts } = await import('../../src/core/index.js');

    await store.claim({ sprint_number: 1, player: 'alice', target: 'shared-area', scope: 'area' });
    await store.claim({ sprint_number: 1, player: 'bob', target: 'shared-area/sub', scope: 'area' });

    const claims = await store.getActiveClaims(1);
    const conflicts = checkConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('adjacent');
  });

  it('full lifecycle via store operations', async () => {
    // Register session
    const session = await store.registerSession({ session_id: 'life-1', role: 'primary', ide: 'test' });
    expect(session.session_id).toBe('life-1');

    // Claim
    const claim = await store.claim({
      sprint_number: 2, player: 'alice', target: 'LIFE-1', scope: 'ticket', session_id: 'life-1',
    });

    // Verify
    const sessions = await store.getActiveSessions();
    expect(sessions).toHaveLength(1);
    const claims = await store.getActiveClaims();
    expect(claims).toHaveLength(1);

    // End session (cascades claims)
    await store.removeSession('life-1');
    expect(await store.getActiveSessions()).toHaveLength(0);
    expect(await store.getActiveClaims()).toHaveLength(0);
  });

  it('server without store creates successfully with search/execute only', () => {
    const server = createSlopeToolsServer();
    expect(server).toBeDefined();
  });

  it('server with store creates successfully', () => {
    const server = createSlopeToolsServer(store);
    expect(server).toBeDefined();
  });
});
