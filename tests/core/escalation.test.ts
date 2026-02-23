import { describe, it, expect } from 'vitest';
import {
  resolveEscalationConfig,
  detectEscalation,
  buildEscalationEvent,
} from '../../src/core/escalation.js';
import type { EscalationConfig } from '../../src/core/escalation.js';
import type { StandupReport } from '../../src/core/standup.js';
import type { SlopeEvent, SprintConflict, SprintClaim } from '../../src/core/types.js';

// --- Helpers ---

function makeStandup(overrides: Partial<StandupReport> = {}): StandupReport {
  return {
    sessionId: 'sess-1',
    status: 'working',
    progress: 'Active',
    blockers: [],
    decisions: [],
    handoffs: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(type: SlopeEvent['type'], data: Record<string, unknown> = {}): SlopeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    session_id: 'sess-1',
    type,
    timestamp: new Date().toISOString(),
    data,
    sprint_number: 15,
  };
}

function makeConflict(severity: 'overlap' | 'adjacent', reason: string): SprintConflict {
  const claim1: SprintClaim = {
    id: 'c1', sprint_number: 15, player: 'alice', target: 'S15-1',
    scope: 'ticket', claimed_at: new Date().toISOString(),
  };
  const claim2: SprintClaim = {
    id: 'c2', sprint_number: 15, player: 'bob', target: 'S15-1',
    scope: 'ticket', claimed_at: new Date().toISOString(),
  };
  return { claims: [claim1, claim2], reason, severity };
}

// --- resolveEscalationConfig ---

describe('resolveEscalationConfig', () => {
  it('returns defaults when no config provided', () => {
    const config = resolveEscalationConfig();
    expect(config.blocker_timeout).toBe(15);
    expect(config.claim_conflict).toBe(true);
    expect(config.test_failure_cascade).toBe(10);
    expect(config.actions).toEqual(['log_event', 'notify_standup']);
  });

  it('merges partial config with defaults', () => {
    const config = resolveEscalationConfig({ blocker_timeout: 30 });
    expect(config.blocker_timeout).toBe(30);
    expect(config.claim_conflict).toBe(true); // default
    expect(config.test_failure_cascade).toBe(10); // default
  });

  it('overrides all fields when fully specified', () => {
    const config = resolveEscalationConfig({
      blocker_timeout: 5,
      claim_conflict: false,
      test_failure_cascade: 3,
      actions: ['log_event'],
    });
    expect(config.blocker_timeout).toBe(5);
    expect(config.claim_conflict).toBe(false);
    expect(config.test_failure_cascade).toBe(3);
    expect(config.actions).toEqual(['log_event']);
  });
});

// --- detectEscalation ---

describe('detectEscalation', () => {
  describe('blocker_timeout', () => {
    it('escalates when agent blocked beyond timeout', () => {
      const blockedAt = Date.now() - 20 * 60000; // 20 minutes ago
      const standup = makeStandup({
        status: 'blocked',
        blockers: ['Build failed'],
        timestamp: new Date(blockedAt).toISOString(),
      });

      const results = detectEscalation({
        standups: [standup],
        config: { blocker_timeout: 15 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].trigger).toBe('blocker_timeout');
      expect(results[0].severity).toBe('warning');
      expect(results[0].description).toContain('blocked for');
      expect(results[0].description).toContain('Build failed');
    });

    it('does not escalate when blocked time is within threshold', () => {
      const blockedAt = Date.now() - 5 * 60000; // 5 minutes ago
      const standup = makeStandup({
        status: 'blocked',
        blockers: ['Test issue'],
        timestamp: new Date(blockedAt).toISOString(),
      });

      const results = detectEscalation({
        standups: [standup],
        config: { blocker_timeout: 15 },
      });

      expect(results).toHaveLength(0);
    });

    it('escalates as critical when blocked for 2x timeout', () => {
      const blockedAt = Date.now() - 35 * 60000; // 35 minutes ago
      const standup = makeStandup({
        status: 'blocked',
        blockers: ['Deadlock'],
        timestamp: new Date(blockedAt).toISOString(),
      });

      const results = detectEscalation({
        standups: [standup],
        config: { blocker_timeout: 15 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].severity).toBe('critical');
    });

    it('does not escalate working agents', () => {
      const standup = makeStandup({
        status: 'working',
        timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
      });

      const results = detectEscalation({ standups: [standup] });
      expect(results).toHaveLength(0);
    });
  });

  describe('claim_conflict', () => {
    it('escalates overlap conflicts as critical', () => {
      const conflict = makeConflict('overlap', 'Both claim S15-1');
      const results = detectEscalation({ conflicts: [conflict] });

      expect(results).toHaveLength(1);
      expect(results[0].trigger).toBe('claim_conflict');
      expect(results[0].severity).toBe('critical');
      expect(results[0].description).toBe('Both claim S15-1');
    });

    it('escalates adjacent conflicts as warning', () => {
      const conflict = makeConflict('adjacent', 'Adjacent claims on packages/core');
      const results = detectEscalation({ conflicts: [conflict] });

      expect(results).toHaveLength(1);
      expect(results[0].trigger).toBe('claim_conflict');
      expect(results[0].severity).toBe('warning');
    });

    it('skips conflict detection when disabled', () => {
      const conflict = makeConflict('overlap', 'Both claim S15-1');
      const results = detectEscalation({
        conflicts: [conflict],
        config: { claim_conflict: false },
      });

      expect(results).toHaveLength(0);
    });
  });

  describe('test_failure_cascade', () => {
    it('escalates when failure count exceeds threshold', () => {
      const events = Array.from({ length: 12 }, () => makeEvent('failure', { error: 'test' }));
      const results = detectEscalation({
        events,
        config: { test_failure_cascade: 10 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].trigger).toBe('test_failure_cascade');
      expect(results[0].severity).toBe('warning');
      expect(results[0].description).toContain('12 failure events');
    });

    it('does not escalate below threshold', () => {
      const events = Array.from({ length: 5 }, () => makeEvent('failure'));
      const results = detectEscalation({
        events,
        config: { test_failure_cascade: 10 },
      });

      expect(results).toHaveLength(0);
    });

    it('escalates as critical when failures are 2x threshold', () => {
      const events = Array.from({ length: 25 }, () => makeEvent('failure'));
      const results = detectEscalation({
        events,
        config: { test_failure_cascade: 10 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].severity).toBe('critical');
    });

    it('ignores non-failure events', () => {
      const events = [
        ...Array.from({ length: 15 }, () => makeEvent('decision')),
        ...Array.from({ length: 3 }, () => makeEvent('failure')),
      ];
      const results = detectEscalation({
        events,
        config: { test_failure_cascade: 10 },
      });

      expect(results).toHaveLength(0);
    });
  });

  describe('combined triggers', () => {
    it('detects multiple escalation types simultaneously', () => {
      const blockedAt = Date.now() - 20 * 60000;
      const standup = makeStandup({
        status: 'blocked',
        blockers: ['DB locked'],
        timestamp: new Date(blockedAt).toISOString(),
      });
      const conflict = makeConflict('overlap', 'Overlap on S15-2');
      const events = Array.from({ length: 15 }, () => makeEvent('failure'));

      const results = detectEscalation({
        standups: [standup],
        conflicts: [conflict],
        events,
        config: { blocker_timeout: 15, test_failure_cascade: 10 },
      });

      expect(results).toHaveLength(3);
      const triggers = results.map(r => r.trigger);
      expect(triggers).toContain('blocker_timeout');
      expect(triggers).toContain('claim_conflict');
      expect(triggers).toContain('test_failure_cascade');
    });

    it('returns empty when no conditions met', () => {
      const results = detectEscalation({
        standups: [makeStandup()],
        conflicts: [],
        events: [],
      });

      expect(results).toHaveLength(0);
    });
  });
});

// --- buildEscalationEvent ---

describe('buildEscalationEvent', () => {
  it('creates a hazard event with escalation data', () => {
    const event = buildEscalationEvent(
      {
        trigger: 'blocker_timeout',
        severity: 'warning',
        description: 'Agent blocked for 20m',
        session_id: 'sess-1',
        agent_role: 'backend',
        actions: ['log_event'],
      },
      'sess-1',
      15,
    );

    expect(event.type).toBe('hazard');
    expect(event.session_id).toBe('sess-1');
    expect(event.sprint_number).toBe(15);
    expect(event.data.escalation_trigger).toBe('blocker_timeout');
    expect(event.data.escalation_severity).toBe('warning');
    expect(event.data.description).toBe('Agent blocked for 20m');
    expect(event.data.agent_role).toBe('backend');
  });

  it('omits agent_role when not provided', () => {
    const event = buildEscalationEvent(
      {
        trigger: 'manual',
        severity: 'warning',
        description: 'Manual escalation',
        actions: ['log_event'],
      },
      'manual',
    );

    expect(event.data.agent_role).toBeUndefined();
    expect(event.sprint_number).toBeUndefined();
  });
});
