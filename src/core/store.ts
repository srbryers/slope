// SLOPE — SlopeStore Interface
// Pluggable persistent storage for sessions, claims, scorecards, and common issues.

import type { SprintClaim, GolfScorecard, SlopeEvent } from './types.js';
import type { CommonIssuesFile } from './briefing.js';
import type { SprintRegistry } from './registry.js';

/** Aggregate row counts from the store — used by health checks and diagnostics. */
export interface StoreStats {
  sessions: number;
  claims: number;
  scorecards: number;
  events: number;
  lastEventAt: string | null;
}

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
  agent_role?: string;
  swarm_id?: string;
}

export type StoreErrorCode = 'SESSION_CONFLICT' | 'CLAIM_EXISTS' | 'NOT_FOUND' | 'STORE_UNAVAILABLE' | 'EXTENSION_UNAVAILABLE';

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
  getSessionsBySwarm(swarmId: string): Promise<SlopeSession[]>;
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

  // Events (session telemetry)
  insertEvent(event: Omit<SlopeEvent, 'id' | 'timestamp'>): Promise<SlopeEvent>;
  getEventsBySession(sessionId: string): Promise<SlopeEvent[]>;
  getEventsBySprint(sprintNumber: number): Promise<SlopeEvent[]>;
  getEventsByTicket(ticketKey: string): Promise<SlopeEvent[]>;

  // Testing sessions
  createTestingSession(session: { branch?: string; sprint?: number; purpose?: string; worktree_path?: string; branch_name?: string }): Promise<{ id: string; started_at: string }>;
  endTestingSession(sessionId: string): Promise<{ ended_at: string; finding_count: number; worktree_path?: string; branch_name?: string }>;
  getActiveTestingSession(): Promise<{ id: string; branch?: string; sprint?: number; purpose?: string; worktree_path?: string; branch_name?: string; started_at: string } | null>;
  addTestingFinding(finding: { session_id: string; description: string; severity?: string; ticket?: string }): Promise<{ id: string }>;
  getTestingFindings(sessionId: string): Promise<Array<{ id: string; description: string; severity: string; ticket?: string; created_at: string }>>;

  // Diagnostics
  getSchemaVersion(): Promise<number>;
  getStats(): Promise<StoreStats>;

  // Lifecycle
  close(): void;
}
