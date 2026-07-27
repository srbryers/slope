import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { HookInput } from '../../src/core/index.js';

// Mock loadConfig before importing guards
const mockConfig = {
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file' as const,
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  metaphor: 'golf',
  guidance: {} as Record<string, unknown>,
};

vi.mock('../../src/cli/config.js', () => ({
  loadConfig: () => mockConfig,
}));

import { exploreGuard } from '../../src/cli/guards/explore.js';
import { hazardGuard } from '../../src/cli/guards/hazard.js';
import { commitNudgeGuard } from '../../src/cli/guards/commit-nudge.js';
import { scopeDriftGuard } from '../../src/cli/guards/scope-drift.js';
import { compactionGuard } from '../../src/cli/guards/compaction.js';
import { stopCheckGuard } from '../../src/cli/guards/stop-check.js';
import { subagentGateGuard } from '../../src/cli/guards/subagent-gate.js';
import { pushNudgeGuard } from '../../src/cli/guards/push-nudge.js';
import { workflowGateGuard } from '../../src/cli/guards/workflow-gate.js';

let tmpDir: string;

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-session',
    cwd: tmpDir,
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    ...overrides,
  };
}

function applyPatchCommand(path: string): string {
  return [
    '*** Begin Patch',
    `*** Update File: ${path}`,
    '@@',
    '-old',
    '+new',
    '*** End Patch',
  ].join('\n');
}

function writeSprintState(sprint: string | number): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope/sprint-state.json'), JSON.stringify({
    sprint,
    phase: 'implementing',
    gates: {
      tests: false,
      code_review: false,
      architect_review: false,
      scorecard: false,
      review_md: false,
    },
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function writeScorecard(sprint: number, overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(tmpDir, 'docs/retros'), { recursive: true });
  writeFileSync(join(tmpDir, `docs/retros/sprint-${sprint}.json`), JSON.stringify({
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    date: '2026-05-21',
    shots: [],
    conditions: [],
    special_plays: [],
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  }, null, 2));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-guard-'));
  mockConfig.guidance = {};
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe('exploreGuard', () => {
  it('returns empty when no index files exist', async () => {
    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('suggests checking map when CODEBASE.md exists', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Codebase\n');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain('L1');
  });

  it('suggests checking index when .slope/index.json exists', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/index.json'), '{}');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('.slope/index.json');
  });

  it('prefers CODEBASE.md map path when it exists alongside other indexes', async () => {
    writeFileSync(join(tmpDir, 'CODEBASE.md'), '# Index');
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/architecture.md'), '# Arch');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('CODEBASE.md');
    expect(result.context).toContain('L1');
  });

  it('falls back to listing index files when no CODEBASE.md', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/index.json'), '{}');
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs/architecture.md'), '# Arch');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('.slope/index.json');
    expect(result.context).toContain('docs/architecture.md');
  });

  it('uses custom indexPaths from config', async () => {
    mockConfig.guidance = { indexPaths: ['custom-index.md'] };
    writeFileSync(join(tmpDir, 'custom-index.md'), '# Custom');

    const result = await exploreGuard(makeInput(), tmpDir);
    expect(result.context).toContain('custom-index.md');
  });
});

describe('hazardGuard', () => {
  it('returns empty when no file path in input', async () => {
    const result = await hazardGuard(makeInput({ tool_input: {} }), tmpDir);
    expect(result).toEqual({ metricReason: 'no-file-path' });
  });

  it('returns empty when no common issues file', async () => {
    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({ metricReason: 'state-unavailable' });
  });

  it('warns when editing in area with known issues', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Migration conflict in core',
          category: 'database',
          sprints_hit: [5],
          gotcha_refs: [],
          description: 'core package has migration issues',
          prevention: 'Always check schema before modifying core files',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/store.ts') } }),
      tmpDir,
    );
    expect(result.context).toContain('SLOPE hazards');
    expect(result.context).toContain('Migration conflict in core');
  });

  it('warns for Codex apply_patch input when patch touches an area with known issues', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Version command regression',
          category: 'testing',
          sprints_hit: [100],
          gotcha_refs: [],
          description: 'src/cli/commands changes need direct CLI smoke tests',
          prevention: 'Smoke test the built command after editing src/cli/commands',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({
        tool_name: 'apply_patch',
        tool_input: { command: applyPatchCommand(join(tmpDir, 'src/cli/commands/version.ts')) },
      }),
      tmpDir,
    );
    expect(result.context).toContain('SLOPE hazards');
    expect(result.context).toContain('Version command regression');
  });

  it('returns empty when area has no matching issues', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Mobile-only issue',
          category: 'mobile',
          sprints_hit: [3],
          gotcha_refs: [],
          description: 'Only affects mobile',
          prevention: 'Check mobile rendering',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/cli/src/index.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({ metricReason: 'no-match' });
  });

  it('falls back to scorecard shot hazards when common issues are empty', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({ recurring_patterns: [] }));
    writeScorecard(104, {
      shots: [
        {
          ticket_key: 'S104-1',
          title: 'Guard metrics work',
          club: 'short_iron',
          result: 'green',
          hazards: [
            { type: 'rough', description: 'src/cli/guards metric-only fields must stay out of hook output' },
          ],
        },
      ],
    });

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/cli/guards/hazard.ts') } }),
      tmpDir,
    );

    expect(result.context).toContain('SLOPE hazards');
    expect(result.context).toContain('[scorecard:rough]');
    expect(result.context).toContain('metric-only fields');
    expect(result.context).toContain('S104');
    expect(result.metricReason).toBe('matched');
  });

  it('falls back to scorecard bunker locations and keeps newest first', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({ recurring_patterns: [] }));
    writeScorecard(101, {
      bunker_locations: ['src/cli/guards: older hazard'],
    });
    writeScorecard(105, {
      bunker_locations: ['src/cli/guards: newer hazard'],
    });

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/cli/guards/hazard.ts') } }),
      tmpDir,
    );

    expect(result.context).toContain('[scorecard:bunker]');
    expect(result.context?.indexOf('newer hazard')).toBeLessThan(result.context?.indexOf('older hazard') ?? 0);
  });

  it('prefers common issues over scorecard fallback when both match', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Guard common issue',
          category: 'testing',
          sprints_hit: [106],
          gotcha_refs: [],
          description: 'src/cli/guards common issue',
          prevention: 'Use the common issue first',
        },
      ],
    }));
    writeScorecard(105, {
      bunker_locations: ['src/cli/guards: scorecard fallback should not appear'],
    });

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/cli/guards/hazard.ts') } }),
      tmpDir,
    );

    expect(result.context).toContain('Guard common issue');
    expect(result.context).not.toContain('scorecard fallback should not appear');
  });

  it('does not include permissionDecision (non-blocking)', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Core issue',
          category: 'testing',
          sprints_hit: [8],
          gotcha_refs: [],
          description: 'Affects core package testing',
          prevention: 'Run tests after editing core',
        },
      ],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('silences repeated hazard context and tags it as deduped for metrics', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Core issue',
          category: 'testing',
          sprints_hit: [8],
          gotcha_refs: [],
          description: 'Affects core package testing',
          prevention: 'Run tests after editing core',
        },
      ],
    }));

    const input = makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } });
    const first = await hazardGuard(input, tmpDir);
    const second = await hazardGuard(input, tmpDir);

    expect(first.metricReason).toBe('matched');
    expect(second.context).toBeUndefined();
    expect(second.metricReason).toBe('deduped');
  });

  it('writes warnings to disk state for compaction survival', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/common-issues.json'), JSON.stringify({
      recurring_patterns: [
        {
          id: 1,
          title: 'Core issue',
          category: 'testing',
          sprints_hit: [8],
          gotcha_refs: [],
          description: 'Affects core package testing',
          prevention: 'Run tests after editing core',
        },
      ],
    }));
    (mockConfig as Record<string, unknown>).currentSprint = 10;

    await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );

    const statePath = join(tmpDir, '.slope/guard-state/hazard.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].area).toBe('packages/core/src');
    expect(state.entries[0].sprint).toBe(10);
    expect(state.entries[0].warnings[0]).toContain('Core issue');
  });

  it('restores warnings from disk when common issues file is removed', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 10;

    // Seed disk state directly
    writeFileSync(join(tmpDir, '.slope/guard-state/hazard.json'), JSON.stringify({
      entries: [{
        area: 'packages/core/src',
        warnings: ['[testing] Cached warning (last: S8) — Run tests after editing core'],
        sprint: 10,
        timestamp: Date.now(),
      }],
    }));

    // No common-issues.json → fresh warnings empty, but disk state should fill in
    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(result.context).toContain('Cached warning');
  });

  it('clears disk state when sprint changes AND entry is old', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 11;

    // Seed disk state from sprint 10, old timestamp (>7 days) — fails both conditions
    writeFileSync(join(tmpDir, '.slope/guard-state/hazard.json'), JSON.stringify({
      entries: [{
        area: 'packages/core/src',
        warnings: ['[testing] Old sprint warning'],
        sprint: 10,
        timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000),
      }],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({ metricReason: 'state-unavailable' });
  });

  it('keeps entries from old sprint if still fresh (<7 days)', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 11;

    // Sprint 10 but fresh timestamp — kept because timestamp still within 7 days
    writeFileSync(join(tmpDir, '.slope/guard-state/hazard.json'), JSON.stringify({
      entries: [{
        area: 'packages/core/src',
        warnings: ['[testing] Recent old-sprint warning'],
        sprint: 10,
        timestamp: Date.now(),
      }],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(result.context).toContain('Recent old-sprint warning');
  });

  it('prunes entries older than 7 days from old sprints', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 11;

    // Old sprint AND ancient timestamp — pruned
    writeFileSync(join(tmpDir, '.slope/guard-state/hazard.json'), JSON.stringify({
      entries: [{
        area: 'packages/core/src',
        warnings: ['[testing] Ancient warning'],
        sprint: 10,
        timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000),
      }],
    }));

    const result = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({ metricReason: 'state-unavailable' });
  });

  it('keeps an old cache entry only for the exact canonical sprint key', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    writeSprintState('458.10');
    writeFileSync(join(tmpDir, '.slope/guard-state/hazard.json'), JSON.stringify({
      entries: [{
        area: 'packages/core/src',
        warnings: ['[testing] Canonical sprint warning'],
        sprint: '458.10',
        timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000),
      }],
    }));

    const matching = await hazardGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') } }),
      tmpDir,
    );
    expect(matching.context).toContain('Canonical sprint warning');

    writeSprintState('458.1');
    const different = await hazardGuard(
      makeInput({
        session_id: 'other-session',
        tool_input: { file_path: join(tmpDir, 'packages/core/src/foo.ts') },
      }),
      tmpDir,
    );
    expect(different).toEqual({ metricReason: 'state-unavailable' });
  });
});

describe('commitNudgeGuard', () => {
  it('returns empty in non-git directory', async () => {
    const result = await commitNudgeGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when no uncommitted changes', async () => {
    // Initialize a git repo with a commit
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git add -A && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

    const result = await commitNudgeGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('is non-blocking (no decision/blockReason)', async () => {
    const result = await commitNudgeGuard(makeInput(), tmpDir);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });
});

describe('scopeDriftGuard', () => {
  it('returns empty when no file path in input', async () => {
    const result = await scopeDriftGuard(makeInput({ tool_input: {} }), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when no currentSprint in config', async () => {
    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('returns empty when scopeDrift is disabled', async () => {
    mockConfig.guidance = { scopeDrift: false };
    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'src/foo.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('is non-blocking (no decision/blockReason)', async () => {
    const result = await scopeDriftGuard(makeInput({ tool_input: {} }), tmpDir);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('falls back to disk state when store is unavailable', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 10;

    // Seed disk state with a drift violation
    writeFileSync(join(tmpDir, '.slope/guard-state/scope-drift.json'), JSON.stringify({
      entries: [{
        file: 'packages/other/src/bar.ts',
        claimedAreas: 'src/core',
        sprint: 10,
        timestamp: Date.now(),
      }],
    }));

    // Mock resolveStore to throw (simulates store unavailable)
    const storeModule = await import('../../src/cli/store.js');
    const spy = vi.spyOn(storeModule, 'resolveStore').mockRejectedValueOnce(new Error('store unavailable'));

    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/other/src/bar.ts') } }),
      tmpDir,
    );
    expect(result.context).toContain('scope drift');
    expect(result.context).toContain('advisory (non-blocking)');
    expect(result.context).toContain('does not grant or deny the host tool permission');
    expect(result.context).toContain('src/core');
    spy.mockRestore();
  });

  it('warns for Codex apply_patch input when patch touches outside claimed areas', async () => {
    writeSprintState(10);
    const { createStore } = await import('../../src/store/index.js');
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    await store.claim({
      sprint_number: 10,
      player: 'test',
      target: 'src/core',
      scope: 'area',
    });
    store.close();

    const result = await scopeDriftGuard(
      makeInput({
        tool_name: 'apply_patch',
        tool_input: { command: applyPatchCommand(join(tmpDir, 'src/cli/commands/version.ts')) },
      }),
      tmpDir,
    );

    expect(result.context).toContain('scope drift');
    expect(result.context).toContain('advisory (non-blocking)');
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('src/cli/commands/version.ts');
    expect(result.context).toContain('src/core');
  });

  it('treats sprint auto-claims as broad scope-drift coverage', async () => {
    writeSprintState(10);
    const { createStore } = await import('../../src/store/index.js');
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    await store.claim({
      sprint_number: 10,
      player: 'test',
      target: 'sprint:S10',
      scope: 'area',
    });
    store.close();

    const result = await scopeDriftGuard(
      makeInput({
        tool_name: 'apply_patch',
        tool_input: { command: applyPatchCommand(join(tmpDir, 'src/cli/commands/version.ts')) },
      }),
      tmpDir,
    );

    expect(result).toEqual({});
  });

  it('fails open when disk state is older than 24 hours', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 10;

    // Seed disk state with old timestamp (25 hours ago)
    writeFileSync(join(tmpDir, '.slope/guard-state/scope-drift.json'), JSON.stringify({
      entries: [{
        file: 'packages/other/src/bar.ts',
        claimedAreas: 'src/core',
        sprint: 10,
        timestamp: Date.now() - (25 * 60 * 60 * 1000),
      }],
    }));

    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/other/src/bar.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('tags store failures without cached drift as state-unavailable', async () => {
    writeSprintState(10);

    const storeModule = await import('../../src/cli/store.js');
    const spy = vi.spyOn(storeModule, 'resolveStore').mockRejectedValueOnce(new Error('store unavailable'));

    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/other/src/bar.ts') } }),
      tmpDir,
    );

    expect(result).toEqual({ metricReason: 'state-unavailable' });
    spy.mockRestore();
  });

  it('clears disk state on sprint change', async () => {
    mkdirSync(join(tmpDir, '.slope/guard-state'), { recursive: true });
    (mockConfig as Record<string, unknown>).currentSprint = 11;

    // Seed disk state from sprint 10
    writeFileSync(join(tmpDir, '.slope/guard-state/scope-drift.json'), JSON.stringify({
      entries: [{
        file: 'packages/other/src/bar.ts',
        claimedAreas: 'src/core',
        sprint: 10,
        timestamp: Date.now(),
      }],
    }));

    const result = await scopeDriftGuard(
      makeInput({ tool_input: { file_path: join(tmpDir, 'packages/other/src/bar.ts') } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });
});

describe('compactionGuard', () => {
  it('returns empty when no session_id', async () => {
    const result = await compactionGuard(makeInput({ session_id: '' }), tmpDir);
    expect(result).toEqual({});
  });

  it('handles missing git repo gracefully', async () => {
    const result = await compactionGuard(makeInput({ session_id: 'test-123' }), tmpDir);
    // Always returns {} (side-effects only guard)
    expect(result).toEqual({});
  });

  it('creates handoffs directory when session_id present', async () => {
    await compactionGuard(makeInput({ session_id: 'test-abcd1234' }), tmpDir);
    expect(existsSync(join(tmpDir, '.slope/handoffs'))).toBe(true);
  });

  it('writes handoff file with session prefix', async () => {
    await compactionGuard(makeInput({ session_id: 'test-abcd1234-rest' }), tmpDir);
    const handoffPath = join(tmpDir, '.slope/handoffs', 'test-abc.json');
    expect(existsSync(handoffPath)).toBe(true);
    const data = JSON.parse(readFileSync(handoffPath, 'utf8'));
    expect(data.session_id).toBe('test-abcd1234-rest');
    expect(data.timestamp).toBeDefined();
  });

  it('uses custom handoffsDir from config', async () => {
    mockConfig.guidance = { handoffsDir: '.custom-handoffs' };
    await compactionGuard(makeInput({ session_id: 'test-abcd1234' }), tmpDir);
    expect(existsSync(join(tmpDir, '.custom-handoffs'))).toBe(true);
  });
});

describe('stopCheckGuard', () => {
  it('returns empty in non-git directory', async () => {
    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('returns empty when everything is committed and pushed', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('ignores untracked-only files (no warning)', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'orphan.txt'), 'untracked');

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toBeUndefined();
  });

  it('warns but does not block when modified (staged/unstaged) changes exist', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'tracked.txt'), 'original');
    execSync('git add tracked.txt && git commit -m "add file"', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'tracked.txt'), 'modified');

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('uncommitted');
  });

  it('warns on uncommitted changes but ignores untracked when both exist', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'tracked.txt'), 'original');
    execSync('git add tracked.txt && git commit -m "add file"', { cwd: tmpDir, stdio: 'ignore' });
    writeFileSync(join(tmpDir, 'tracked.txt'), 'modified');
    writeFileSync(join(tmpDir, 'orphan.txt'), 'untracked');

    const result = await stopCheckGuard(makeInput(), tmpDir);
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('uncommitted');
    expect(result.context).not.toContain('untracked');
  });
});

describe('subagentGateGuard', () => {
  it('passes through non-Explore/Plan agent types', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Bash', command: 'ls' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('passes through resumed agents', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'sonnet', resume: 'agent-123' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('denies non-haiku Explore agent', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'sonnet' } }),
      tmpDir,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('subagent-gate');
    expect(result.blockReason).toContain('sonnet');
  });

  it('denies Explore agent without model set (local fix #173)', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore' } }),
      tmpDir,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('subagent-gate');
    expect(result.blockReason).toContain('no model specified');
    expect(result.blockReason).toContain('haiku');
  });

  it('denies Plan agent without model set', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Plan' } }),
      tmpDir,
    );
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('no model specified');
  });

  it('allows correct Explore agent with orientation context', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku' } }),
      tmpDir,
    );
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('SLOPE subagent tip');
  });

  it('allows correct Plan agent with orientation context', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Plan', model: 'haiku' } }),
      tmpDir,
    );
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('SLOPE subagent tip');
  });

  it('includes stats when CODEBASE.md has frontmatter', async () => {
    const frontmatter = [
      '---',
      'cli_commands: 27',
      'guards: 13',
      'test_files: 45',
      'source_files: 90',
      '---',
      '# Codebase',
    ].join('\n');
    writeFileSync(join(tmpDir, 'CODEBASE.md'), frontmatter);

    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku' } }),
      tmpDir,
    );
    expect(result.context).toContain('27 CLI commands');
    expect(result.context).toContain('13 guards');
    expect(result.context).toContain('45 test files');
    expect(result.context).toContain('Glob/Grep');
  });

  it('returns fallback context when CODEBASE.md is missing', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'haiku' } }),
      tmpDir,
    );
    expect(result.context).toContain('Glob/Grep');
    expect(result.context).toContain('CODEBASE.md');
  });

  it('returns no context for non-Explore/Plan agents', async () => {
    const result = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Bash', model: 'haiku' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('respects custom config allowed models', async () => {
    mockConfig.guidance = {
      subagentAllowModels: ['haiku', 'sonnet'],
    };

    // sonnet allowed with custom config
    const result1 = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'sonnet' } }),
      tmpDir,
    );
    expect(result1.decision).toBeUndefined();
    expect(result1.context).toContain('SLOPE subagent tip');

    // opus denied even with custom config
    const result2 = await subagentGateGuard(
      makeInput({ tool_input: { subagent_type: 'Explore', model: 'opus' } }),
      tmpDir,
    );
    expect(result2.decision).toBe('deny');
  });
});

describe('pushNudgeGuard', () => {
  it('passes through non-git-commit commands', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'npm test' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('passes through git commit-tree plumbing commands', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'git commit-tree abc123 -p HEAD' } }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('passes through empty command', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: {} }),
      tmpDir,
    );
    expect(result).toEqual({});
  });

  it('handles non-git dir gracefully', async () => {
    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'git commit -m "test"' } }),
      tmpDir,
    );
    // Should not throw, may return empty or context
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('is non-blocking (context only, no decision/blockReason)', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" --allow-empty', { cwd: tmpDir, stdio: 'ignore' });

    const result = await pushNudgeGuard(
      makeInput({ tool_input: { command: 'git commit -m "test"' } }),
      tmpDir,
    );
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });
});

describe('workflowGateGuard', () => {
  it('passes through when no review-state.json', async () => {
    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('passes through when rounds complete', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 2,
      rounds_completed: 2,
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('denies when rounds incomplete', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 3,
      rounds_completed: 1,
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('workflow-gate');
    expect(result.blockReason).toContain('1/3');
  });

  it('handles malformed JSON', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), 'not json');

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });

  it('includes actionable recovery steps in deny message', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 2,
      rounds_completed: 0,
      plan_file: 'docs/backlog/sprint-22-plan.md',
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('0/2');
    expect(result.blockReason).toContain('slope review start --tier=');
    expect(result.blockReason).toContain('slope review round');
    expect(result.blockReason).toContain('slope review start --tier=skip');
  });

  it('passes through when state has invalid types', async () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify({
      rounds_required: 'two',
      rounds_completed: 'one',
    }));

    const result = await workflowGateGuard(makeInput(), tmpDir);
    expect(result).toEqual({});
  });
});
