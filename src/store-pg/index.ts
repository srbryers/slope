// SLOPE — PostgreSQL Storage Adapter
// Implements SlopeStore backed by PostgreSQL with JSONB and multi-tenancy.
// Requires the `pg` package: npm install pg

import type { SprintClaim, GolfScorecard, SlopeEvent, EventType } from '../core/types.js';
import type { CommonIssuesFile } from '../core/briefing.js';
import { SlopeStoreError } from '../core/store.js';
import type { SlopeStore, SlopeSession } from '../core/store.js';

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
      'SELECT * FROM claims WHERE project_id = $1 ORDER BY sprint_number, claimed_at',
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
    // Dynamic import of pg — user must have it installed
    const pgModule = await import('pg');
    const PgPool = pgModule.default?.Pool ?? pgModule.Pool;
    pool = new PgPool({ connectionString: opts.connectionString });
    ownedPool = true;
  } else {
    throw new Error('Either connectionString or pool is required');
  }

  const store = new PostgresSlopeStore({ pool, projectId: opts.projectId });
  // Set ownedPool directly since constructor can't handle connectionString
  (store as unknown as { ownedPool: boolean }).ownedPool = ownedPool;
  await store.migrate();
  return store;
}
