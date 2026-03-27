import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HookInput } from '../../src/core/index.js';

let tmpDir: string;

// Mock process.cwd
vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);

// Mock resolveStore — default: no store available
const mockStore = {
  getActiveTestingSession: vi.fn().mockResolvedValue(null),
  getActiveClaims: vi.fn().mockResolvedValue([]),
  close: vi.fn(),
};
vi.mock('../../src/cli/store.js', () => ({
  resolveStore: vi.fn().mockRejectedValue(new Error('no store')),
}));

import { nextActionGuard, detectSprintState, buildSuggestions, buildSuggestionObject } from '../../src/cli/guards/next-action.js';
import { resolveStore } from '../../src/cli/store.js';

const mockedResolveStore = vi.mocked(resolveStore);

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: '',
    cwd: tmpDir,
    hook_event_name: 'Stop',
    ...overrides,
  };
}

function initSlopeDir(config: Record<string, unknown> = {}): void {
  const slopeDir = join(tmpDir, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    commonIssuesPath: '.slope/common-issues.json',
    sessionsPath: '.slope/sessions.json',
    registry: 'file',
    claimsPath: '.slope/claims.json',
    roadmapPath: '',
    flowsPath: '.slope/flows.json',
    metaphor: 'golf',
    ...config,
  }));
}

function writeScorecard(sprintNumber: number): void {
  const retrosDir = join(tmpDir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  writeFileSync(join(retrosDir, `sprint-${sprintNumber}.json`), JSON.stringify({
    sprint_number: sprintNumber,
    course: 'test',
    date: '2026-02-23',
    par: 4,
    holes: [],
  }));
}

function writeReview(sprintNumber: number): void {
  const retrosDir = join(tmpDir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  writeFileSync(join(retrosDir, `sprint-${sprintNumber}-review.md`), '# Sprint Review');
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-next-action-'));
  vi.clearAllMocks();
  // Default: store unavailable
  mockedResolveStore.mockRejectedValue(new Error('no store'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectSprintState', () => {
  it('returns mid-sprint when store has active claims', async () => {
    initSlopeDir();
    mockStore.getActiveClaims.mockResolvedValue([
      { id: '1', sprint_number: 26, player: 'alice', target: 'S26-1', scope: 'ticket', claimed_at: '' },
      { id: '2', sprint_number: 26, player: 'alice', target: 'S26-2', scope: 'ticket', claimed_at: '' },
    ]);
    mockedResolveStore.mockResolvedValue(mockStore as never);

    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('mid-sprint');
    if (state.type === 'mid-sprint') {
      expect(state.sprintNumber).toBe(26);
      expect(state.claimCount).toBe(2);
      expect(state.targets).toEqual(['S26-1', 'S26-2']);
    }
  });

  it('returns mid-sprint from filesystem fallback when store fails', async () => {
    initSlopeDir();
    const claimsPath = join(tmpDir, '.slope', 'claims.json');
    writeFileSync(claimsPath, JSON.stringify([
      { sprint_number: 25, target: 'T-1' },
    ]));

    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('mid-sprint');
    if (state.type === 'mid-sprint') {
      expect(state.sprintNumber).toBe(25);
      expect(state.claimCount).toBe(1);
    }
  });

  it('returns needs-review when scorecard exists but no review', async () => {
    initSlopeDir();
    mockStore.getActiveClaims.mockResolvedValue([]);
    mockedResolveStore.mockResolvedValue(mockStore as never);
    writeScorecard(26);

    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('needs-review');
    if (state.type === 'needs-review') {
      expect(state.sprintNumber).toBe(26);
    }
  });

  it('returns between-sprints when scorecard and review both exist', async () => {
    initSlopeDir();
    mockStore.getActiveClaims.mockResolvedValue([]);
    mockedResolveStore.mockResolvedValue(mockStore as never);
    writeScorecard(26);
    writeReview(26);

    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('between-sprints');
  });

  it('returns between-sprints when no claims, no scorecards', async () => {
    initSlopeDir();
    mockStore.getActiveClaims.mockResolvedValue([]);
    mockedResolveStore.mockResolvedValue(mockStore as never);

    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('between-sprints');
  });

  it('gracefully degrades to between-sprints when store throws', async () => {
    initSlopeDir();
    // Default mock already rejects

    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('between-sprints');
  });

  it('gracefully degrades to between-sprints when no config', async () => {
    // No .slope dir at all
    const state = await detectSprintState(tmpDir);
    expect(state.type).toBe('between-sprints');
  });
});

describe('buildSuggestionObject', () => {
  it('includes claim targets for mid-sprint', () => {
    const suggestion = buildSuggestionObject({
      type: 'mid-sprint',
      sprintNumber: 26,
      claimCount: 2,
      targets: ['S26-1', 'S26-2'],
    });
    expect(suggestion.id).toBe('next-action-mid-sprint');
    expect(suggestion.context).toContain('S26-1, S26-2');
    expect(suggestion.options.map(o => o.label)).toContain('Continue with the next ticket');
    expect(suggestion.requiresDecision).toBe(false);
  });

  it('includes scoring options for sprint-complete', () => {
    const suggestion = buildSuggestionObject({ type: 'sprint-complete', sprintNumber: 26 });
    expect(suggestion.context).toContain('Sprint 26 is complete but unscored');
    expect(suggestion.options.map(o => o.label)).toContain('Score the sprint');
  });

  it('includes review options for needs-review', () => {
    const suggestion = buildSuggestionObject({ type: 'needs-review', sprintNumber: 26 });
    expect(suggestion.context).toContain('Sprint 26 has a scorecard but no review');
    expect(suggestion.options.map(o => o.label)).toContain('Generate sprint review');
  });

  it('includes roadmap context for between-sprints', () => {
    const suggestion = buildSuggestionObject({
      type: 'between-sprints',
      roadmapContext: 'Sprint 2 of 5 — S27: Observability',
    });
    expect(suggestion.context).toContain('No active sprint');
    expect(suggestion.context).toContain('Sprint 2 of 5');
    expect(suggestion.options.map(o => o.label)).toContain('Start a new sprint');
  });

  it('works without roadmap context for between-sprints', () => {
    const suggestion = buildSuggestionObject({ type: 'between-sprints' });
    expect(suggestion.context).toContain('No active sprint');
    expect(suggestion.options.map(o => o.label)).toContain('Start a new sprint');
    expect(suggestion.context).not.toContain('undefined');
  });
});

describe('buildSuggestions (deprecated wrapper)', () => {
  it('includes claim targets for mid-sprint', () => {
    const text = buildSuggestions({
      type: 'mid-sprint',
      sprintNumber: 26,
      claimCount: 2,
      targets: ['S26-1', 'S26-2'],
    });
    expect(text).toContain('SLOPE');
    expect(text).toContain('S26-1, S26-2');
    expect(text).toContain('Continue with the next ticket');
    expect(text).toContain('AskUserQuestion');
  });

  it('includes scoring options for sprint-complete', () => {
    const text = buildSuggestions({ type: 'sprint-complete', sprintNumber: 26 });
    expect(text).toContain('Sprint 26 is complete but unscored');
    expect(text).toContain('Score the sprint');
  });

  it('includes review options for needs-review', () => {
    const text = buildSuggestions({ type: 'needs-review', sprintNumber: 26 });
    expect(text).toContain('Sprint 26 has a scorecard but no review');
    expect(text).toContain('Generate sprint review');
  });

  it('includes roadmap context for between-sprints', () => {
    const text = buildSuggestions({
      type: 'between-sprints',
      roadmapContext: 'Sprint 2 of 5 — S27: Observability',
    });
    expect(text).toContain('No active sprint');
    expect(text).toContain('Sprint 2 of 5');
    expect(text).toContain('Start a new sprint');
  });

  it('works without roadmap context for between-sprints', () => {
    const text = buildSuggestions({ type: 'between-sprints' });
    expect(text).toContain('No active sprint');
    expect(text).toContain('Start a new sprint');
    expect(text).not.toContain('undefined');
  });
});

describe('re-prompt prevention', () => {
  it('returns empty when session_id matches state file', async () => {
    initSlopeDir();
    const stateFile = join(tmpDir, '.slope', '.next-action-prompted');
    writeFileSync(stateFile, JSON.stringify({ session_id: 'sess-123', prompted_at: '' }));

    const result = await nextActionGuard(makeInput({ session_id: 'sess-123' }), tmpDir);
    expect(result).toEqual({});
  });

  it('fires when session_id differs from state file', async () => {
    initSlopeDir();
    const stateFile = join(tmpDir, '.slope', '.next-action-prompted');
    writeFileSync(stateFile, JSON.stringify({ session_id: 'sess-old', prompted_at: '' }));

    const result = await nextActionGuard(makeInput({ session_id: 'sess-new' }), tmpDir);
    expect(result.suggestion).toBeDefined();
  });

  it('always fires when session_id is empty (manual test)', async () => {
    initSlopeDir();
    const stateFile = join(tmpDir, '.slope', '.next-action-prompted');
    writeFileSync(stateFile, JSON.stringify({ session_id: 'anything', prompted_at: '' }));

    const result = await nextActionGuard(makeInput({ session_id: '' }), tmpDir);
    expect(result.suggestion).toBeDefined();
  });
});

describe('atomic state file write', () => {
  it('writes valid JSON to .next-action-prompted after guard runs', async () => {
    initSlopeDir();
    const result = await nextActionGuard(makeInput({ session_id: 'sess-abc' }), tmpDir);
    expect(result.suggestion).toBeDefined();

    const stateFile = join(tmpDir, '.slope', '.next-action-prompted');
    expect(existsSync(stateFile)).toBe(true);
    const data = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(data.session_id).toBe('sess-abc');
    expect(data.prompted_at).toBeTruthy();
  });

  it('creates .slope dir if missing', async () => {
    // No initSlopeDir — just bare tmpDir
    const result = await nextActionGuard(makeInput({ session_id: 'sess-xyz' }), tmpDir);
    expect(result.suggestion).toBeDefined();

    const stateFile = join(tmpDir, '.slope', '.next-action-prompted');
    expect(existsSync(stateFile)).toBe(true);
  });
});
