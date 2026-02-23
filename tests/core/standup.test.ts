import { describe, it, expect } from 'vitest';
import {
  generateStandup,
  formatStandup,
  parseStandup,
  extractRelevantHandoffs,
} from '../../src/core/standup.js';
import type { StandupReport, HandoffEntry } from '../../src/core/standup.js';
import type { SlopeEvent, SprintClaim } from '../../src/core/types.js';

// --- Helpers ---

function makeEvent(type: SlopeEvent['type'], data: Record<string, unknown> = {}): SlopeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    session_id: 'sess-1',
    type,
    timestamp: new Date().toISOString(),
    data,
    sprint_number: 14,
  };
}

function makeClaim(overrides: Partial<SprintClaim> = {}): SprintClaim {
  return {
    id: 'c-001',
    sprint_number: 14,
    player: 'alice',
    target: 'S14-1',
    scope: 'ticket',
    claimed_at: new Date().toISOString(),
    session_id: 'sess-1',
    ...overrides,
  };
}

// --- generateStandup ---

describe('generateStandup', () => {
  it('generates a basic standup from events and claims', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      agent_role: 'backend',
      events: [makeEvent('decision', { choice: 'Use SQLite' })],
      claims: [makeClaim()],
    });

    expect(report.sessionId).toBe('sess-1');
    expect(report.agent_role).toBe('backend');
    expect(report.ticketKey).toBe('S14-1');
    expect(report.status).toBe('working');
    expect(report.progress).toContain('S14-1');
    expect(report.decisions).toContain('Use SQLite');
    expect(report.timestamp).toBeTruthy();
  });

  it('status is blocked when failure events exist', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [makeEvent('failure', { error: 'Build failed' })],
      claims: [],
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('Build failed');
  });

  it('extracts dead_end events as blockers', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [makeEvent('dead_end', { approach: 'API v1' })],
      claims: [],
    });

    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0]).toContain('Dead end');
    expect(report.blockers[0]).toContain('API v1');
  });

  it('extracts decisions from decision events', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [
        makeEvent('decision', { choice: 'Use WebSocket' }),
        makeEvent('decision', { description: 'Skip caching' }),
      ],
      claims: [],
    });

    expect(report.decisions).toEqual(['Use WebSocket', 'Skip caching']);
  });

  it('extracts handoffs from scope_change events', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [makeEvent('scope_change', { area: 'packages/core', reason: 'Needs type update' })],
      claims: [],
    });

    expect(report.handoffs).toHaveLength(1);
    expect(report.handoffs[0].target).toBe('packages/core');
    expect(report.handoffs[0].description).toBe('Needs type update');
  });

  it('extracts handoffs from hazard events', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [makeEvent('hazard', { area: 'src/db', description: 'Migration lock' })],
      claims: [],
    });

    expect(report.handoffs).toHaveLength(1);
    expect(report.handoffs[0].target).toBe('src/db');
    expect(report.handoffs[0].description).toContain('Migration lock');
  });

  it('status is complete when completion decision exists', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [makeEvent('decision', { choice: 'complete', status: 'complete' })],
      claims: [],
    });

    expect(report.status).toBe('complete');
  });

  it('returns no activity when no events or claims', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [],
      claims: [],
    });

    expect(report.progress).toBe('No activity recorded');
    expect(report.status).toBe('working');
    expect(report.blockers).toEqual([]);
    expect(report.decisions).toEqual([]);
    expect(report.handoffs).toEqual([]);
  });

  it('only uses ticket claims from the same session', () => {
    const report = generateStandup({
      sessionId: 'sess-1',
      events: [],
      claims: [
        makeClaim({ session_id: 'sess-1', target: 'S14-1' }),
        makeClaim({ id: 'c-002', session_id: 'sess-2', target: 'S14-2' }),
      ],
    });

    expect(report.ticketKey).toBe('S14-1');
  });
});

// --- formatStandup ---

describe('formatStandup', () => {
  it('formats a working standup report', () => {
    const report: StandupReport = {
      sessionId: 'sess-1',
      agent_role: 'backend',
      ticketKey: 'S14-1',
      status: 'working',
      progress: 'Working on: S14-1',
      blockers: [],
      decisions: ['Use SQLite'],
      handoffs: [],
      timestamp: '2026-02-22T00:00:00Z',
    };

    const output = formatStandup(report);
    expect(output).toContain('## Standup [ACTIVE]');
    expect(output).toContain('sess-1');
    expect(output).toContain('(backend)');
    expect(output).toContain('**Ticket:** S14-1');
    expect(output).toContain('Use SQLite');
  });

  it('formats blocked status with blockers', () => {
    const report: StandupReport = {
      sessionId: 'sess-1',
      status: 'blocked',
      progress: 'Stuck on build',
      blockers: ['Build failed', 'Test timeout'],
      decisions: [],
      handoffs: [],
      timestamp: '2026-02-22T00:00:00Z',
    };

    const output = formatStandup(report);
    expect(output).toContain('[BLOCKED]');
    expect(output).toContain('- Build failed');
    expect(output).toContain('- Test timeout');
  });

  it('formats complete status', () => {
    const report: StandupReport = {
      sessionId: 'sess-1',
      status: 'complete',
      progress: 'Ticket done',
      blockers: [],
      decisions: [],
      handoffs: [],
      timestamp: '2026-02-22T00:00:00Z',
    };

    const output = formatStandup(report);
    expect(output).toContain('[DONE]');
  });

  it('formats handoffs with for_role annotation', () => {
    const report: StandupReport = {
      sessionId: 'sess-1',
      status: 'working',
      progress: 'In progress',
      blockers: [],
      decisions: [],
      handoffs: [
        { target: 'packages/core', description: 'Types updated', for_role: 'frontend' },
        { target: 'src/db', description: 'Migration added' },
      ],
      timestamp: '2026-02-22T00:00:00Z',
    };

    const output = formatStandup(report);
    expect(output).toContain('**packages/core**: Types updated (for: frontend)');
    expect(output).toContain('**src/db**: Migration added');
    expect(output).not.toContain('(for:)\n'); // no empty for_role
  });

  it('omits empty sections', () => {
    const report: StandupReport = {
      sessionId: 'sess-1',
      status: 'working',
      progress: 'Doing stuff',
      blockers: [],
      decisions: [],
      handoffs: [],
      timestamp: '2026-02-22T00:00:00Z',
    };

    const output = formatStandup(report);
    expect(output).not.toContain('**Blockers:**');
    expect(output).not.toContain('**Decisions:**');
    expect(output).not.toContain('**Handoffs:**');
  });
});

// --- parseStandup ---

describe('parseStandup', () => {
  it('parses a valid standup from JSON data', () => {
    const data = {
      sessionId: 'sess-1',
      agent_role: 'backend',
      ticketKey: 'S14-1',
      status: 'working',
      progress: 'Working on roles',
      blockers: ['Build fail'],
      decisions: ['Use registry'],
      handoffs: [{ target: 'core', description: 'Types changed' }],
      timestamp: '2026-02-22T00:00:00Z',
    };

    const report = parseStandup(data);
    expect(report).not.toBeNull();
    expect(report!.sessionId).toBe('sess-1');
    expect(report!.blockers).toEqual(['Build fail']);
    expect(report!.handoffs).toHaveLength(1);
  });

  it('returns null for invalid data (missing sessionId)', () => {
    expect(parseStandup({ status: 'working', progress: 'x' })).toBeNull();
  });

  it('returns null for invalid data (missing status)', () => {
    expect(parseStandup({ sessionId: 's1', progress: 'x' })).toBeNull();
  });

  it('returns null for invalid data (missing progress)', () => {
    expect(parseStandup({ sessionId: 's1', status: 'working' })).toBeNull();
  });

  it('defaults empty arrays for missing optional fields', () => {
    const report = parseStandup({
      sessionId: 's1',
      status: 'working',
      progress: 'Active',
    });

    expect(report).not.toBeNull();
    expect(report!.blockers).toEqual([]);
    expect(report!.decisions).toEqual([]);
    expect(report!.handoffs).toEqual([]);
  });
});

// --- extractRelevantHandoffs ---

describe('extractRelevantHandoffs', () => {
  const standup: StandupReport = {
    sessionId: 'sess-1',
    status: 'working',
    progress: 'x',
    blockers: [],
    decisions: [],
    handoffs: [
      { target: 'core', description: 'Types updated', for_role: 'frontend' },
      { target: 'db', description: 'Migration added', for_role: 'backend' },
      { target: 'docs', description: 'README updated' },
    ],
    timestamp: '2026-02-22T00:00:00Z',
  };

  it('returns all handoffs when no role specified', () => {
    const result = extractRelevantHandoffs(standup);
    expect(result).toHaveLength(3);
  });

  it('filters to role-specific + unscoped handoffs', () => {
    const result = extractRelevantHandoffs(standup, 'frontend');
    expect(result).toHaveLength(2);
    expect(result.map(h => h.target)).toEqual(['core', 'docs']);
  });

  it('returns only unscoped handoffs for unmatched role', () => {
    const result = extractRelevantHandoffs(standup, 'devops');
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe('docs');
  });

  it('returns empty for standup with no handoffs', () => {
    const empty: StandupReport = { ...standup, handoffs: [] };
    expect(extractRelevantHandoffs(empty, 'frontend')).toEqual([]);
  });
});
