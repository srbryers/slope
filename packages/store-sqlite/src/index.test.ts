import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore, createStore } from './index.js';
import { SlopeStoreError, checkConflicts } from '@slope-dev/core';
import type { GolfScorecard } from '@slope-dev/core';

let store: SqliteSlopeStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-test-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Sessions', () => {
  it('registers and lists active sessions', async () => {
    const session = await store.registerSession({
      session_id: 'sess-1',
      role: 'primary',
      ide: 'claude-code',
      branch: 'main',
    });

    expect(session.session_id).toBe('sess-1');
    expect(session.role).toBe('primary');
    expect(session.started_at).toBeTruthy();
    expect(session.last_heartbeat_at).toBeTruthy();

    const active = await store.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].session_id).toBe('sess-1');
  });

  it('removes a session', async () => {
    await store.registerSession({ session_id: 'sess-1', role: 'primary', ide: 'vscode' });

    const removed = await store.removeSession('sess-1');
    expect(removed).toBe(true);

    const active = await store.getActiveSessions();
    expect(active).toHaveLength(0);
  });

  it('returns false when removing nonexistent session', async () => {
    const removed = await store.removeSession('nonexistent');
    expect(removed).toBe(false);
  });

  it('updates heartbeat timestamp', async () => {
    const session = await store.registerSession({ session_id: 'sess-1', role: 'primary', ide: 'vscode' });
    const original = session.last_heartbeat_at;

    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    await store.updateHeartbeat('sess-1');

    const active = await store.getActiveSessions();
    expect(active[0].last_heartbeat_at).not.toBe(original);
  });

  it('throws NOT_FOUND on heartbeat for missing session', async () => {
    await expect(store.updateHeartbeat('nonexistent'))
      .rejects.toThrow(SlopeStoreError);
  });

  it('cleans stale sessions and cascades to claims', async () => {
    await store.registerSession({ session_id: 'old-sess', role: 'primary', ide: 'vscode' });
    await store.claim({
      sprint_number: 1,
      player: 'alice',
      target: 'TICK-1',
      scope: 'ticket',
      session_id: 'old-sess',
    });

    // Make the session stale by waiting and not heartbeating
    await new Promise(r => setTimeout(r, 50));

    const cleaned = await store.cleanStaleSessions(25); // 25ms max age
    expect(cleaned).toBe(1);

    const sessions = await store.getActiveSessions();
    expect(sessions).toHaveLength(0);

    // Claims should be cascade-deleted
    const claims = await store.getActiveClaims();
    expect(claims).toHaveLength(0);
  });

  it('preserves session metadata', async () => {
    await store.registerSession({
      session_id: 'meta-sess',
      role: 'secondary',
      ide: 'cursor',
      metadata: { feature: 'auth', tickets: ['T-1', 'T-2'] },
    });

    const sessions = await store.getActiveSessions();
    expect(sessions[0].metadata).toEqual({ feature: 'auth', tickets: ['T-1', 'T-2'] });
  });

  it('throws SESSION_CONFLICT on duplicate session_id', async () => {
    await store.registerSession({ session_id: 'dup', role: 'primary', ide: 'vscode' });
    await expect(store.registerSession({ session_id: 'dup', role: 'secondary', ide: 'cursor' }))
      .rejects.toThrow(SlopeStoreError);
  });
});

describe('Claims', () => {
  it('creates a claim and retrieves by list and get', async () => {
    const claim = await store.claim({
      sprint_number: 5,
      player: 'alice',
      target: 'TICK-1',
      scope: 'ticket',
      notes: 'working on auth',
    });

    expect(claim.id).toMatch(/^claim-/);
    expect(claim.sprint_number).toBe(5);
    expect(claim.player).toBe('alice');
    expect(claim.claimed_at).toBeTruthy();

    const listed = await store.list(5);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(claim.id);

    const got = await store.get(claim.id);
    expect(got).toBeDefined();
    expect(got!.target).toBe('TICK-1');
  });

  it('releases a claim', async () => {
    const claim = await store.claim({ sprint_number: 1, player: 'bob', target: 'X', scope: 'ticket' });
    const released = await store.release(claim.id);
    expect(released).toBe(true);

    const got = await store.get(claim.id);
    expect(got).toBeUndefined();
  });

  it('returns false when releasing nonexistent claim', async () => {
    const released = await store.release('nonexistent');
    expect(released).toBe(false);
  });

  it('throws CLAIM_EXISTS on duplicate target in same sprint', async () => {
    await store.claim({ sprint_number: 1, player: 'alice', target: 'T-1', scope: 'ticket' });
    await expect(store.claim({ sprint_number: 1, player: 'bob', target: 'T-1', scope: 'ticket' }))
      .rejects.toThrow(SlopeStoreError);
  });

  it('allows same target in different sprints', async () => {
    await store.claim({ sprint_number: 1, player: 'alice', target: 'T-1', scope: 'ticket' });
    const c2 = await store.claim({ sprint_number: 2, player: 'alice', target: 'T-1', scope: 'ticket' });
    expect(c2.sprint_number).toBe(2);
  });

  it('getActiveClaims returns all or filtered by sprint', async () => {
    await store.claim({ sprint_number: 1, player: 'alice', target: 'A', scope: 'ticket' });
    await store.claim({ sprint_number: 2, player: 'bob', target: 'B', scope: 'ticket' });

    const all = await store.getActiveClaims();
    expect(all).toHaveLength(2);

    const filtered = await store.getActiveClaims(1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].target).toBe('A');
  });
});

describe('Scorecards', () => {
  const minimalCard: GolfScorecard = {
    sprint_number: 3,
    theme: 'Test Sprint',
    par: 4,
    slope: 2,
    score: 4,
    score_label: 'par',
    shots: [],
    conditions: [],
    special_plays: [],
    stats: {
      fairways_hit: 2, fairways_total: 3, greens_in_regulation: 2,
      greens_total: 3, putts: 1, penalties: 0, hazards_hit: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    date: '2025-01-01',
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
  };

  it('saves and lists scorecards', async () => {
    await store.saveScorecard(minimalCard);
    await store.saveScorecard({ ...minimalCard, sprint_number: 5, theme: 'Sprint 5' });

    const all = await store.listScorecards();
    expect(all).toHaveLength(2);
    expect(all[0].sprint_number).toBe(3);
    expect(all[1].sprint_number).toBe(5);
  });

  it('filters scorecards by min/max sprint', async () => {
    await store.saveScorecard({ ...minimalCard, sprint_number: 1 });
    await store.saveScorecard({ ...minimalCard, sprint_number: 3 });
    await store.saveScorecard({ ...minimalCard, sprint_number: 5 });

    const filtered = await store.listScorecards({ minSprint: 2, maxSprint: 4 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sprint_number).toBe(3);
  });

  it('upserts scorecards (same sprint overwrites)', async () => {
    await store.saveScorecard(minimalCard);
    await store.saveScorecard({ ...minimalCard, theme: 'Updated' });

    const all = await store.listScorecards();
    expect(all).toHaveLength(1);
    expect(all[0].theme).toBe('Updated');
  });
});

describe('Common Issues', () => {
  it('returns empty patterns when no data saved', async () => {
    const issues = await store.loadCommonIssues();
    expect(issues.recurring_patterns).toEqual([]);
  });

  it('round-trips common issues', async () => {
    const data = {
      recurring_patterns: [{
        id: 'ci-1',
        title: 'Test flakiness',
        category: 'testing',
        sprints_hit: [1, 2],
        gotcha_refs: [],
        description: 'Tests intermittently fail',
        prevention: 'Add retries',
      }],
    };

    await store.saveCommonIssues(data);
    const loaded = await store.loadCommonIssues();
    expect(loaded).toEqual(data);
  });
});

describe('createStore factory', () => {
  it('creates a store with cwd + storePath', () => {
    const s = createStore({ storePath: 'test2.db', cwd: tmpDir });
    s.close();
  });

  it('creates a store with absolute storePath', () => {
    const s = createStore({ storePath: join(tmpDir, 'abs.db') });
    s.close();
  });
});

describe('Integration: full session lifecycle', () => {
  it('register session → claim → check conflicts → end session → verify cascade', async () => {
    // Register two sessions
    await store.registerSession({ session_id: 's1', role: 'primary', ide: 'claude-code' });
    await store.registerSession({ session_id: 's2', role: 'secondary', ide: 'cursor' });

    // Each session claims
    await store.claim({
      sprint_number: 1, player: 'alice', target: 'auth', scope: 'area', session_id: 's1',
    });
    await store.claim({
      sprint_number: 1, player: 'bob', target: 'auth/login', scope: 'ticket', session_id: 's2',
    });

    // Check conflicts via core's checkConflicts
    const claims = await store.getActiveClaims(1);
    const conflicts = checkConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('adjacent');

    // End session s1 — should cascade-delete its claims
    await store.removeSession('s1');

    const remaining = await store.getActiveClaims(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].player).toBe('bob');

    // Session s2 still active
    const sessions = await store.getActiveSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('s2');
  });
});
