import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { SlopeStoreError, checkConflicts } from '../../src/core/index.js';
import type { GolfScorecard, SlopeStore, StoredGolfScorecard } from '../../src/core/index.js';
import type { Pool } from 'pg';

// Skip entire suite if no PG connection available
const PG_URL = process.env.SLOPE_TEST_PG_URL;

// Use a simple counter for unique sprint numbers — Date.now() overflows PG INTEGER
let nextSprint = 100_000;
function uniqueSprint(): number {
  return nextSprint++;
}

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

    it('updates session metadata without deleting claims', async () => {
      const id = `sess-update-${Date.now()}`;
      const sprint = uniqueSprint();
      const session = await store.registerSession({ session_id: id, role: 'primary', ide: 'vscode', branch: 'main' });
      await store.claim({
        sprint_number: sprint,
        player: 'alice',
        target: `S${sprint}-1`,
        scope: 'ticket',
        session_id: id,
      });

      await new Promise(r => setTimeout(r, 10));
      const updated = await store.updateSession(id, {
        role: 'secondary',
        branch: 'fix/deadlock',
        worktree_path: '/tmp/slope-worktree',
      });

      expect(updated.role).toBe('secondary');
      expect(updated.ide).toBe('vscode');
      expect(updated.branch).toBe('fix/deadlock');
      expect(updated.worktree_path).toBe('/tmp/slope-worktree');
      expect(updated.started_at).toBe(session.started_at);
      expect(updated.last_heartbeat_at).not.toBe(session.last_heartbeat_at);

      const claims = await store.getActiveClaims(sprint);
      expect(claims).toHaveLength(1);
    });

    it('throws NOT_FOUND on session update for missing session', async () => {
      await expect(store.updateSession('nonexistent-pg', { role: 'secondary' }))
        .rejects.toThrow(SlopeStoreError);
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
      const sprint = uniqueSprint();
      const claim = await store.claim({
        sprint_number: sprint,
        player: 'alice',
        target: 'TICK-1',
        scope: 'ticket',
        notes: 'working on auth',
      });

      expect(claim.id).toMatch(/^claim-/);
      expect(claim.sprint_number).toBe(String(sprint));

      const listed = await store.list(sprint);
      expect(listed).toHaveLength(1);

      const got = await store.get(claim.id);
      expect(got).toBeDefined();
      expect(got!.target).toBe('TICK-1');
    });

    it('excludes expired claims from active results while preserving history', async () => {
      const sprint = uniqueSprint();
      await store.claim({
        sprint_number: sprint,
        player: 'alice',
        target: 'TICK-EXPIRED',
        scope: 'ticket',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });

      expect(await store.getActiveClaims(sprint)).toEqual([]);
      expect(await store.list(sprint)).toHaveLength(1);
    });

    it('releases a claim', async () => {
      const sprint = uniqueSprint();
      const claim = await store.claim({ sprint_number: sprint, player: 'bob', target: 'X', scope: 'ticket' });
      const released = await store.release(claim.id);
      expect(released).toBe(true);

      const got = await store.get(claim.id);
      expect(got).toBeUndefined();
    });

    it('throws CLAIM_EXISTS on duplicate target in same sprint', async () => {
      const sprint = uniqueSprint();
      await store.claim({ sprint_number: sprint, player: 'alice', target: 'T-DUP', scope: 'ticket' });
      await expect(store.claim({ sprint_number: sprint, player: 'bob', target: 'T-DUP', scope: 'ticket' }))
        .rejects.toThrow(SlopeStoreError);
    });

    it('allows same target in different sprints', async () => {
      const sprint1 = uniqueSprint();
      const sprint2 = uniqueSprint();
      await store.claim({ sprint_number: sprint1, player: 'alice', target: 'T-CROSS', scope: 'ticket' });
      const c2 = await store.claim({ sprint_number: sprint2, player: 'alice', target: 'T-CROSS', scope: 'ticket' });
      expect(c2.sprint_number).toBe(String(sprint2));
    });

    it('keeps 458.10 claims distinct from 458.1', async () => {
      await store.claim({ sprint_number: '458.1', player: 'alice', target: 'T-CANONICAL', scope: 'ticket' });
      await store.claim({ sprint_number: '458.10', player: 'bob', target: 'T-CANONICAL', scope: 'ticket' });

      expect((await store.list('458.1')).map(claim => claim.sprint_number)).toEqual(['458.1']);
      expect((await store.list('458.10')).map(claim => claim.sprint_number)).toEqual(['458.10']);
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
      const base = uniqueSprint();
      const base2 = uniqueSprint();
      await store.saveScorecard(makeCard(base));
      await store.saveScorecard(makeCard(base2));

      const all = await store.listScorecards({ minSprint: base, maxSprint: base2 });
      expect(all).toHaveLength(2);
    });

    it('upserts scorecards', async () => {
      const sprint = uniqueSprint();
      await store.saveScorecard(makeCard(sprint));
      await store.saveScorecard({ ...makeCard(sprint), theme: 'Updated' });

      const all = await store.listScorecards({ minSprint: sprint, maxSprint: sprint });
      expect(all).toHaveLength(1);
      expect(all[0].theme).toBe('Updated');
    });

    it('round-trips and orders canonical inserted-sprint scorecards', async () => {
      const sprintIds = ['458.11', '458.1', '458.10', '458.9'];
      for (const sprintId of sprintIds) {
        const card: StoredGolfScorecard = {
          ...makeCard(458),
          sprint_number: sprintId,
          theme: `Sprint ${sprintId}`,
        };
        await store.saveScorecard(card);
      }

      const cards = await store.listScorecards({ minSprint: '458.1', maxSprint: '458.11' });
      expect(cards.map(card => card.sprint_number)).toEqual([
        '458.1',
        '458.9',
        '458.10',
        '458.11',
      ]);
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

  describe('Diagnostics', () => {
    it('getSchemaVersion returns latest', async () => {
      const version = await store.getSchemaVersion();
      expect(version).toBeGreaterThan(0);
    });

    it('getStats returns correct counts after inserts', async () => {
      const sprint = uniqueSprint();
      const sessId = `stats-sess-${Date.now()}`;
      await store.registerSession({ session_id: sessId, role: 'primary', ide: 'vscode' });
      await store.claim({ sprint_number: sprint, player: 'alice', target: 'STATS-1', scope: 'ticket' });
      await store.saveScorecard({
        sprint_number: sprint, theme: 'Stats Test', par: 4, slope: 2, score: 4, score_label: 'par',
        shots: [], conditions: [], special_plays: [],
        stats: {
          fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0,
          greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
          miss_directions: { long: 0, short: 0, left: 0, right: 0 },
        },
        date: '2025-01-01', yardage_book_updates: [], bunker_locations: [], course_management_notes: [],
      });
      const evt = await store.insertEvent({ type: 'decision', data: { choice: 'test' }, sprint_number: sprint });

      const stats = await store.getStats();
      expect(stats.sessions).toBeGreaterThanOrEqual(1);
      expect(stats.claims).toBeGreaterThanOrEqual(1);
      expect(stats.scorecards).toBeGreaterThanOrEqual(1);
      expect(stats.events).toBeGreaterThanOrEqual(1);
      expect(stats.lastEventAt).toBeTruthy();
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
      const sprint = uniqueSprint();
      await store.insertEvent({ type: 'hazard', data: { desc: 'flaky' }, sprint_number: sprint });
      await store.insertEvent({ type: 'decision', data: { choice: 'refactor' }, sprint_number: sprint });

      const events = await store.getEventsBySprint(sprint);
      expect(events).toHaveLength(2);
    });

    it('keeps 458.10 events distinct from 458.1', async () => {
      await store.insertEvent({ type: 'decision', data: { sprint: '.1' }, sprint_number: '458.1' });
      await store.insertEvent({ type: 'decision', data: { sprint: '.10' }, sprint_number: '458.10' });

      expect((await store.getEventsBySprint('458.1')).map(event => event.sprint_number)).toEqual(['458.1']);
      expect((await store.getEventsBySprint('458.10')).map(event => event.sprint_number)).toEqual(['458.10']);
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

  describe('Workflow Executions', () => {
    it('keeps 458.10 workflow executions distinct from 458.1', async () => {
      await store.startExecution({ workflow_name: 'test', sprint_id: 'S458.1' });
      await store.startExecution({ workflow_name: 'test', sprint_id: 'S458.10' });

      expect((await store.getExecutionBySprint('458.1'))?.sprint_id).toBe('458.1');
      expect((await store.getExecutionBySprint('458.10'))?.sprint_id).toBe('458.10');
    });
  });
});

describe.skipIf(!PG_URL)('PostgresSlopeStore canonical sprint migration', () => {
  it('upgrades numeric v5 rows to text while preserving constraints and ambiguous keys', async () => {
    const pgModule = await import('pg');
    const PgPool = pgModule.default?.Pool ?? pgModule.Pool;
    const schema = `s265_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const adminPool = new PgPool({ connectionString: PG_URL });
    let schemaPool: Pool | null = null;

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const schemaUrl = new URL(PG_URL!);
      schemaUrl.searchParams.set('options', `-c search_path=${schema}`);
      schemaPool = new PgPool({ connectionString: schemaUrl.toString() });

      await schemaPool.query(`
        CREATE TABLE schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_version VALUES (5, '2026-01-01T00:00:00.000Z');

        CREATE TABLE claims (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'default',
          session_id TEXT,
          sprint_number INTEGER NOT NULL,
          target TEXT NOT NULL,
          player TEXT NOT NULL,
          scope TEXT NOT NULL,
          claimed_at TEXT NOT NULL,
          expires_at TEXT,
          notes TEXT,
          metadata JSONB,
          UNIQUE(project_id, sprint_number, scope, target)
        );
        CREATE INDEX idx_claims_project ON claims(project_id);

        CREATE TABLE scorecards (
          project_id TEXT NOT NULL DEFAULT 'default',
          sprint_number INTEGER NOT NULL,
          data JSONB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(project_id, sprint_number)
        );

        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'default',
          session_id TEXT,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}',
          sprint_number INTEGER,
          ticket_key TEXT
        );
        CREATE INDEX idx_events_sprint ON events(sprint_number);

        CREATE TABLE workflow_executions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'default',
          workflow_name TEXT NOT NULL,
          sprint_id TEXT,
          current_phase TEXT,
          current_step TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          variables JSONB DEFAULT '{}',
          completed_steps JSONB DEFAULT '[]',
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          session_id TEXT,
          definition_json TEXT,
          definition_hash TEXT
        );

        INSERT INTO claims VALUES (
          'legacy-claim', 'legacy', NULL, 458, 'T-LEGACY', 'alice', 'ticket',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL
        );
        INSERT INTO scorecards VALUES (
          'legacy', 458, '{"sprint_number":458,"theme":"legacy"}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO scorecards VALUES (
          'legacy', 435, '{"sprint_number":435,"theme":"ambiguous legacy key"}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO events VALUES (
          'legacy-event', 'legacy', NULL, 'decision',
          '2026-01-01T00:00:00.000Z', '{}', 458, 'T-LEGACY'
        );
        INSERT INTO workflow_executions VALUES (
          'legacy-workflow', 'legacy', 'test', 'S458', NULL, NULL, 'running',
          '{}', '[]', '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL
        );
        INSERT INTO workflow_executions VALUES (
          'non-sprint-workflow', 'legacy', 'test', 'R1', NULL, NULL, 'running',
          '{}', '[]', '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL
        );
        INSERT INTO workflow_executions VALUES (
          'trimmed-workflow', 'legacy', 'test', ' 458.10 ', NULL, NULL, 'running',
          '{}', '[]', '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL
        );
        INSERT INTO workflow_executions VALUES (
          'invalid-workflow', 'legacy', 'test', 'S0', NULL, NULL, 'running',
          '{}', '[]', '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL
        );
      `);

      const {
        LATEST_PG_SCHEMA_VERSION,
        PostgresSlopeStore,
      } = await import('../../src/store-pg/index.js');
      const migrated = new PostgresSlopeStore({ pool: schemaPool, projectId: 'legacy' });
      await migrated.migrate();

      expect(await migrated.getSchemaVersion()).toBe(LATEST_PG_SCHEMA_VERSION);
      expect((await migrated.list('458'))[0].sprint_number).toBe('458');
      expect((await migrated.listScorecards()).map(card => card.sprint_number)).toEqual(['435', '458']);
      expect((await migrated.getEventsBySprint('458'))[0].sprint_number).toBe('458');
      expect((await migrated.getExecutionBySprint('458'))?.sprint_id).toBe('458');
      expect((await migrated.getExecutionBySprint('458.10'))?.sprint_id).toBe('458.10');
      expect((await migrated.getExecutionBySprint('R1'))?.sprint_id).toBe('R1');
      expect((await migrated.getExecution('invalid-workflow'))?.sprint_id).toBe('S0');
      await expect(migrated.claim({
        sprint_number: '458',
        player: 'bob',
        target: 'T-LEGACY',
        scope: 'ticket',
      })).rejects.toMatchObject({ code: 'CLAIM_EXISTS' });

      const columns = await schemaPool.query(`
        SELECT table_name, data_type
        FROM information_schema.columns
        WHERE table_schema = $1
          AND column_name = 'sprint_number'
          AND table_name IN ('claims', 'scorecards', 'events')
        ORDER BY table_name
      `, [schema]);
      expect(columns.rows).toEqual([
        { table_name: 'claims', data_type: 'text' },
        { table_name: 'events', data_type: 'text' },
        { table_name: 'scorecards', data_type: 'text' },
      ]);

      const constraints = await schemaPool.query(`
        SELECT table_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_schema = $1
          AND (
            (table_name = 'claims' AND constraint_type = 'UNIQUE')
            OR (table_name = 'scorecards' AND constraint_type = 'PRIMARY KEY')
          )
        ORDER BY table_name
      `, [schema]);
      expect(constraints.rows).toEqual([
        { table_name: 'claims', constraint_type: 'UNIQUE' },
        { table_name: 'scorecards', constraint_type: 'PRIMARY KEY' },
      ]);
    } finally {
      await schemaPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  }, 15_000);
});
