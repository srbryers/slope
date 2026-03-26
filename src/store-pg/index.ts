// SLOPE — PostgreSQL Storage Adapter
// Implements SlopeStore backed by PostgreSQL with JSONB and multi-tenancy.
// Requires the `pg` package: npm install pg

import type { SprintClaim, GolfScorecard, SlopeEvent, EventType, WorkflowExecution, WorkflowStepResult, CompletedStep } from '../core/types.js';
import type { CommonIssuesFile } from '../core/briefing.js';
import type { StoreStats } from '../core/store.js';
import { SlopeStoreError } from '../core/store.js';
import type { SlopeStore, SlopeSession } from '../core/store.js';
// EmbeddingStore not implemented for PG — hasEmbeddingSupport() returns false.
// Deferred to a future pgvector sprint.

// pg types — imported dynamically at runtime, typed here for compilation
type Pool = import('pg').Pool;
type PoolClient = import('pg').PoolClient;
type PoolConfig = import('pg').PoolConfig;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Parse a JSONB column — PostgreSQL returns objects directly, SQLite returns strings */
function parseJsonColumn(val: unknown): Record<string, unknown> {
  if (typeof val === 'string') return JSON.parse(val);
  if (typeof val === 'object' && val !== null) return val as Record<string, unknown>;
  return {};
}

function parseJsonColumnOrNull(val: unknown): Record<string, unknown> | undefined {
  if (val === null || val === undefined) return undefined;
  return parseJsonColumn(val);
}

// Advisory lock ID for migration concurrency safety
const MIGRATION_LOCK_ID = 8675309;

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL,
        ide TEXT NOT NULL,
        worktree_path TEXT,
        branch TEXT,
        started_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        metadata JSONB,
        agent_role TEXT,
        swarm_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_swarm ON sessions(swarm_id);

      CREATE TABLE IF NOT EXISTS claims (
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

      CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_id);

      CREATE TABLE IF NOT EXISTS scorecards (
        project_id TEXT NOT NULL DEFAULT 'default',
        sprint_number INTEGER NOT NULL,
        data JSONB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, sprint_number)
      );

      CREATE TABLE IF NOT EXISTS common_issues (
        project_id TEXT PRIMARY KEY DEFAULT 'default',
        data JSONB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        session_id TEXT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        sprint_number INTEGER,
        ticket_key TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_sprint ON events(sprint_number);
      CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_key);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS embeddings (
        id SERIAL PRIMARY KEY,
        file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        chunk_text TEXT NOT NULL,
        git_sha TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(file_path, chunk_index, model)
      );

      CREATE TABLE IF NOT EXISTS index_meta (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_sha TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_file ON embeddings(file_path);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS testing_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        branch TEXT,
        sprint INTEGER,
        purpose TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_testing_sessions_project ON testing_sessions(project_id);

      CREATE TABLE IF NOT EXISTS testing_findings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES testing_sessions(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        ticket TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_testing_findings_session ON testing_findings(session_id);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS workflow_executions (
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
        session_id TEXT
      );

      CREATE TABLE IF NOT EXISTS workflow_step_results (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        output JSONB,
        exit_code INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_wf_exec_project ON workflow_executions(project_id);
      CREATE INDEX IF NOT EXISTS idx_wf_exec_sprint ON workflow_executions(sprint_id);
      CREATE INDEX IF NOT EXISTS idx_wf_exec_session ON workflow_executions(session_id);
      CREATE INDEX IF NOT EXISTS idx_wf_step_exec ON workflow_step_results(execution_id);
    `,
  },
];

export interface PostgresStoreOptions {
  connectionString?: string;
  pool?: Pool;
  projectId?: string;
}

export class PostgresSlopeStore implements SlopeStore {
  private pool: Pool;
  private ownedPool: boolean;
  private projectId: string;
  private migrated = false;

  constructor(opts: PostgresStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
      this.ownedPool = false;
    } else if (opts.connectionString) {
      // Dynamic import already happened in createPostgresStore
      // We receive a pre-constructed pool
      throw new Error('Use createPostgresStore() factory instead of direct constructor with connectionString');
    } else {
      throw new Error('Either pool or connectionString is required');
    }
    this.projectId = opts.projectId ?? 'default';
  }

  /** Run schema migrations with transaction-scoped advisory lock for concurrency safety */
  async migrate(): Promise<void> {
    if (this.migrated) return;

    const client = await this.pool.connect();
    try {
      // Use transaction-scoped advisory lock — auto-releases on COMMIT or ROLLBACK,
      // so a migration failure never leaves a dangling lock in the pool.
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`);

      // Bootstrap schema_version table
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);

      const result = await client.query('SELECT MAX(version) as v FROM schema_version');
      const currentVersion: number = result.rows[0]?.v ?? 0;

      for (const migration of MIGRATIONS) {
        if (migration.version > currentVersion) {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO schema_version (version, applied_at) VALUES ($1, $2)',
            [migration.version, nowISO()],
          );
        }
      }

      await client.query('COMMIT');
      this.migrated = true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Diagnostics ---

  async getSchemaVersion(): Promise<number> {
    const result = await this.pool.query('SELECT MAX(version) as v FROM schema_version');
    return result.rows[0]?.v ?? 0;
  }

  async getStats(): Promise<StoreStats> {
    const result = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE project_id = $1) as sessions,
        (SELECT COUNT(*) FROM claims WHERE project_id = $1) as claims,
        (SELECT COUNT(*) FROM scorecards WHERE project_id = $1) as scorecards,
        (SELECT COUNT(*) FROM events WHERE project_id = $1) as events,
        (SELECT MAX(timestamp) FROM events WHERE project_id = $1) as "lastEventAt"
    `, [this.projectId]);
    const row = result.rows[0];
    return {
      sessions: parseInt(row.sessions, 10),
      claims: parseInt(row.claims, 10),
      scorecards: parseInt(row.scorecards, 10),
      events: parseInt(row.events, 10),
      lastEventAt: row.lastEventAt ?? null,
    };
  }

  // --- Sessions ---

  async registerSession(session: Omit<SlopeSession, 'started_at' | 'last_heartbeat_at'>): Promise<SlopeSession> {
    const now = nowISO();
    const full: SlopeSession = {
      ...session,
      started_at: now,
      last_heartbeat_at: now,
    };

    try {
      await this.pool.query(`
        INSERT INTO sessions (session_id, project_id, role, ide, worktree_path, branch, started_at, last_heartbeat_at, metadata, agent_role, swarm_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        full.session_id,
        this.projectId,
        full.role,
        full.ide,
        full.worktree_path ?? null,
        full.branch ?? null,
        full.started_at,
        full.last_heartbeat_at,
        full.metadata ? JSON.stringify(full.metadata) : null,
        full.agent_role ?? null,
        full.swarm_id ?? null,
      ]);
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('duplicate key') || err.message.includes('unique constraint'))) {
        throw new SlopeStoreError('SESSION_CONFLICT', `Session "${session.session_id}" already exists`);
      }
      throw err;
    }

    return full;
  }

  async removeSession(sessionId: string): Promise<boolean> {
    // Delete claims first (no FK cascade in PG schema)
    await this.pool.query(
      'DELETE FROM claims WHERE session_id = $1 AND project_id = $2',
      [sessionId, this.projectId],
    );
    const result = await this.pool.query(
      'DELETE FROM sessions WHERE session_id = $1 AND project_id = $2',
      [sessionId, this.projectId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getActiveSessions(): Promise<SlopeSession[]> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE project_id = $1 ORDER BY started_at DESC',
      [this.projectId],
    );
    return result.rows.map(rowToSession);
  }

  async getSessionsBySwarm(swarmId: string): Promise<SlopeSession[]> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE swarm_id = $1 AND project_id = $2 ORDER BY started_at',
      [swarmId, this.projectId],
    );
    return result.rows.map(rowToSession);
  }

  async updateHeartbeat(sessionId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE sessions SET last_heartbeat_at = $1 WHERE session_id = $2 AND project_id = $3',
      [nowISO(), sessionId, this.projectId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new SlopeStoreError('NOT_FOUND', `Session "${sessionId}" not found`);
    }
  }

  async cleanStaleSessions(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    // Delete claims for stale sessions first
    await this.pool.query(`
      DELETE FROM claims WHERE session_id IN (
        SELECT session_id FROM sessions WHERE last_heartbeat_at < $1 AND project_id = $2
      ) AND project_id = $2
    `, [cutoff, this.projectId]);
    const result = await this.pool.query(
      'DELETE FROM sessions WHERE last_heartbeat_at < $1 AND project_id = $2',
      [cutoff, this.projectId],
    );
    return result.rowCount ?? 0;
  }

  // --- Claims (SprintRegistry + extensions) ---

  async claim(input: Omit<SprintClaim, 'id' | 'claimed_at'>): Promise<SprintClaim> {
    const claim: SprintClaim = {
      id: generateId('claim'),
      claimed_at: nowISO(),
      ...input,
    };

    try {
      await this.pool.query(`
        INSERT INTO claims (id, project_id, session_id, sprint_number, target, player, scope, claimed_at, expires_at, notes, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        claim.id,
        this.projectId,
        claim.session_id ?? null,
        claim.sprint_number,
        claim.target,
        claim.player,
        claim.scope,
        claim.claimed_at,
        claim.expires_at ?? null,
        claim.notes ?? null,
        claim.metadata ? JSON.stringify(claim.metadata) : null,
      ]);
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('duplicate key') || err.message.includes('unique constraint'))) {
        throw new SlopeStoreError('CLAIM_EXISTS', `Claim already exists for target "${input.target}" in sprint ${input.sprint_number}`);
      }
      throw err;
    }

    return claim;
  }

  async release(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM claims WHERE id = $1 AND project_id = $2',
      [id, this.projectId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(sprintNumber: number): Promise<SprintClaim[]> {
    const result = await this.pool.query(
      'SELECT * FROM claims WHERE sprint_number = $1 AND project_id = $2 ORDER BY claimed_at',
      [sprintNumber, this.projectId],
    );
    return result.rows.map(rowToClaim);
  }

  async get(id: string): Promise<SprintClaim | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM claims WHERE id = $1 AND project_id = $2',
      [id, this.projectId],
    );
    return result.rows.length > 0 ? rowToClaim(result.rows[0]) : undefined;
  }

  async getActiveClaims(sprintNumber?: number): Promise<SprintClaim[]> {
    if (sprintNumber !== undefined) {
      return this.list(sprintNumber);
    }
    const result = await this.pool.query(
      'SELECT * FROM claims WHERE project_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY sprint_number, claimed_at',
      [this.projectId],
    );
    return result.rows.map(rowToClaim);
  }

  // --- Scorecards ---

  async saveScorecard(card: GolfScorecard): Promise<void> {
    const now = nowISO();
    await this.pool.query(`
      INSERT INTO scorecards (project_id, sprint_number, data, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(project_id, sprint_number) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `, [this.projectId, card.sprint_number, JSON.stringify(card), now, now]);
  }

  async listScorecards(filter?: { minSprint?: number; maxSprint?: number }): Promise<GolfScorecard[]> {
    let sql = 'SELECT data FROM scorecards WHERE project_id = $1';
    const params: unknown[] = [this.projectId];
    let idx = 2;

    if (filter?.minSprint !== undefined) {
      sql += ` AND sprint_number >= $${idx}`;
      params.push(filter.minSprint);
      idx++;
    }
    if (filter?.maxSprint !== undefined) {
      sql += ` AND sprint_number <= $${idx}`;
      params.push(filter.maxSprint);
      idx++;
    }
    sql += ' ORDER BY sprint_number';

    const result = await this.pool.query(sql, params);
    return result.rows.map(r => {
      const data = r.data;
      return (typeof data === 'string' ? JSON.parse(data) : data) as GolfScorecard;
    });
  }

  // --- Common Issues ---

  async loadCommonIssues(): Promise<CommonIssuesFile> {
    const result = await this.pool.query(
      'SELECT data FROM common_issues WHERE project_id = $1',
      [this.projectId],
    );
    if (result.rows.length === 0) {
      return { recurring_patterns: [] };
    }
    const data = result.rows[0].data;
    return (typeof data === 'string' ? JSON.parse(data) : data) as CommonIssuesFile;
  }

  async saveCommonIssues(issues: CommonIssuesFile): Promise<void> {
    await this.pool.query(`
      INSERT INTO common_issues (project_id, data, updated_at) VALUES ($1, $2, $3)
      ON CONFLICT(project_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `, [this.projectId, JSON.stringify(issues), nowISO()]);
  }

  // --- Events ---

  async insertEvent(event: Omit<SlopeEvent, 'id' | 'timestamp'>): Promise<SlopeEvent> {
    const full: SlopeEvent = {
      id: generateId('evt'),
      timestamp: nowISO(),
      ...event,
    };

    await this.pool.query(`
      INSERT INTO events (id, project_id, session_id, type, timestamp, data, sprint_number, ticket_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(id) DO NOTHING
    `, [
      full.id,
      this.projectId,
      full.session_id ?? null,
      full.type,
      full.timestamp,
      JSON.stringify(full.data),
      full.sprint_number ?? null,
      full.ticket_key ?? null,
    ]);

    return full;
  }

  async getEventsBySession(sessionId: string): Promise<SlopeEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE session_id = $1 AND project_id = $2 ORDER BY timestamp',
      [sessionId, this.projectId],
    );
    return result.rows.map(rowToEvent);
  }

  async getEventsBySprint(sprintNumber: number): Promise<SlopeEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE sprint_number = $1 AND project_id = $2 ORDER BY timestamp',
      [sprintNumber, this.projectId],
    );
    return result.rows.map(rowToEvent);
  }

  async getEventsByTicket(ticketKey: string): Promise<SlopeEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE ticket_key = $1 AND project_id = $2 ORDER BY timestamp',
      [ticketKey, this.projectId],
    );
    return result.rows.map(rowToEvent);
  }

  // --- Testing Sessions ---

  async createTestingSession(session: { branch?: string; sprint?: number; purpose?: string; worktree_path?: string; branch_name?: string }): Promise<{ id: string; started_at: string }> {
    const id = generateId('tsess');
    const started_at = nowISO();
    await this.pool.query(`
      INSERT INTO testing_sessions (id, project_id, branch, sprint, purpose, worktree_path, branch_name, started_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
    `, [id, this.projectId, session.branch ?? null, session.sprint ?? null, session.purpose ?? null, session.worktree_path ?? null, session.branch_name ?? null, started_at]);
    return { id, started_at };
  }

  async endTestingSession(sessionId: string): Promise<{ ended_at: string; finding_count: number; worktree_path?: string; branch_name?: string }> {
    const ended_at = nowISO();
    const { rows } = await this.pool.query(
      'SELECT worktree_path, branch_name FROM testing_sessions WHERE id = $1 AND status = $2 AND project_id = $3',
      [sessionId, 'active', this.projectId],
    );
    if (rows.length === 0) {
      throw new SlopeStoreError('NOT_FOUND', `Active testing session "${sessionId}" not found`);
    }
    await this.pool.query('UPDATE testing_sessions SET status = $1, ended_at = $2 WHERE id = $3', ['ended', ended_at, sessionId]);
    const countResult = await this.pool.query('SELECT COUNT(*) as c FROM testing_findings WHERE session_id = $1', [sessionId]);
    return {
      ended_at,
      finding_count: parseInt(countResult.rows[0].c, 10),
      worktree_path: rows[0].worktree_path ?? undefined,
      branch_name: rows[0].branch_name ?? undefined,
    };
  }

  async getActiveTestingSession(): Promise<{ id: string; branch?: string; sprint?: number; purpose?: string; worktree_path?: string; branch_name?: string; started_at: string } | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM testing_sessions WHERE status = $1 AND project_id = $2 ORDER BY started_at DESC LIMIT 1',
      ['active', this.projectId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      branch: row.branch ?? undefined,
      sprint: row.sprint ?? undefined,
      purpose: row.purpose ?? undefined,
      worktree_path: row.worktree_path ?? undefined,
      branch_name: row.branch_name ?? undefined,
      started_at: row.started_at,
    };
  }

  async addTestingFinding(finding: { session_id: string; description: string; severity?: string; ticket?: string }): Promise<{ id: string }> {
    const id = generateId('tfind');
    await this.pool.query(`
      INSERT INTO testing_findings (id, session_id, description, severity, ticket, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, finding.session_id, finding.description, finding.severity ?? 'medium', finding.ticket ?? null, nowISO()]);
    return { id };
  }

  async getTestingFindings(sessionId: string): Promise<Array<{ id: string; description: string; severity: string; ticket?: string; created_at: string }>> {
    const { rows } = await this.pool.query(
      'SELECT * FROM testing_findings WHERE session_id = $1 ORDER BY created_at',
      [sessionId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      description: r.description as string,
      severity: r.severity as string,
      ticket: (r.ticket as string | null) ?? undefined,
      created_at: r.created_at as string,
    }));
  }

  // --- Workflow Executions ---

  async startExecution(params: { workflow_name: string; sprint_id?: string; variables?: Record<string, string>; session_id?: string }): Promise<WorkflowExecution> {
    const id = generateId('wf');
    const now = nowISO();
    const execution: WorkflowExecution = {
      id,
      workflow_name: params.workflow_name,
      sprint_id: params.sprint_id,
      current_phase: undefined,
      current_step: undefined,
      status: 'running',
      variables: params.variables ?? {},
      completed_steps: [],
      started_at: now,
      updated_at: now,
      session_id: params.session_id,
    };

    await this.pool.query(`
      INSERT INTO workflow_executions (id, project_id, workflow_name, sprint_id, current_phase, current_step, status, variables, completed_steps, started_at, updated_at, session_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      execution.id,
      this.projectId,
      execution.workflow_name,
      execution.sprint_id ?? null,
      execution.current_phase ?? null,
      execution.current_step ?? null,
      execution.status,
      JSON.stringify(execution.variables),
      JSON.stringify(execution.completed_steps),
      execution.started_at,
      execution.updated_at,
      execution.session_id ?? null,
    ]);

    return execution;
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM workflow_executions WHERE id = $1 AND project_id = $2',
      [executionId, this.projectId],
    );
    return rows.length > 0 ? rowToExecution(rows[0]) : null;
  }

  async getExecutionBySprint(sprintId: string): Promise<WorkflowExecution | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM workflow_executions WHERE sprint_id = $1 AND project_id = $2 AND status NOT IN ('completed', 'failed') ORDER BY started_at DESC LIMIT 1",
      [sprintId, this.projectId],
    );
    return rows.length > 0 ? rowToExecution(rows[0]) : null;
  }

  async updateExecutionState(executionId: string, phase: string, step: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE workflow_executions SET current_phase = $1, current_step = $2, updated_at = $3 WHERE id = $4 AND project_id = $5',
      [phase, step, nowISO(), executionId, this.projectId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new SlopeStoreError('NOT_FOUND', `Workflow execution "${executionId}" not found`);
    }
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'paused' | 'running'): Promise<void> {
    const result = await this.pool.query(
      'UPDATE workflow_executions SET status = $1, updated_at = $2 WHERE id = $3 AND project_id = $4',
      [status, nowISO(), executionId, this.projectId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new SlopeStoreError('NOT_FOUND', `Workflow execution "${executionId}" not found`);
    }
  }

  async recordStepResult(params: { execution_id: string; step_id: string; phase: string; status: 'completed' | 'skipped' | 'failed'; output?: Record<string, unknown>; exit_code?: number; item?: string; started_at?: string }): Promise<WorkflowStepResult> {
    const id = generateId('wfs');
    const now = nowISO();
    const stepResult: WorkflowStepResult = {
      id,
      execution_id: params.execution_id,
      step_id: params.step_id,
      phase: params.phase,
      status: params.status,
      output: params.output,
      exit_code: params.exit_code,
      started_at: params.started_at ?? now,
      completed_at: now,
    };

    // Wrap INSERT + completed_steps UPDATE in a transaction to keep them atomic.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO workflow_step_results (id, execution_id, step_id, phase, status, output, exit_code, started_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        stepResult.id,
        stepResult.execution_id,
        stepResult.step_id,
        stepResult.phase,
        stepResult.status,
        stepResult.output ? JSON.stringify(stepResult.output) : null,
        stepResult.exit_code ?? null,
        stepResult.started_at,
        stepResult.completed_at ?? null,
      ]);

      // Update completed_steps on the execution (JSONB append)
      const entry: CompletedStep = { step_id: params.step_id, phase: params.phase, status: params.status };
      if (params.item) entry.item = params.item;
      await client.query(
        `UPDATE workflow_executions SET completed_steps = completed_steps || $1::jsonb, updated_at = $2 WHERE id = $3`,
        [JSON.stringify([entry]), nowISO(), params.execution_id],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return stepResult;
  }

  async listExecutions(filter?: { sprint_id?: string; status?: string }): Promise<WorkflowExecution[]> {
    let sql = 'SELECT * FROM workflow_executions WHERE project_id = $1';
    const params: unknown[] = [this.projectId];
    let idx = 2;

    if (filter?.sprint_id) {
      sql += ` AND sprint_id = $${idx}`;
      params.push(filter.sprint_id);
      idx++;
    }
    if (filter?.status) {
      sql += ` AND status = $${idx}`;
      params.push(filter.status);
      idx++;
    }
    sql += ' ORDER BY started_at DESC';

    const { rows } = await this.pool.query(sql, params);
    return rows.map(rowToExecution);
  }

  // --- Lifecycle ---

  close(): void {
    if (this.ownedPool) {
      this.pool.end();
    }
  }
}

// --- Row mappers ---

function rowToSession(row: Record<string, unknown>): SlopeSession {
  return {
    session_id: row.session_id as string,
    role: row.role as SlopeSession['role'],
    ide: row.ide as string,
    worktree_path: (row.worktree_path as string | null) ?? undefined,
    branch: (row.branch as string | null) ?? undefined,
    started_at: row.started_at as string,
    last_heartbeat_at: row.last_heartbeat_at as string,
    metadata: parseJsonColumnOrNull(row.metadata),
    agent_role: (row.agent_role as string | null) ?? undefined,
    swarm_id: (row.swarm_id as string | null) ?? undefined,
  };
}

function rowToClaim(row: Record<string, unknown>): SprintClaim {
  return {
    id: row.id as string,
    sprint_number: row.sprint_number as number,
    player: row.player as string,
    target: row.target as string,
    scope: row.scope as SprintClaim['scope'],
    claimed_at: row.claimed_at as string,
    notes: (row.notes as string | null) ?? undefined,
    session_id: (row.session_id as string | null) ?? undefined,
    expires_at: (row.expires_at as string | null) ?? undefined,
    metadata: parseJsonColumnOrNull(row.metadata),
  };
}

function rowToEvent(row: Record<string, unknown>): SlopeEvent {
  return {
    id: row.id as string,
    session_id: (row.session_id as string | null) ?? undefined,
    type: row.type as EventType,
    timestamp: row.timestamp as string,
    data: parseJsonColumn(row.data),
    sprint_number: (row.sprint_number as number | null) ?? undefined,
    ticket_key: (row.ticket_key as string | null) ?? undefined,
  };
}

function rowToExecution(row: Record<string, unknown>): WorkflowExecution {
  const variables = parseJsonColumn(row.variables) as Record<string, string>;
  const completedRaw = row.completed_steps;
  const completed_steps: CompletedStep[] = Array.isArray(completedRaw)
    ? completedRaw
    : typeof completedRaw === 'string'
      ? JSON.parse(completedRaw)
      : [];

  return {
    id: row.id as string,
    workflow_name: row.workflow_name as string,
    sprint_id: (row.sprint_id as string | null) ?? undefined,
    current_phase: (row.current_phase as string | null) ?? undefined,
    current_step: (row.current_step as string | null) ?? undefined,
    status: row.status as WorkflowExecution['status'],
    variables,
    completed_steps,
    started_at: row.started_at as string,
    updated_at: row.updated_at as string,
    session_id: (row.session_id as string | null) ?? undefined,
  };
}

/** Create a PostgreSQL-backed SlopeStore. Requires `pg` package to be installed. */
export async function createPostgresStore(opts: {
  connectionString?: string;
  pool?: unknown;
  projectId?: string;
}): Promise<SlopeStore> {
  let pool: Pool;
  let ownedPool: boolean;

  if (opts.pool) {
    pool = opts.pool as Pool;
    ownedPool = false;
  } else if (opts.connectionString) {
    const url = opts.connectionString;
    // Validate connection string format
    if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
      throw new Error('Invalid PostgreSQL connection string. Must start with "postgres://" or "postgresql://".');
    }
    try {
      const parsed = new URL(url);
      if (!parsed.hostname) throw new Error('must include hostname');
      if (!parsed.pathname || parsed.pathname === '/') throw new Error('must include database name');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Invalid PostgreSQL')) throw err;
      throw new Error(`Invalid PostgreSQL connection string: ${(err as Error).message}`);
    }
    // Dynamic import of pg — user must have it installed
    const pgModule = await import('pg');
    const PgPool = pgModule.default?.Pool ?? pgModule.Pool;
    pool = new PgPool({ connectionString: url });
    ownedPool = true;

    // Validate connection — fail fast with helpful message
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      pool.end();
      throw new Error(`PostgreSQL connection failed: ${(err as Error).message}. Check your connection string.`);
    }
  } else {
    throw new Error('Either connectionString or pool is required');
  }

  const store = new PostgresSlopeStore({ pool, projectId: opts.projectId });
  // Set ownedPool directly since constructor can't handle connectionString
  (store as unknown as { ownedPool: boolean }).ownedPool = ownedPool;
  await store.migrate();
  return store;
}
