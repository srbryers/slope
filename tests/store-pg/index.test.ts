import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { SlopeStoreError, checkConflicts } from '../../src/core/index.js';
import type { GolfScorecard, SlopeStore } from '../../src/core/index.js';

// Skip entire suite if no PG connection available
const PG_URL = process.env.SLOPE_TEST_PG_URL;

describe.skipIf(!PG_URL)('PostgresSlopeStore', () => {
  let store: SlopeStore;
  let pool: unknown;

  beforeAll(async () => {
    const { createPostgresStore } = await import('../../src/store-pg/index.js');
    store = await createPostgresStore({
      connectionString: PG_URL,
      projectId: `test-${Date.now()}`,
    });
  });

  afterAll(() => {
    store?.close();
  });

  // Clean between tests by removing all data for this project
  beforeEach(async () => {
    // Each test uses a fresh store with unique projectId to avoid conflicts
  });

  describe('Sessions', () => {
    it('registers and lists active sessions', async () => {
      const session = await store.registerSession({
        session_id: `sess-${Date.now()}`,
        role: 'primary',
        ide: 'claude-code',
        branch: 'main',
      });

      expect(session.session_id).toBeTruthy();
      expect(session.role).toBe('primary');
      expect(session.started_at).toBeTruthy();

      const active = await store.getActiveSessions();
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(active.find(s => s.session_id === session.session_id)).toBeTruthy();
    });

    it('removes a session', async () => {
      const id = `sess-rm-${Date.now()}`;
      await store.registerSession({ session_id: id, role: 'primary', ide: 'vscode' });

      const removed = await store.removeSession(id);
      expect(removed).toBe(true);

      const removed2 = await store.removeSession(id);
      expect(removed2).toBe(false);
    });

    it('updates heartbeat timestamp', async () => {
      const id = `sess-hb-${Date.now()}`;
      const session = await store.registerSession({ session_id: id, role: 'primary', ide: 'vscode' });
      const original = session.last_heartbeat_at;

      await new Promise(r => setTimeout(r, 10));
      await store.updateHeartbeat(id);

      const active = await store.getActiveSessions();
      const updated = active.find(s => s.session_id === id);
      expect(updated?.last_heartbeat_at).not.toBe(original);
    });

    it('throws NOT_FOUND on heartbeat for missing session', async () => {
      await expect(store.updateHeartbeat('nonexistent-pg'))
        .rejects.toThrow(SlopeStoreError);
    });

    it('throws SESSION_CONFLICT on duplicate session_id', async () => {
      const id = `sess-dup-${Date.now()}`;
      await store.registerSession({ session_id: id, role: 'primary', ide: 'vscode' });
      await expect(store.registerSession({ session_id: id, role: 'secondary', ide: 'cursor' }))
        .rejects.toThrow(SlopeStoreError);
    });

    it('preserves session metadata', async () => {
      const id = `sess-meta-${Date.now()}`;
      await store.registerSession({
        session_id: id,
        role: 'secondary',
        ide: 'cursor',
        metadata: { feature: 'auth', tickets: ['T-1', 'T-2'] },
      });

      const sessions = await store.getActiveSessions();
      const session = sessions.find(s => s.session_id === id);
      expect(session?.metadata).toEqual({ feature: 'auth', tickets: ['T-1', 'T-2'] });
    });

    it('registers sessions with agent_role and swarm_id', async () => {
      const id = `sess-swarm-${Date.now()}`;
      const session = await store.registerSession({
        session_id: id,
        role: 'primary',
        ide: 'claude-code',
        agent_role: 'backend',
        swarm_id: 'swarm-abc',
      });

      expect(session.agent_role).toBe('backend');
      expect(session.swarm_id).toBe('swarm-abc');
    });

    it('getSessionsBySwarm filters by swarm_id', async () => {
      const swarmId = `swarm-${Date.now()}`;
      await store.registerSession({
        session_id: `sw1-${Date.now()}`, role: 'primary', ide: 'claude-code',
        agent_role: 'backend', swarm_id: swarmId,
      });
      await store.registerSession({
        session_id: `sw2-${Date.now()}`, role: 'secondary', ide: 'cursor',
        agent_role: 'frontend', swarm_id: swarmId,
      });

      const swarmSessions = await store.getSessionsBySwarm(swarmId);
      expect(swarmSessions).toHaveLength(2);

      const empty = await store.getSessionsBySwarm('nonexistent-swarm');
      expect(empty).toHaveLength(0);
    });
  });

  describe('Claims', () => {
    it('creates a claim and retrieves by list and get', async () => {
      const sprint = Date.now(); // unique sprint to avoid collisions
      const claim = await store.claim({
        sprint_number: sprint,
        player: 'alice',
        target: 'TICK-1',
        scope: 'ticket',
        notes: 'working on auth',
      });

      expect(claim.id).toMatch(/^claim-/);
      expect(claim.sprint_number).toBe(sprint);

      const listed = await store.list(sprint);
      expect(listed).toHaveLength(1);

      const got = await store.get(claim.id);
      expect(got).toBeDefined();
      expect(got!.target).toBe('TICK-1');
    });

    it('releases a claim', async () => {
      const sprint = Date.now();
      const claim = await store.claim({ sprint_number: sprint, player: 'bob', target: 'X', scope: 'ticket' });
      const released = await store.release(claim.id);
      expect(released).toBe(true);

      const got = await store.get(claim.id);
      expect(got).toBeUndefined();
    });

    it('throws CLAIM_EXISTS on duplicate target in same sprint', async () => {
      const sprint = Date.now();
      await store.claim({ sprint_number: sprint, player: 'alice', target: 'T-DUP', scope: 'ticket' });
      await expect(store.claim({ sprint_number: sprint, player: 'bob', target: 'T-DUP', scope: 'ticket' }))
        .rejects.toThrow(SlopeStoreError);
    });

    it('allows same target in different sprints', async () => {
      const sprint1 = Date.now();
      const sprint2 = sprint1 + 1;
      await store.claim({ sprint_number: sprint1, player: 'alice', target: 'T-CROSS', scope: 'ticket' });
      const c2 = await store.claim({ sprint_number: sprint2, player: 'alice', target: 'T-CROSS', scope: 'ticket' });
      expect(c2.sprint_number).toBe(sprint2);
    });
  });

  describe('Scorecards', () => {
    const makeCard = (sprint: number): GolfScorecard => ({
      sprint_number: sprint,
      theme: `Sprint ${sprint}`,
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
    });

    it('saves and lists scorecards', async () => {
      const base = Date.now();
      await store.saveScorecard(makeCard(base));
      await store.saveScorecard(makeCard(base + 1));

      const all = await store.listScorecards({ minSprint: base });
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('upserts scorecards', async () => {
      const sprint = Date.now();
      await store.saveScorecard(makeCard(sprint));
      await store.saveScorecard({ ...makeCard(sprint), theme: 'Updated' });

      const all = await store.listScorecards({ minSprint: sprint, maxSprint: sprint });
      expect(all).toHaveLength(1);
      expect(all[0].theme).toBe('Updated');
    });
  });

  describe('Common Issues', () => {
    it('returns empty patterns when no data saved', async () => {
      // Uses unique projectId so no data exists
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
      const sessionId = `evt-sess-${Date.now()}`;
      await store.registerSession({ session_id: sessionId, role: 'primary', ide: 'claude-code' });

      const event = await store.insertEvent({
        session_id: sessionId,
        type: 'failure',
        data: { error: 'build failed', file: 'index.ts' },
        sprint_number: 99999,
        ticket_key: 'S99-2',
      });

      expect(event.id).toMatch(/^evt-/);
      expect(event.timestamp).toBeTruthy();

      const bySession = await store.getEventsBySession(sessionId);
      expect(bySession).toHaveLength(1);
      expect(bySession[0].data).toEqual({ error: 'build failed', file: 'index.ts' });
    });

    it('retrieves events by sprint', async () => {
      const sprint = Date.now();
      await store.insertEvent({ type: 'hazard', data: { desc: 'flaky' }, sprint_number: sprint });
      await store.insertEvent({ type: 'decision', data: { choice: 'refactor' }, sprint_number: sprint });

      const events = await store.getEventsBySprint(sprint);
      expect(events).toHaveLength(2);
    });

    it('retrieves events by ticket', async () => {
      const ticket = `T-${Date.now()}`;
      await store.insertEvent({ type: 'scope_change', data: { reason: 'expanded' }, ticket_key: ticket });
      await store.insertEvent({ type: 'dead_end', data: { approach: 'api v1' }, ticket_key: ticket });

      const events = await store.getEventsByTicket(ticket);
      expect(events).toHaveLength(2);
    });

    it('handles events without session_id', async () => {
      const event = await store.insertEvent({
        type: 'compaction',
        data: { tokens_before: 100000 },
      });
      expect(event.session_id).toBeUndefined();
    });

    it('inserts events with non-existent session_id (no FK)', async () => {
      const event = await store.insertEvent({
        session_id: 'no-such-session-pg',
        type: 'decision',
        data: { choice: 'refactor' },
      });
      expect(event.session_id).toBe('no-such-session-pg');
    });
  });
});
