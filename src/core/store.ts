// SLOPE — SlopeStore Interface
// Pluggable persistent storage for sessions, claims, scorecards, and common issues.

import type { SprintClaim, GolfScorecard, SlopeEvent, WorkflowExecution, WorkflowStepResult } from './types.js';
import type { CommonIssuesFile } from './briefing.js';
import type { SprintRegistry } from './registry.js';
import type { SprintIdInput } from './sprint-id.js';

/** Canonical scorecard representation persisted by stores. */
export type StoredGolfScorecard = GolfScorecard;

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

export type SlopeSessionUpdate = Partial<Omit<SlopeSession, 'session_id' | 'started_at' | 'last_heartbeat_at'>>;

export type StoreErrorCode = 'SESSION_CONFLICT' | 'CLAIM_EXISTS' | 'NOT_FOUND' | 'STORE_UNAVAILABLE' | 'EXTENSION_UNAVAILABLE';

export class SlopeStoreError extends Error {
  constructor(public code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'SlopeStoreError';
  }
}

export function migrationHistoryIssues(
  appliedVersions: readonly number[],
  targetVersion: number,
): string[] {
  const issues: string[] = [];
  const seen = new Set<number>();

  for (const version of appliedVersions) {
    if (!Number.isSafeInteger(version) || version < 1) {
      issues.push(`schema_version contains invalid version ${String(version)}`);
      continue;
    }
    if (seen.has(version)) {
      issues.push(`schema_version contains duplicate version ${version}`);
    }
    seen.add(version);
  }

  const validVersions = [...seen].sort((a, b) => a - b);
  const currentVersion = validVersions.at(-1) ?? 0;
  if (currentVersion > targetVersion) {
    issues.push(`schema_version ${currentVersion} is newer than supported target ${targetVersion}`);
  }

  const missing: number[] = [];
  for (let version = 1; version <= Math.min(currentVersion, targetVersion); version++) {
    if (!seen.has(version)) missing.push(version);
  }
  if (missing.length > 0) {
    issues.push(`schema_version is missing migration(s): ${missing.join(', ')}`);
  }

  return issues;
}

export function assertMigrationHistory(
  appliedVersions: readonly number[],
  targetVersion: number,
): void {
  const issues = migrationHistoryIssues(appliedVersions, targetVersion);
  if (issues.length > 0) {
    throw new Error(`Invalid migration history: ${issues.join('; ')}`);
  }
}

export interface SlopeStore extends SprintRegistry {
  // Sessions
  registerSession(session: Omit<SlopeSession, 'started_at' | 'last_heartbeat_at'>): Promise<SlopeSession>;
  updateSession(sessionId: string, updates: SlopeSessionUpdate): Promise<SlopeSession>;
  removeSession(sessionId: string): Promise<boolean>;
  getActiveSessions(): Promise<SlopeSession[]>;
  getSessionsBySwarm(swarmId: string): Promise<SlopeSession[]>;
  updateHeartbeat(sessionId: string): Promise<void>;
  cleanStaleSessions(maxAgeMs: number): Promise<number>;

  // Claims (extends SprintRegistry.claim/release/list/get with additional methods)
  getActiveClaims(sprintNumber?: SprintIdInput): Promise<SprintClaim[]>;

  // Scorecards
  saveScorecard(card: StoredGolfScorecard): Promise<void>;
  listScorecards(filter?: { minSprint?: SprintIdInput; maxSprint?: SprintIdInput }): Promise<StoredGolfScorecard[]>;

  // Common issues
  loadCommonIssues(): Promise<CommonIssuesFile>;
  saveCommonIssues(issues: CommonIssuesFile): Promise<void>;

  // Events (session telemetry)
  insertEvent(event: Omit<SlopeEvent, 'id' | 'timestamp'>): Promise<SlopeEvent>;
  getAllEvents(): Promise<SlopeEvent[]>;
  getEventsBySession(sessionId: string): Promise<SlopeEvent[]>;
  getEventsBySprint(sprintNumber: SprintIdInput): Promise<SlopeEvent[]>;
  getEventsByTicket(ticketKey: string): Promise<SlopeEvent[]>;

  // Testing sessions
  createTestingSession(session: { branch?: string; sprint?: SprintIdInput; purpose?: string; worktree_path?: string; branch_name?: string }): Promise<{ id: string; started_at: string }>;
  endTestingSession(sessionId: string): Promise<{ ended_at: string; finding_count: number; worktree_path?: string; branch_name?: string }>;
  getActiveTestingSession(): Promise<{ id: string; branch?: string; sprint?: string; purpose?: string; worktree_path?: string; branch_name?: string; started_at: string } | null>;
  addTestingFinding(finding: { session_id: string; description: string; severity?: string; ticket?: string }): Promise<{ id: string }>;
  getTestingFindings(sessionId: string): Promise<Array<{ id: string; description: string; severity: string; ticket?: string; created_at: string }>>;

  // Workflow executions
  startExecution(params: { workflow_name: string; sprint_id?: string; variables?: Record<string, string>; session_id?: string; definition_json?: string; definition_hash?: string }): Promise<WorkflowExecution>;
  getExecution(executionId: string): Promise<WorkflowExecution | null>;
  getExecutionBySprint(sprintId: string): Promise<WorkflowExecution | null>;
  updateExecutionState(executionId: string, phase: string, step: string): Promise<void>;
  completeExecution(executionId: string, status: 'completed' | 'failed' | 'paused' | 'running'): Promise<void>;
  /** Atomic running -> completed transition capability for lifecycle closeout. */
  completeRunningExecution?(executionId: string): Promise<boolean>;
  recordStepResult(params: { execution_id: string; step_id: string; phase: string; status: 'completed' | 'skipped' | 'failed'; output?: Record<string, unknown>; exit_code?: number; item?: string; started_at?: string }): Promise<WorkflowStepResult>;
  listExecutions(filter?: { sprint_id?: string; status?: string }): Promise<WorkflowExecution[]>;

  // Diagnostics
  getSchemaVersion(): Promise<number>;
  getStats(): Promise<StoreStats>;

  // Lifecycle
  close(): void;
}
