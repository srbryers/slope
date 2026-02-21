// SLOPE — SlopeStore Interface
// Pluggable persistent storage for sessions, claims, scorecards, and common issues.

import type { SprintClaim, GolfScorecard } from './types.js';
import type { CommonIssuesFile } from './briefing.js';
import type { SprintRegistry } from './registry.js';

/** Live agent/IDE session — distinct from SessionEntry (journal-style briefing entries) */
export interface SlopeSession {
  session_id: string;
  role: 'primary' | 'secondary' | 'observer';
  ide: string;
  worktree_path?: string;
  branch?: string;
  started_at: string;
  last_heartbeat_at: string;
  metadata?: Record<string, unknown>;
}

export type StoreErrorCode = 'SESSION_CONFLICT' | 'CLAIM_EXISTS' | 'NOT_FOUND' | 'STORE_UNAVAILABLE';

export class SlopeStoreError extends Error {
  constructor(public code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'SlopeStoreError';
  }
}

export interface SlopeStore extends SprintRegistry {
  // Sessions
  registerSession(session: Omit<SlopeSession, 'started_at' | 'last_heartbeat_at'>): Promise<SlopeSession>;
  removeSession(sessionId: string): Promise<boolean>;
  getActiveSessions(): Promise<SlopeSession[]>;
  updateHeartbeat(sessionId: string): Promise<void>;
  cleanStaleSessions(maxAgeMs: number): Promise<number>;

  // Claims (extends SprintRegistry.claim/release/list/get with additional methods)
  getActiveClaims(sprintNumber?: number): Promise<SprintClaim[]>;

  // Scorecards
  saveScorecard(card: GolfScorecard): Promise<void>;
  listScorecards(filter?: { minSprint?: number; maxSprint?: number }): Promise<GolfScorecard[]>;

  // Common issues
  loadCommonIssues(): Promise<CommonIssuesFile>;
  saveCommonIssues(issues: CommonIssuesFile): Promise<void>;

  // Lifecycle
  close(): void;
}
