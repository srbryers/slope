import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadDeferred,
  createDeferred,
  resolveDeferred,
  listDeferred,
  formatDeferredForBriefing,
} from '../../src/core/deferred.js';
import type { DeferredFinding } from '../../src/core/deferred.js';

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-deferred-test');

beforeEach(() => {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadDeferred', () => {
  it('returns empty array when file missing', () => {
    expect(loadDeferred(tmpDir)).toEqual([]);
  });

  it('returns empty array on malformed JSON', () => {
    const fs = require('node:fs');
    fs.writeFileSync(join(tmpDir, '.slope', 'deferred-findings.json'), 'bad json');
    expect(loadDeferred(tmpDir)).toEqual([]);
  });
});

describe('createDeferred', () => {
  it('creates a finding with generated ID and timestamps', () => {
    const finding = createDeferred(tmpDir, {
      source_sprint: 16,
      target_sprint: 21,
      severity: 'medium',
      description: 'Romance system needs 2-track reduction',
      category: 'architecture',
    });

    expect(finding.id).toBeTruthy();
    expect(finding.source_sprint).toBe(16);
    expect(finding.target_sprint).toBe(21);
    expect(finding.severity).toBe('medium');
    expect(finding.status).toBe('open');
    expect(finding.category).toBe('architecture');
    expect(finding.created_at).toBeTruthy();

    // Persisted
    const loaded = loadDeferred(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(finding.id);
  });

  it('defaults target_sprint to null when not provided', () => {
    const finding = createDeferred(tmpDir, {
      source_sprint: 10,
      severity: 'low',
      description: 'Unscheduled task',
    });
    expect(finding.target_sprint).toBeNull();
  });

  it('appends to existing findings', () => {
    createDeferred(tmpDir, { source_sprint: 1, severity: 'low', description: 'first' });
    createDeferred(tmpDir, { source_sprint: 2, severity: 'high', description: 'second' });

    const loaded = loadDeferred(tmpDir);
    expect(loaded).toHaveLength(2);
  });
});

describe('resolveDeferred', () => {
  it('marks a finding as resolved', () => {
    const finding = createDeferred(tmpDir, {
      source_sprint: 16,
      severity: 'medium',
      description: 'test',
    });

    const resolved = resolveDeferred(tmpDir, finding.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolved_at).toBeTruthy();

    // Persisted
    const loaded = loadDeferred(tmpDir);
    expect(loaded[0].status).toBe('resolved');
  });

  it('supports prefix matching', () => {
    const finding = createDeferred(tmpDir, {
      source_sprint: 16,
      severity: 'medium',
      description: 'test',
    });

    const prefix = finding.id.slice(0, 8);
    const resolved = resolveDeferred(tmpDir, prefix);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(finding.id);
  });

  it('supports wontfix status', () => {
    const finding = createDeferred(tmpDir, {
      source_sprint: 16,
      severity: 'low',
      description: 'test',
    });

    const resolved = resolveDeferred(tmpDir, finding.id, 'wontfix');
    expect(resolved!.status).toBe('wontfix');
  });

  it('returns null for unknown ID', () => {
    expect(resolveDeferred(tmpDir, 'nonexistent')).toBeNull();
  });

  it('no-ops on already resolved finding', () => {
    const finding = createDeferred(tmpDir, {
      source_sprint: 16,
      severity: 'medium',
      description: 'test',
    });
    resolveDeferred(tmpDir, finding.id);

    // Resolve again — should return the finding without changing it
    const second = resolveDeferred(tmpDir, finding.id);
    expect(second!.status).toBe('resolved');
  });
});

describe('listDeferred', () => {
  beforeEach(() => {
    createDeferred(tmpDir, { source_sprint: 16, target_sprint: 21, severity: 'medium', description: 'a' });
    createDeferred(tmpDir, { source_sprint: 18, target_sprint: 21, severity: 'high', description: 'b' });
    createDeferred(tmpDir, { source_sprint: 19, target_sprint: 22, severity: 'low', description: 'c' });
  });

  it('lists all findings without filters', () => {
    expect(listDeferred(tmpDir)).toHaveLength(3);
  });

  it('filters by target sprint', () => {
    const results = listDeferred(tmpDir, { sprint: 21 });
    expect(results).toHaveLength(2);
    expect(results.every(f => f.target_sprint === 21)).toBe(true);
  });

  it('filters by status', () => {
    // Resolve one
    const all = loadDeferred(tmpDir);
    resolveDeferred(tmpDir, all[0].id);

    const open = listDeferred(tmpDir, { status: 'open' });
    expect(open).toHaveLength(2);

    const resolved = listDeferred(tmpDir, { status: 'resolved' });
    expect(resolved).toHaveLength(1);
  });

  it('filters by severity', () => {
    const high = listDeferred(tmpDir, { severity: 'high' });
    expect(high).toHaveLength(1);
    expect(high[0].description).toBe('b');
  });
});

describe('formatDeferredForBriefing', () => {
  it('returns empty for no open findings', () => {
    expect(formatDeferredForBriefing([], 21)).toEqual([]);
  });

  it('formats findings targeting the given sprint', () => {
    const findings: DeferredFinding[] = [
      {
        id: '1',
        source_sprint: 16,
        target_sprint: 21,
        severity: 'medium',
        description: 'Romance system needs 2-track reduction',
        category: 'architecture',
        status: 'open',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        source_sprint: 18,
        target_sprint: 21,
        severity: 'high',
        description: 'Terminal combat balance untested',
        category: 'testing',
        status: 'open',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: '3',
        source_sprint: 19,
        target_sprint: 22,
        severity: 'low',
        description: 'Different sprint target',
        status: 'open',
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    const lines = formatDeferredForBriefing(findings, 21);
    expect(lines).toHaveLength(3); // header + 2 findings
    expect(lines[0]).toContain('2 open for Sprint 21');
    expect(lines[1]).toContain('[MEDIUM]');
    expect(lines[1]).toContain('S16 → S21');
    expect(lines[1]).toContain('architecture');
    expect(lines[2]).toContain('[HIGH]');
    expect(lines[2]).toContain('S18 → S21');
  });

  it('excludes resolved findings', () => {
    const findings: DeferredFinding[] = [
      {
        id: '1',
        source_sprint: 16,
        target_sprint: 21,
        severity: 'medium',
        description: 'Resolved finding',
        status: 'resolved',
        created_at: '2024-01-01T00:00:00Z',
        resolved_at: '2024-01-02T00:00:00Z',
      },
    ];

    const lines = formatDeferredForBriefing(findings, 21);
    expect(lines).toEqual([]);
  });
});
