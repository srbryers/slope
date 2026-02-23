// SLOPE — Escalation Rules
// Detects conditions that warrant escalation in multi-agent sprints.

import type { SlopeEvent, SprintClaim, SprintConflict } from './types.js';
import type { StandupReport } from './standup.js';

/** Escalation trigger types */
export type EscalationTrigger = 'blocker_timeout' | 'claim_conflict' | 'test_failure_cascade' | 'manual';

/** Escalation severity */
export type EscalationSeverity = 'warning' | 'critical';

/** Escalation action to take */
export type EscalationAction = 'log_event' | 'mark_blocked' | 'notify_standup';

/** Configuration for escalation rules in .slope/config.json */
export interface EscalationConfig {
  /** Minutes before a blocked agent triggers escalation (default: 15) */
  blocker_timeout?: number;
  /** Whether claim conflicts auto-escalate (default: true) */
  claim_conflict?: boolean;
  /** Number of test failures across swarm before escalation (default: 10) */
  test_failure_cascade?: number;
  /** Actions to take on escalation */
  actions?: EscalationAction[];
}

/** A detected escalation condition */
export interface EscalationResult {
  trigger: EscalationTrigger;
  severity: EscalationSeverity;
  description: string;
  session_id?: string;
  agent_role?: string;
  actions: EscalationAction[];
}

const DEFAULT_CONFIG: Required<EscalationConfig> = {
  blocker_timeout: 15,
  claim_conflict: true,
  test_failure_cascade: 10,
  actions: ['log_event', 'notify_standup'],
};

/**
 * Merge user config with defaults.
 */
export function resolveEscalationConfig(config?: EscalationConfig): Required<EscalationConfig> {
  if (!config) return { ...DEFAULT_CONFIG };
  return {
    blocker_timeout: config.blocker_timeout ?? DEFAULT_CONFIG.blocker_timeout,
    claim_conflict: config.claim_conflict ?? DEFAULT_CONFIG.claim_conflict,
    test_failure_cascade: config.test_failure_cascade ?? DEFAULT_CONFIG.test_failure_cascade,
    actions: config.actions ?? DEFAULT_CONFIG.actions,
  };
}

/**
 * Detect escalation conditions from swarm state.
 *
 * Checks three trigger types:
 * 1. blocker_timeout — agent blocked for longer than configured threshold
 * 2. claim_conflict — overlapping claims between agents
 * 3. test_failure_cascade — excessive test failures across the swarm
 */
export function detectEscalation(opts: {
  config?: EscalationConfig;
  standups?: StandupReport[];
  conflicts?: SprintConflict[];
  events?: SlopeEvent[];
  now?: number;
}): EscalationResult[] {
  const config = resolveEscalationConfig(opts.config);
  const results: EscalationResult[] = [];
  const now = opts.now ?? Date.now();

  // 1. Blocker timeout — agents blocked for too long
  if (opts.standups) {
    for (const standup of opts.standups) {
      if (standup.status === 'blocked' && standup.blockers.length > 0) {
        const standupTime = new Date(standup.timestamp).getTime();
        const blockedMinutes = (now - standupTime) / 60000;

        if (blockedMinutes >= config.blocker_timeout) {
          results.push({
            trigger: 'blocker_timeout',
            severity: blockedMinutes >= config.blocker_timeout * 2 ? 'critical' : 'warning',
            description: `Agent ${standup.sessionId} blocked for ${Math.round(blockedMinutes)}m (threshold: ${config.blocker_timeout}m): ${standup.blockers[0]}`,
            session_id: standup.sessionId,
            agent_role: standup.agent_role,
            actions: config.actions,
          });
        }
      }
    }
  }

  // 2. Claim conflicts — overlapping scope between agents
  if (config.claim_conflict && opts.conflicts) {
    for (const conflict of opts.conflicts) {
      if (conflict.severity === 'overlap') {
        results.push({
          trigger: 'claim_conflict',
          severity: 'critical',
          description: conflict.reason,
          actions: config.actions,
        });
      } else {
        results.push({
          trigger: 'claim_conflict',
          severity: 'warning',
          description: conflict.reason,
          actions: config.actions,
        });
      }
    }
  }

  // 3. Test failure cascade — too many failures across swarm
  if (opts.events) {
    const failureEvents = opts.events.filter(e => e.type === 'failure');
    if (failureEvents.length >= config.test_failure_cascade) {
      results.push({
        trigger: 'test_failure_cascade',
        severity: failureEvents.length >= config.test_failure_cascade * 2 ? 'critical' : 'warning',
        description: `${failureEvents.length} failure events across swarm (threshold: ${config.test_failure_cascade})`,
        actions: config.actions,
      });
    }
  }

  return results;
}

/**
 * Create an escalation event suitable for store.insertEvent().
 */
export function buildEscalationEvent(
  escalation: EscalationResult,
  sessionId: string,
  sprintNumber?: number,
): Omit<SlopeEvent, 'id' | 'timestamp'> {
  return {
    session_id: sessionId,
    type: 'hazard',
    data: {
      escalation_trigger: escalation.trigger,
      escalation_severity: escalation.severity,
      description: escalation.description,
      actions: escalation.actions,
      ...(escalation.agent_role ? { agent_role: escalation.agent_role } : {}),
    },
    sprint_number: sprintNumber,
  };
}
