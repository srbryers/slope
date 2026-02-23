import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore, createStore } from './index.js';
import { SlopeStoreError, checkConflicts } from '@srbryers/core';
import type { GolfScorecard } from '@srbryers/core';

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
      greens_total: 3, putts: 1, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
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
        id: 1,
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

describe('Events', () => {
  it('inserts and retrieves events by session', async () => {
    await store.registerSession({ session_id: 'sess-1', role: 'primary', ide: 'claude-code' });

    const event = await store.insertEvent({
      session_id: 'sess-1',
      type: 'failure',
      data: { error: 'build failed', file: 'index.ts' },
      sprint_number: 5,
      ticket_key: 'S5-2',
    });

    expect(event.id).toMatch(/^evt-/);
    expect(event.timestamp).toBeTruthy();
    expect(event.type).toBe('failure');
    expect(event.data).toEqual({ error: 'build failed', file: 'index.ts' });

    const bySession = await store.getEventsBySession('sess-1');
    expect(bySession).toHaveLength(1);
    expect(bySession[0].id).toBe(event.id);
  });

  it('retrieves events by sprint', async () => {
    await store.insertEvent({ type: 'hazard', data: { desc: 'flaky test' }, sprint_number: 3 });
    await store.insertEvent({ type: 'decision', data: { choice: 'refactor' }, sprint_number: 3 });
    await store.insertEvent({ type: 'failure', data: {}, sprint_number: 4 });

    const sprint3 = await store.getEventsBySprint(3);
    expect(sprint3).toHaveLength(2);
    expect(sprint3[0].type).toBe('hazard');
    expect(sprint3[1].type).toBe('decision');
  });

  it('retrieves events by ticket', async () => {
    await store.insertEvent({ type: 'scope_change', data: { reason: 'expanded' }, ticket_key: 'S5-1' });
    await store.insertEvent({ type: 'dead_end', data: { approach: 'api v1' }, ticket_key: 'S5-1' });
    await store.insertEvent({ type: 'failure', data: {}, ticket_key: 'S5-2' });

    const ticket1 = await store.getEventsByTicket('S5-1');
    expect(ticket1).toHaveLength(2);
    expect(ticket1[0].type).toBe('scope_change');
    expect(ticket1[1].type).toBe('dead_end');
  });

  it('handles events without session_id', async () => {
    const event = await store.insertEvent({
      type: 'compaction',
      data: { tokens_before: 100000, tokens_after: 50000 },
    });

    expect(event.session_id).toBeUndefined();

    const bySprint = await store.getEventsBySprint(1);
    expect(bySprint).toHaveLength(0);
  });

  it('preserves complex nested data', async () => {
    const complexData = {
      files: ['a.ts', 'b.ts'],
      metrics: { lines: 150, coverage: 0.85 },
      tags: ['refactor', 'breaking'],
    };

    await store.insertEvent({
      type: 'decision',
      data: complexData,
      sprint_number: 1,
    });

    const events = await store.getEventsBySprint(1);
    expect(events[0].data).toEqual(complexData);
  });

  it('preserves events after session delete (no FK cascade)', async () => {
    await store.registerSession({ session_id: 'sess-del', role: 'primary', ide: 'vscode' });
    await store.insertEvent({
      session_id: 'sess-del',
      type: 'failure',
      data: { msg: 'test' },
      sprint_number: 1,
    });

    await store.removeSession('sess-del');

    // Event still exists with original session_id (events are independent)
    const events = await store.getEventsBySprint(1);
    expect(events).toHaveLength(1);
    expect(events[0].session_id).toBe('sess-del');
  });

  it('inserts events with non-existent session_id', async () => {
    const event = await store.insertEvent({
      session_id: 'no-such-session',
      type: 'decision',
      data: { choice: 'refactor' },
    });
    expect(event.session_id).toBe('no-such-session');

    const events = await store.getEventsBySession('no-such-session');
    expect(events).toHaveLength(1);
  });
});

describe('Schema Migration', () => {
  it('reports current schema version', () => {
    expect(store.getSchemaVersion()).toBe(3);
  });

  it('is idempotent — reopening same DB does not fail', () => {
    const dbPath = join(tmpDir, 'reopen.db');
    const s1 = new SqliteSlopeStore(dbPath);
    expect(s1.getSchemaVersion()).toBe(3);
    s1.close();

    const s2 = new SqliteSlopeStore(dbPath);
    expect(s2.getSchemaVersion()).toBe(3);
    s2.close();
  });

  it('migrates v1 database to v2 on reopen', () => {
    // Create a v1-only database by manually setting up tables
    const dbPath = join(tmpDir, 'v1.db');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create schema_version with only v1
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (1, '2025-01-01T00:00:00.000Z');
    `);
    // Create v1 tables
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY, role TEXT NOT NULL, ide TEXT NOT NULL,
        worktree_path TEXT, branch TEXT, started_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL, metadata TEXT
      );
      CREATE TABLE claims (
        id TEXT PRIMARY KEY, session_id TEXT, sprint_number INTEGER NOT NULL,
        target TEXT NOT NULL, player TEXT NOT NULL, scope TEXT NOT NULL,
        claimed_at TEXT NOT NULL, expires_at TEXT, notes TEXT, metadata TEXT,
        UNIQUE(sprint_number, scope, target)
      );
      CREATE TABLE scorecards (sprint_number INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE common_issues (id INTEGER PRIMARY KEY DEFAULT 1, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    db.close();

    // Reopen with SqliteSlopeStore — should auto-migrate to v2 and v3
    const upgraded = new SqliteSlopeStore(dbPath);
    expect(upgraded.getSchemaVersion()).toBe(3);

    // Verify events table works
    upgraded.insertEvent({ type: 'failure', data: { test: true } });
    upgraded.close();
  });

  it('migrates v2 database to v3 on reopen', () => {
    // Create a v2 database (has events but no agent_role/swarm_id)
    const dbPath = join(tmpDir, 'v2.db');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (1, '2025-01-01T00:00:00.000Z');
      INSERT INTO schema_version VALUES (2, '2025-01-02T00:00:00.000Z');

      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY, role TEXT NOT NULL, ide TEXT NOT NULL,
        worktree_path TEXT, branch TEXT, started_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL, metadata TEXT
      );
      CREATE TABLE claims (
        id TEXT PRIMARY KEY, session_id TEXT, sprint_number INTEGER NOT NULL,
        target TEXT NOT NULL, player TEXT NOT NULL, scope TEXT NOT NULL,
        claimed_at TEXT NOT NULL, expires_at TEXT, notes TEXT, metadata TEXT,
        UNIQUE(sprint_number, scope, target)
      );
      CREATE TABLE scorecards (sprint_number INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE common_issues (id INTEGER PRIMARY KEY DEFAULT 1, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE events (
        id TEXT PRIMARY KEY, session_id TEXT, type TEXT NOT NULL,
        timestamp TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
        sprint_number INTEGER, ticket_key TEXT
      );
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_sprint ON events(sprint_number);
      CREATE INDEX idx_events_ticket ON events(ticket_key);
      CREATE INDEX idx_events_type ON events(type);

      INSERT INTO sessions VALUES ('pre-v3', 'primary', 'vscode', NULL, 'main', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', NULL);
    `);
    db.close();

    // Reopen — should auto-migrate to v3
    const upgraded = new SqliteSlopeStore(dbPath);
    expect(upgraded.getSchemaVersion()).toBe(3);

    // Existing session should have null agent_role and swarm_id
    const sessions = upgraded.getActiveSessions();
    sessions.then(s => {
      expect(s).toHaveLength(1);
      expect(s[0].agent_role).toBeUndefined();
      expect(s[0].swarm_id).toBeUndefined();
    });

    // New session with agent_role and swarm_id should work
    upgraded.registerSession({
      session_id: 'post-v3',
      role: 'secondary',
      ide: 'claude-code',
      agent_role: 'backend',
      swarm_id: 'swarm-1',
    });

    upgraded.close();
  });
});

describe('Swarm sessions', () => {
  it('registers sessions with agent_role and swarm_id', async () => {
    const session = await store.registerSession({
      session_id: 'swarm-s1',
      role: 'primary',
      ide: 'claude-code',
      agent_role: 'backend',
      swarm_id: 'swarm-abc',
    });

    expect(session.agent_role).toBe('backend');
    expect(session.swarm_id).toBe('swarm-abc');

    const active = await store.getActiveSessions();
    expect(active[0].agent_role).toBe('backend');
    expect(active[0].swarm_id).toBe('swarm-abc');
  });

  it('getSessionsBySwarm filters by swarm_id', async () => {
    await store.registerSession({
      session_id: 'sw1', role: 'primary', ide: 'claude-code',
      agent_role: 'backend', swarm_id: 'swarm-1',
    });
    await store.registerSession({
      session_id: 'sw2', role: 'secondary', ide: 'cursor',
      agent_role: 'frontend', swarm_id: 'swarm-1',
    });
    await store.registerSession({
      session_id: 'sw3', role: 'primary', ide: 'claude-code',
      agent_role: 'devops', swarm_id: 'swarm-2',
    });
    await store.registerSession({
      session_id: 'solo', role: 'primary', ide: 'vscode',
    });

    const swarm1 = await store.getSessionsBySwarm('swarm-1');
    expect(swarm1).toHaveLength(2);
    expect(swarm1.map(s => s.session_id).sort()).toEqual(['sw1', 'sw2']);

    const swarm2 = await store.getSessionsBySwarm('swarm-2');
    expect(swarm2).toHaveLength(1);
    expect(swarm2[0].agent_role).toBe('devops');

    const empty = await store.getSessionsBySwarm('nonexistent');
    expect(empty).toHaveLength(0);
  });

  it('sessions without swarm_id are not returned by getSessionsBySwarm', async () => {
    await store.registerSession({
      session_id: 'no-swarm', role: 'primary', ide: 'vscode',
    });

    const result = await store.getSessionsBySwarm('anything');
    expect(result).toHaveLength(0);
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
