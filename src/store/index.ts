// SLOPE — SQLite Storage Adapter
// Implements SlopeStore + EmbeddingStore backed by better-sqlite3 with WAL mode.

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { SprintClaim, GolfScorecard, SlopeEvent, EventType } from '../core/index.js';
import type { CommonIssuesFile, StoreStats } from '../core/index.js';
import { SlopeStoreError } from '../core/index.js';
import type { SlopeStore, SlopeSession } from '../core/index.js';
import type { EmbeddingStore, EmbeddingEntry, EmbeddingSearchResult, EmbeddingStats, IndexMeta } from '../core/embedding-store.js';

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Sequential schema migrations — each runs exactly once */
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        ide TEXT NOT NULL,
        worktree_path TEXT,
        branch TEXT,
        started_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
        sprint_number INTEGER NOT NULL,
        target TEXT NOT NULL,
        player TEXT NOT NULL,
        scope TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        expires_at TEXT,
        notes TEXT,
        metadata TEXT,
        UNIQUE(sprint_number, scope, target)
      );

      CREATE TABLE IF NOT EXISTS scorecards (
        sprint_number INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS common_issues (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        sprint_number INTEGER,
        ticket_key TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_sprint ON events(sprint_number);
      CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_key);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE sessions ADD COLUMN agent_role TEXT;
      ALTER TABLE sessions ADD COLUMN swarm_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_sessions_swarm ON sessions(swarm_id);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      CREATE INDEX IF NOT EXISTS idx_embeddings_sha ON embeddings(git_sha);
      CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS testing_sessions (
        id TEXT PRIMARY KEY,
        branch TEXT,
        sprint INTEGER,
        purpose TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );

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
];

/** Latest schema version — total number of migrations available. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

export class SqliteSlopeStore implements SlopeStore, EmbeddingStore {
  private db: DatabaseType;
  private vecAvailable = false;
  private vecLoaded = false;
  private vecTableReady = false;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureVecLoaded();
    this.migrate();
  }

  /** Lazy-load sqlite-vec extension. Non-fatal if unavailable — embedding methods will throw. */
  private ensureVecLoaded(): void {
    if (this.vecLoaded) return;
    this.vecLoaded = true;
    try {
      // Dynamic require — sqlite-vec is a native addon, needs require() not import()
      const esmRequire = createRequire(import.meta.url);
      const sqliteVec = esmRequire('sqlite-vec');
      sqliteVec.load(this.db);
      this.vecAvailable = true;
    } catch {
      // Extension not available — store still works for non-embedding operations
    }
  }

  /** Require sqlite-vec to be available. Throws if not. */
  private requireVec(): void {
    this.ensureVecLoaded();
    if (!this.vecAvailable) {
      throw new SlopeStoreError('EXTENSION_UNAVAILABLE',
        'sqlite-vec extension not available. Install sqlite-vec: npm install sqlite-vec');
    }
  }

  /** Check if vec_embeddings virtual table exists, creating it if index_meta has dimensions. */
  private ensureVecTable(): void {
    if (this.vecTableReady) return;
    // Check if the table already exists
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'"
    ).get();
    if (exists) {
      this.vecTableReady = true;
      return;
    }
    // Try to create from index_meta dimensions
    const meta = this.db.prepare('SELECT dimensions FROM index_meta WHERE id = 1').get() as { dimensions: number } | undefined;
    if (meta) {
      this.db.exec(`CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[${meta.dimensions}])`);
      this.vecTableReady = true;
    }
    // If no meta yet, table will be created by recreateVecTable() on first index
  }

  /** Versioned migration framework — runs each migration exactly once */
  private migrate(): void {
    // Bootstrap schema_version table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const currentVersion = this.getSchemaVersionSync();

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
          .run(migration.version, nowISO());
      }
    }

    // Note: vec_embeddings virtual table is NOT created in migrate() — it is created
    // lazily by recreateVecTable() on first `slope index` with the configured dimensions.
    // This avoids hardcoding a dimension size that may not match the user's model config.
  }

  /** Get current schema version synchronously (internal use by migrate()) */
  private getSchemaVersionSync(): number {
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null } | undefined;
    return row?.v ?? 0;
  }

  /** Get current schema version (0 if no migrations applied) */
  async getSchemaVersion(): Promise<number> {
    return this.getSchemaVersionSync();
  }

  /** Get aggregate row counts from all store tables */
  async getStats(): Promise<StoreStats> {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sessions) as sessions,
        (SELECT COUNT(*) FROM claims) as claims,
        (SELECT COUNT(*) FROM scorecards) as scorecards,
        (SELECT COUNT(*) FROM events) as events,
        (SELECT MAX(timestamp) FROM events) as lastEventAt
    `).get() as { sessions: number; claims: number; scorecards: number; events: number; lastEventAt: string | null };
    return {
      sessions: row.sessions,
      claims: row.claims,
      scorecards: row.scorecards,
      events: row.events,
      lastEventAt: row.lastEventAt,
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
      this.db.prepare(`
        INSERT INTO sessions (session_id, role, ide, worktree_path, branch, started_at, last_heartbeat_at, metadata, agent_role, swarm_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        full.session_id,
        full.role,
        full.ide,
        full.worktree_path ?? null,
        full.branch ?? null,
        full.started_at,
        full.last_heartbeat_at,
        full.metadata ? JSON.stringify(full.metadata) : null,
        full.agent_role ?? null,
        full.swarm_id ?? null,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        throw new SlopeStoreError('SESSION_CONFLICT', `Session "${session.session_id}" already exists`);
      }
      throw err;
    }

    return full;
  }

  async removeSession(sessionId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    return result.changes > 0;
  }

  async getActiveSessions(): Promise<SlopeSession[]> {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map(rowToSession);
  }

  async getSessionsBySwarm(swarmId: string): Promise<SlopeSession[]> {
    const rows = this.db.prepare('SELECT * FROM sessions WHERE swarm_id = ? ORDER BY started_at')
      .all(swarmId) as Array<Record<string, unknown>>;
    return rows.map(rowToSession);
  }

  async updateHeartbeat(sessionId: string): Promise<void> {
    const result = this.db.prepare('UPDATE sessions SET last_heartbeat_at = ? WHERE session_id = ?')
      .run(nowISO(), sessionId);
    if (result.changes === 0) {
      throw new SlopeStoreError('NOT_FOUND', `Session "${sessionId}" not found`);
    }
  }

  async cleanStaleSessions(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db.prepare('DELETE FROM sessions WHERE last_heartbeat_at < ?').run(cutoff);
    return result.changes;
  }

  // --- Claims (SprintRegistry + extensions) ---

  async claim(input: Omit<SprintClaim, 'id' | 'claimed_at'>): Promise<SprintClaim> {
    const claim: SprintClaim = {
      id: generateId('claim'),
      claimed_at: nowISO(),
      ...input,
    };

    try {
      this.db.prepare(`
        INSERT INTO claims (id, session_id, sprint_number, target, player, scope, claimed_at, expires_at, notes, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claim.id,
        claim.session_id ?? null,
        claim.sprint_number,
        claim.target,
        claim.player,
        claim.scope,
        claim.claimed_at,
        claim.expires_at ?? null,
        claim.notes ?? null,
        claim.metadata ? JSON.stringify(claim.metadata) : null,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        throw new SlopeStoreError('CLAIM_EXISTS', `Claim already exists for target "${input.target}" in sprint ${input.sprint_number}`);
      }
      throw err;
    }

    return claim;
  }

  async release(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM claims WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async list(sprintNumber: number): Promise<SprintClaim[]> {
    const rows = this.db.prepare('SELECT * FROM claims WHERE sprint_number = ? ORDER BY claimed_at')
      .all(sprintNumber) as Array<Record<string, unknown>>;
    return rows.map(rowToClaim);
  }

  async get(id: string): Promise<SprintClaim | undefined> {
    const row = this.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToClaim(row) : undefined;
  }

  async getActiveClaims(sprintNumber?: number): Promise<SprintClaim[]> {
    if (sprintNumber !== undefined) {
      return this.list(sprintNumber);
    }
    const rows = this.db.prepare('SELECT * FROM claims ORDER BY sprint_number, claimed_at')
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToClaim);
  }

  // --- Scorecards ---

  async saveScorecard(card: GolfScorecard): Promise<void> {
    const now = nowISO();
    this.db.prepare(`
      INSERT INTO scorecards (sprint_number, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sprint_number) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(card.sprint_number, JSON.stringify(card), now, now);
  }

  async listScorecards(filter?: { minSprint?: number; maxSprint?: number }): Promise<GolfScorecard[]> {
    let sql = 'SELECT data FROM scorecards WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.minSprint !== undefined) {
      sql += ' AND sprint_number >= ?';
      params.push(filter.minSprint);
    }
    if (filter?.maxSprint !== undefined) {
      sql += ' AND sprint_number <= ?';
      params.push(filter.maxSprint);
    }
    sql += ' ORDER BY sprint_number';

    const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
    return rows.map(r => JSON.parse(r.data) as GolfScorecard);
  }

  // --- Common Issues ---

  async loadCommonIssues(): Promise<CommonIssuesFile> {
    const row = this.db.prepare('SELECT data FROM common_issues WHERE id = 1').get() as { data: string } | undefined;
    if (!row) {
      return { recurring_patterns: [] };
    }
    return JSON.parse(row.data) as CommonIssuesFile;
  }

  async saveCommonIssues(issues: CommonIssuesFile): Promise<void> {
    this.db.prepare(`
      INSERT INTO common_issues (id, data, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(JSON.stringify(issues), nowISO());
  }

  // --- Events ---

  async insertEvent(event: Omit<SlopeEvent, 'id' | 'timestamp'>): Promise<SlopeEvent> {
    const full: SlopeEvent = {
      id: generateId('evt'),
      timestamp: nowISO(),
      ...event,
    };

    this.db.prepare(`
      INSERT INTO events (id, session_id, type, timestamp, data, sprint_number, ticket_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id,
      full.session_id ?? null,
      full.type,
      full.timestamp,
      JSON.stringify(full.data),
      full.sprint_number ?? null,
      full.ticket_key ?? null,
    );

    return full;
  }

  async getEventsBySession(sessionId: string): Promise<SlopeEvent[]> {
    const rows = this.db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY timestamp')
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  async getEventsBySprint(sprintNumber: number): Promise<SlopeEvent[]> {
    const rows = this.db.prepare('SELECT * FROM events WHERE sprint_number = ? ORDER BY timestamp')
      .all(sprintNumber) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  async getEventsByTicket(ticketKey: string): Promise<SlopeEvent[]> {
    const rows = this.db.prepare('SELECT * FROM events WHERE ticket_key = ? ORDER BY timestamp')
      .all(ticketKey) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  // --- Testing Sessions ---

  async createTestingSession(session: { branch?: string; sprint?: number; purpose?: string; worktree_path?: string; branch_name?: string }): Promise<{ id: string; started_at: string }> {
    const id = generateId('tsess');
    const started_at = nowISO();
    this.db.prepare(`
      INSERT INTO testing_sessions (id, branch, sprint, purpose, worktree_path, branch_name, started_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(id, session.branch ?? null, session.sprint ?? null, session.purpose ?? null, session.worktree_path ?? null, session.branch_name ?? null, started_at);
    return { id, started_at };
  }

  async endTestingSession(sessionId: string): Promise<{ ended_at: string; finding_count: number; worktree_path?: string; branch_name?: string }> {
    const ended_at = nowISO();
    const row = this.db.prepare('SELECT worktree_path, branch_name FROM testing_sessions WHERE id = ? AND status = ?').get(sessionId, 'active') as { worktree_path: string | null; branch_name: string | null } | undefined;
    if (!row) {
      throw new SlopeStoreError('NOT_FOUND', `Active testing session "${sessionId}" not found`);
    }
    this.db.prepare('UPDATE testing_sessions SET status = ?, ended_at = ? WHERE id = ?').run('ended', ended_at, sessionId);
    const countRow = this.db.prepare('SELECT COUNT(*) as c FROM testing_findings WHERE session_id = ?').get(sessionId) as { c: number };
    return {
      ended_at,
      finding_count: countRow.c,
      worktree_path: row.worktree_path ?? undefined,
      branch_name: row.branch_name ?? undefined,
    };
  }

  async getActiveTestingSession(): Promise<{ id: string; branch?: string; sprint?: number; purpose?: string; worktree_path?: string; branch_name?: string; started_at: string } | null> {
    const row = this.db.prepare('SELECT * FROM testing_sessions WHERE status = ? ORDER BY started_at DESC LIMIT 1').get('active') as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      branch: (row.branch as string | null) ?? undefined,
      sprint: (row.sprint as number | null) ?? undefined,
      purpose: (row.purpose as string | null) ?? undefined,
      worktree_path: (row.worktree_path as string | null) ?? undefined,
      branch_name: (row.branch_name as string | null) ?? undefined,
      started_at: row.started_at as string,
    };
  }

  async addTestingFinding(finding: { session_id: string; description: string; severity?: string; ticket?: string }): Promise<{ id: string }> {
    const id = generateId('tfind');
    this.db.prepare(`
      INSERT INTO testing_findings (id, session_id, description, severity, ticket, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, finding.session_id, finding.description, finding.severity ?? 'medium', finding.ticket ?? null, nowISO());
    return { id };
  }

  async getTestingFindings(sessionId: string): Promise<Array<{ id: string; description: string; severity: string; ticket?: string; created_at: string }>> {
    const rows = this.db.prepare('SELECT * FROM testing_findings WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      description: r.description as string,
      severity: r.severity as string,
      ticket: (r.ticket as string | null) ?? undefined,
      created_at: r.created_at as string,
    }));
  }

  // --- Embeddings ---

  async saveEmbeddings(entries: EmbeddingEntry[]): Promise<void> {
    this.requireVec();
    this.ensureVecTable();

    const insertEmbedding = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (file_path, chunk_index, chunk_text, git_sha, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const deleteVec = this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?');
    const insertVec = this.db.prepare('INSERT INTO vec_embeddings(rowid, embedding) VALUES (?, ?)');

    const txn = this.db.transaction((items: EmbeddingEntry[]) => {
      for (const entry of items) {
        const result = insertEmbedding.run(
          entry.filePath, entry.chunkIndex, entry.chunkText,
          entry.gitSha, entry.model, nowISO(),
        );
        // vec0 requires BigInt rowids — better-sqlite3 only sends true SQLite integers for BigInt
        const rowid = typeof result.lastInsertRowid === 'bigint'
          ? result.lastInsertRowid
          : BigInt(result.lastInsertRowid);
        deleteVec.run(rowid);
        insertVec.run(rowid, entry.vector);
      }
    });

    txn(entries);
  }

  async searchEmbeddings(queryVector: Float32Array, limit = 10): Promise<EmbeddingSearchResult[]> {
    this.requireVec();
    this.ensureVecTable();

    const results = this.db.prepare(`
      SELECT v.rowid, v.distance, e.file_path, e.chunk_index, e.chunk_text
      FROM vec_embeddings v
      JOIN embeddings e ON e.id = v.rowid
      WHERE v.embedding MATCH ? AND k = ?
      ORDER BY v.distance
    `).all(queryVector, limit) as Array<{
      rowid: number;
      distance: number;
      file_path: string;
      chunk_index: number;
      chunk_text: string;
    }>;

    return results.map(r => ({
      id: r.rowid,
      filePath: r.file_path,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      score: 1 / (1 + r.distance),
    }));
  }

  async getIndexedFiles(): Promise<Array<{ filePath: string; gitSha: string; model: string }>> {
    const rows = this.db.prepare(`
      SELECT DISTINCT file_path, git_sha, model FROM embeddings ORDER BY file_path
    `).all() as Array<{ file_path: string; git_sha: string; model: string }>;

    return rows.map(r => ({
      filePath: r.file_path,
      gitSha: r.git_sha,
      model: r.model,
    }));
  }

  async deleteEmbeddingsByFile(filePath: string): Promise<void> {
    this.requireVec();
    this.ensureVecTable();

    const selectIds = this.db.prepare('SELECT id FROM embeddings WHERE file_path = ?');
    const deleteVecRow = this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?');
    const deleteEmbRows = this.db.prepare('DELETE FROM embeddings WHERE file_path = ?');

    const txn = this.db.transaction((fp: string) => {
      const rows = selectIds.all(fp) as Array<{ id: number | bigint }>;
      for (const row of rows) {
        const rowid = typeof row.id === 'bigint' ? row.id : BigInt(row.id);
        deleteVecRow.run(rowid);
      }
      deleteEmbRows.run(fp);
    });

    txn(filePath);
  }

  async getEmbeddingStats(): Promise<EmbeddingStats> {
    const row = this.db.prepare(`
      SELECT
        COUNT(DISTINCT file_path) as fileCount,
        COUNT(*) as chunkCount,
        MAX(created_at) as lastIndexedAt
      FROM embeddings
    `).get() as { fileCount: number; chunkCount: number; lastIndexedAt: string | null };

    const meta = await this.getIndexMeta();
    return {
      fileCount: row.fileCount,
      chunkCount: row.chunkCount,
      model: meta?.model ?? null,
      dimensions: meta?.dimensions ?? null,
      lastIndexedAt: row.lastIndexedAt,
      lastIndexedSha: meta?.sha ?? null,
    };
  }

  async setIndexMeta(sha: string, model: string, dimensions: number): Promise<void> {
    this.db.prepare(`
      INSERT INTO index_meta (id, last_sha, model, dimensions, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_sha = excluded.last_sha, model = excluded.model,
        dimensions = excluded.dimensions, updated_at = excluded.updated_at
    `).run(sha, model, dimensions, nowISO());
  }

  async getIndexMeta(): Promise<IndexMeta | null> {
    const row = this.db.prepare('SELECT last_sha, model, dimensions FROM index_meta WHERE id = 1')
      .get() as { last_sha: string; model: string; dimensions: number } | undefined;

    if (!row) return null;
    return { sha: row.last_sha, model: row.model, dimensions: row.dimensions };
  }

  /** Recreate vec virtual table with new dimensions (used by `slope index --full`) */
  recreateVecTable(dimensions: number): void {
    if (!this.vecAvailable) {
      throw new SlopeStoreError('EXTENSION_UNAVAILABLE',
        'sqlite-vec extension not available. Install sqlite-vec: npm install sqlite-vec');
    }
    this.db.exec('DROP TABLE IF EXISTS vec_embeddings');
    this.db.exec(`CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[${dimensions}])`);
  }

  /** Clear all embedding data (used by `slope index --full`) */
  clearAllEmbeddings(): void {
    this.db.exec('DELETE FROM embeddings');
    this.db.exec('DELETE FROM index_meta');
    if (this.vecAvailable) {
      this.db.exec('DROP TABLE IF EXISTS vec_embeddings');
    }
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}

// --- Row mappers ---

function rowToSession(row: Record<string, unknown>): SlopeSession {
  return {
    session_id: row.session_id as string,
    role: row.role as SlopeSession['role'],
    ide: row.ide as string,
    worktree_path: row.worktree_path as string | undefined ?? undefined,
    branch: row.branch as string | undefined ?? undefined,
    started_at: row.started_at as string,
    last_heartbeat_at: row.last_heartbeat_at as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
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
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

function rowToEvent(row: Record<string, unknown>): SlopeEvent {
  return {
    id: row.id as string,
    session_id: (row.session_id as string | null) ?? undefined,
    type: row.type as EventType,
    timestamp: row.timestamp as string,
    data: row.data ? JSON.parse(row.data as string) : {},
    sprint_number: (row.sprint_number as number | null) ?? undefined,
    ticket_key: (row.ticket_key as string | null) ?? undefined,
  };
}

/** Create a SlopeStore backed by SQLite */
export function createStore(opts: { storePath: string; cwd?: string }): SlopeStore {
  const fullPath = opts.cwd ? join(opts.cwd, opts.storePath) : opts.storePath;
  return new SqliteSlopeStore(fullPath);
}
