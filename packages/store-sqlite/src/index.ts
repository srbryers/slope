// SLOPE — SQLite Storage Adapter
// Implements SlopeStore backed by better-sqlite3 with WAL mode.

import { join } from 'node:path';
import type { SprintClaim, GolfScorecard } from '@slope-dev/core';
import type { CommonIssuesFile } from '@slope-dev/core';
import type { SlopeStore, SlopeSession } from '@slope-dev/core';

/** Stub — full implementation in S-1-3 */
export class SqliteSlopeStore implements SlopeStore {
  constructor(_dbPath: string) {
    throw new Error('SqliteSlopeStore: not yet implemented');
  }

  async registerSession(_session: Omit<SlopeSession, 'started_at' | 'last_heartbeat_at'>): Promise<SlopeSession> {
    throw new Error('Not implemented');
  }
  async removeSession(_sessionId: string): Promise<boolean> {
    throw new Error('Not implemented');
  }
  async getActiveSessions(): Promise<SlopeSession[]> {
    throw new Error('Not implemented');
  }
  async updateHeartbeat(_sessionId: string): Promise<void> {
    throw new Error('Not implemented');
  }
  async cleanStaleSessions(_maxAgeMs: number): Promise<number> {
    throw new Error('Not implemented');
  }
  async claim(_claim: Omit<SprintClaim, 'id' | 'claimed_at'>): Promise<SprintClaim> {
    throw new Error('Not implemented');
  }
  async release(_id: string): Promise<boolean> {
    throw new Error('Not implemented');
  }
  async list(_sprintNumber: number): Promise<SprintClaim[]> {
    throw new Error('Not implemented');
  }
  async get(_id: string): Promise<SprintClaim | undefined> {
    throw new Error('Not implemented');
  }
  async getActiveClaims(_sprintNumber?: number): Promise<SprintClaim[]> {
    throw new Error('Not implemented');
  }
  async saveScorecard(_card: GolfScorecard): Promise<void> {
    throw new Error('Not implemented');
  }
  async listScorecards(_filter?: { minSprint?: number; maxSprint?: number }): Promise<GolfScorecard[]> {
    throw new Error('Not implemented');
  }
  async loadCommonIssues(): Promise<CommonIssuesFile> {
    throw new Error('Not implemented');
  }
  async saveCommonIssues(_issues: CommonIssuesFile): Promise<void> {
    throw new Error('Not implemented');
  }
  close(): void {
    throw new Error('Not implemented');
  }
}

/** Create a SlopeStore backed by SQLite */
export function createStore(opts: { storePath: string; cwd?: string }): SlopeStore {
  const fullPath = opts.cwd ? join(opts.cwd, opts.storePath) : opts.storePath;
  return new SqliteSlopeStore(fullPath);
}
