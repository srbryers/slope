import { describe, it, expect } from 'vitest';
import { clusterEvents, findPromotionCandidates, runPipeline } from '../src/pipeline.js';
import type { SlopeEvent } from '../src/types.js';
import type { CommonIssuesFile } from '../src/briefing.js';

function makeEvent(
  type: SlopeEvent['type'],
  sprintNumber: number,
  data: Record<string, unknown> = {},
  ticketKey?: string,
): SlopeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    data,
    sprint_number: sprintNumber,
    ticket_key: ticketKey,
  };
}

describe('clusterEvents', () => {
  it('clusters events by type + area', () => {
    const events = [
      makeEvent('failure', 1, { file: 'packages/core/src/foo.ts' }),
      makeEvent('failure', 2, { file: 'packages/core/src/bar.ts' }),
      makeEvent('failure', 1, { file: 'packages/cli/src/cmd.ts' }),
    ];

    const clusters = clusterEvents(events);
    expect(clusters).toHaveLength(2); // core + cli areas

    const coreCluster = clusters.find(c => c.area === 'packages/core/src');
    expect(coreCluster).toBeDefined();
    expect(coreCluster!.sprints).toEqual([1, 2]);
    expect(coreCluster!.events).toHaveLength(2);
  });

  it('uses data.area when available', () => {
    const events = [
      makeEvent('hazard', 1, { area: 'testing' }),
      makeEvent('hazard', 2, { area: 'testing' }),
    ];

    const clusters = clusterEvents(events);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].area).toBe('testing');
    expect(clusters[0].sprints).toEqual([1, 2]);
  });

  it('falls back to ticket prefix for area', () => {
    const events = [
      makeEvent('failure', 1, {}, 'S5-1'),
      makeEvent('failure', 2, {}, 'S5-3'),
    ];

    const clusters = clusterEvents(events);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].area).toBe('S5');
  });

  it('defaults to general area when no info', () => {
    const events = [makeEvent('failure', 1)];
    const clusters = clusterEvents(events);
    expect(clusters[0].area).toBe('general');
  });

  it('does not duplicate sprint numbers', () => {
    const events = [
      makeEvent('failure', 3, { area: 'db' }),
      makeEvent('failure', 3, { area: 'db' }),
      makeEvent('failure', 3, { area: 'db' }),
    ];

    const clusters = clusterEvents(events);
    expect(clusters[0].sprints).toEqual([3]);
    expect(clusters[0].events).toHaveLength(3);
  });

  it('builds description from event data', () => {
    const events = [
      makeEvent('failure', 1, { error: 'build failed' }),
    ];
    const clusters = clusterEvents(events);
    expect(clusters[0].description).toContain('build failed');
  });
});

describe('findPromotionCandidates', () => {
  it('promotes clusters appearing in 2+ sprints', () => {
    const clusters = [
      { type: 'failure', area: 'packages/core', sprints: [1, 2, 3], events: [], description: 'build failures' },
      { type: 'hazard', area: 'testing', sprints: [1], events: [], description: 'flaky' },
    ];

    const candidates = findPromotionCandidates(clusters);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cluster.type).toBe('failure');
    expect(candidates[0].suggestedPattern.title).toContain('[telemetry]');
    expect(candidates[0].suggestedPattern.category).toBe('build');
  });

  it('respects custom threshold', () => {
    const clusters = [
      { type: 'failure', area: 'core', sprints: [1, 2], events: [], description: 'build' },
    ];

    expect(findPromotionCandidates(clusters, 3)).toHaveLength(0);
    expect(findPromotionCandidates(clusters, 2)).toHaveLength(1);
  });

  it('excludes decision and compaction types', () => {
    const clusters = [
      { type: 'decision', area: 'core', sprints: [1, 2, 3], events: [], description: 'refactor choice' },
      { type: 'compaction', area: 'core', sprints: [1, 2, 3], events: [], description: 'context' },
    ];

    expect(findPromotionCandidates(clusters)).toHaveLength(0);
  });

  it('populates reported_by from event data.player', () => {
    const clusters = [
      {
        type: 'failure', area: 'core', sprints: [1, 2],
        events: [
          makeEvent('failure', 1, { area: 'core', player: 'alice' }),
          makeEvent('failure', 2, { area: 'core', player: 'bob' }),
          makeEvent('failure', 2, { area: 'core', player: 'alice' }),
        ],
        description: 'test',
      },
    ];

    const candidates = findPromotionCandidates(clusters);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].suggestedPattern.reported_by).toEqual(['alice', 'bob']);
  });

  it('populates reported_by from event data.session_player as fallback', () => {
    const clusters = [
      {
        type: 'failure', area: 'core', sprints: [1, 2],
        events: [
          makeEvent('failure', 1, { area: 'core', session_player: 'charlie' }),
          makeEvent('failure', 2, { area: 'core' }),
        ],
        description: 'test',
      },
    ];

    const candidates = findPromotionCandidates(clusters);
    expect(candidates[0].suggestedPattern.reported_by).toEqual(['charlie']);
  });

  it('returns empty reported_by when no player data', () => {
    const clusters = [
      { type: 'failure', area: 'core', sprints: [1, 2], events: [
        makeEvent('failure', 1, { area: 'core' }),
        makeEvent('failure', 2, { area: 'core' }),
      ], description: 'test' },
    ];

    const candidates = findPromotionCandidates(clusters);
    expect(candidates[0].suggestedPattern.reported_by).toEqual([]);
  });

  it('maps event types to correct categories', () => {
    const clusters = [
      { type: 'dead_end', area: 'api', sprints: [1, 2], events: [], description: 'wrong approach' },
      { type: 'scope_change', area: 'ui', sprints: [1, 2], events: [], description: 'expanded' },
    ];

    const candidates = findPromotionCandidates(clusters);
    expect(candidates[0].suggestedPattern.category).toBe('approach');
    expect(candidates[1].suggestedPattern.category).toBe('scope');
  });
});

describe('runPipeline', () => {
  const emptyIssues: CommonIssuesFile = { recurring_patterns: [] };

  it('promotes recurring failures to common issues', () => {
    const events = [
      makeEvent('failure', 1, { area: 'testing', error: 'flaky' }),
      makeEvent('failure', 2, { area: 'testing', error: 'flaky again' }),
    ];

    const result = runPipeline(events, { ...emptyIssues, recurring_patterns: [] });
    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.candidates).toHaveLength(1);
  });

  it('does not overwrite manual entries', () => {
    const manualEntry = {
      id: 1,
      title: 'Manual issue',
      category: 'testing',
      sprints_hit: [1],
      gotcha_refs: [],
      description: 'Manually entered',
      prevention: 'Manual fix',
    };

    const events = [
      makeEvent('failure', 1, { area: 'testing' }),
      makeEvent('failure', 2, { area: 'testing' }),
    ];

    const issues: CommonIssuesFile = { recurring_patterns: [manualEntry] };
    const result = runPipeline(events, issues);

    // Manual entry still exists
    expect(issues.recurring_patterns.find(p => p.title === 'Manual issue')).toBeDefined();
    // New telemetry entry added alongside
    expect(issues.recurring_patterns.length).toBe(2);
  });

  it('updates existing telemetry patterns with new sprints', () => {
    const existingPattern = {
      id: 1,
      title: '[telemetry] failure in testing',
      category: 'build',
      sprints_hit: [1, 2],
      gotcha_refs: [],
      description: 'old',
      prevention: 'old prevention',
    };

    const events = [
      makeEvent('failure', 1, { area: 'testing' }),
      makeEvent('failure', 2, { area: 'testing' }),
      makeEvent('failure', 3, { area: 'testing' }),
    ];

    const issues: CommonIssuesFile = { recurring_patterns: [existingPattern] };
    const result = runPipeline(events, issues);

    // Should update the existing pattern, not add a new one
    expect(issues.recurring_patterns).toHaveLength(1);
    expect(issues.recurring_patterns[0].sprints_hit).toContain(3);
    expect(result.promoted).toBe(1);
  });

  it('skips when existing telemetry pattern already has all sprints', () => {
    const existingPattern = {
      id: 1,
      title: '[telemetry] failure in testing',
      category: 'build',
      sprints_hit: [1, 2, 3],
      gotcha_refs: [],
      description: 'existing',
      prevention: 'existing prevention',
    };

    const events = [
      makeEvent('failure', 1, { area: 'testing' }),
      makeEvent('failure', 2, { area: 'testing' }),
    ];

    const issues: CommonIssuesFile = { recurring_patterns: [existingPattern] };
    const result = runPipeline(events, issues);

    expect(result.skipped).toBe(1);
    expect(result.promoted).toBe(0);
  });

  it('returns empty result for no events', () => {
    const result = runPipeline([], emptyIssues);
    expect(result.clusters).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.promoted).toBe(0);
  });

  it('merges reported_by when updating existing pattern', () => {
    const existingPattern = {
      id: 1,
      title: '[telemetry] failure in testing',
      category: 'build',
      sprints_hit: [1, 2],
      gotcha_refs: [],
      description: 'old',
      prevention: 'old prevention',
      reported_by: ['alice'],
    };

    const events = [
      makeEvent('failure', 1, { area: 'testing', player: 'alice' }),
      makeEvent('failure', 2, { area: 'testing', player: 'bob' }),
      makeEvent('failure', 3, { area: 'testing', player: 'bob' }),
    ];

    const issues: CommonIssuesFile = { recurring_patterns: [existingPattern] };
    runPipeline(events, issues);

    expect(issues.recurring_patterns[0].reported_by).toEqual(['alice', 'bob']);
  });

  it('assigns sequential IDs to new patterns', () => {
    const existing = {
      recurring_patterns: [{
        id: 5, title: 'existing', category: 'general',
        sprints_hit: [1], gotcha_refs: [], description: '', prevention: '',
      }],
    };

    const events = [
      makeEvent('failure', 1, { area: 'area-a' }),
      makeEvent('failure', 2, { area: 'area-a' }),
      makeEvent('dead_end', 1, { area: 'area-b' }),
      makeEvent('dead_end', 2, { area: 'area-b' }),
    ];

    runPipeline(events, existing);

    // Should have IDs 6 and 7 (next after existing max of 5)
    const newPatterns = existing.recurring_patterns.filter(p => p.title.startsWith('[telemetry]'));
    expect(newPatterns).toHaveLength(2);
    expect(newPatterns[0].id).toBe(6);
    expect(newPatterns[1].id).toBe(7);
  });
});
