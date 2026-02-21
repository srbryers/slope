// SLOPE — SQLite Storage Adapter
// Implements SlopeStore backed by better-sqlite3 with WAL mode.

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { SprintClaim, GolfScorecard } from '@slope-dev/core';
import type { CommonIssuesFile } from '@slope-dev/core';
import { SlopeStoreError } from '@slope-dev/core';
import type { SlopeStore, SlopeSession } from '@slope-dev/core';

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

export class SqliteSlopeStore implements SlopeStore {
  private db: DatabaseType;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
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
    `);
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
        INSERT INTO sessions (session_id, role, ide, worktree_path, branch, started_at, last_heartbeat_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        full.session_id,
        full.role,
        full.ide,
        full.worktree_path ?? null,
        full.branch ?? null,
        full.started_at,
        full.last_heartbeat_at,
        full.metadata ? JSON.stringify(full.metadata) : null,
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

/** Create a SlopeStore backed by SQLite */
export function createStore(opts: { storePath: string; cwd?: string }): SlopeStore {
  const fullPath = opts.cwd ? join(opts.cwd, opts.storePath) : opts.storePath;
  return new SqliteSlopeStore(fullPath);
}
