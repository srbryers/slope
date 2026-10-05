import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  findSprintStateProblem,
  formatSprintStateDiagnosis,
  initializeSprintState,
  loadSprintState,
  loadSprintStateResult,
  mutateSprintState,
  readSprintStateFile,
  replaceSprintState,
  saveSprintState,
  sprintStatePath,
  createSprintState,
} from '../../src/cli/sprint-state.js';
import { runDoctorChecks } from '../../src/cli/commands/doctor.js';
import { sprintCompletionGuard } from '../../src/cli/guards/sprint-completion.js';
import {
  PRELUDE_DRAFT,
  SPRINT_STATE,
  activeState,
  addWorktree,
  cleanupFixtures,
  commitAll,
  completeState,
  git,
  initRepo,
  nullGateActiveState,
  writeConfig,
  writeFile,
  writeScorecard,
  writeState,
} from '../helpers/sprint-evidence-fixtures.js';
import { resolveRepoStatePath } from '../../src/core/repo-state-scope.js';

afterEach(cleanupFixtures);

describe('findSprintStateProblem names the first bad field', () => {
  it.each<[string, (state: Record<string, any>) => void, string, RegExp]>([
    ['a null gate', s => { s.gates.tests = null; }, 'gates.tests', /true or false \(found null\)/],
    ['a string gate', s => { s.gates.scorecard = 'yes'; }, 'gates.scorecard', /found "yes"/],
    ['a missing gate', s => { delete s.gates.review_md; }, 'gates.review_md', /found missing/],
    ['no gates object', s => { delete s.gates; }, 'gates', /found missing/],
    ['an unknown phase', s => { s.phase = 'planned'; }, 'phase', /one of planning, reviewing/],
    ['a missing started_at', s => { delete s.started_at; }, 'started_at', /ISO-8601/],
    ['a bad updated_at', s => { s.updated_at = 'yesterday'; }, 'updated_at', /found "yesterday"/],
    ['a non-numeric sprint', s => { s.sprint = 'H1-agentic-ui-kit'; }, 'sprint', /positive sprint id/],
    ['a bad review provenance', s => { s.review_gates.code_review.provenance = 'vibes'; }, 'review_gates.code_review.provenance', /one of pending/],
    ['bad review evidence', s => { s.review_gates.architect_review.evidence = 'x'; }, 'review_gates.architect_review.evidence', /array of strings/],
    ['a bad requirement priority', s => { s.review_requirements.code_review.priority = 'urgent'; }, 'review_requirements.code_review.priority', /required, recommended/],
    ['a bad rollover id', s => { s.rollover = { transition_id: 'x' }; }, 'rollover.transition_id', /16 lowercase hex/],
  ])('%s', (_label, mutate, field, message) => {
    const state = JSON.parse(JSON.stringify(activeState('70')));
    mutate(state);

    const found = findSprintStateProblem(state);

    expect(found?.field).toBe(field);
    expect(found?.message).toMatch(message);
  });

  it('reports no problem for valid active and complete evidence', () => {
    expect(findSprintStateProblem(activeState('70'))).toBeNull();
    expect(findSprintStateProblem(completeState('64.6'))).toBeNull();
  });
});

describe('readSprintStateFile classification (#744)', () => {
  it('classifies the Prelude shape as a draft, not corrupt', () => {
    const root = initRepo();
    const path = writeState(root, PRELUDE_DRAFT);

    expect(readSprintStateFile(path)).toEqual({ status: 'draft', path });
  });

  it('classifies drafts with absent timestamps, absent or all-false gates, or a numeric sprint as drafts', () => {
    const root = initRepo();
    const allFalse = { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false };
    for (const draft of [
      { phase: 'planned' },
      { phase: 'planned', sprint: 12, gates: null },
      { phase: 'planned', sprint: '12', gates: {}, started_at: null, updated_at: null },
      { phase: 'planned', sprint: '12', gates: allFalse },
      { phase: 'planned', sprint: '12', gates: { ...allFalse, tests: null } },
    ]) {
      expect(readSprintStateFile(writeState(root, draft)).status, JSON.stringify(draft)).toBe('draft');
    }
  });

  it('keeps invalid active states corrupt, with a diagnosis', () => {
    const root = initRepo();
    const path = writeState(root, nullGateActiveState());

    const loaded = readSprintStateFile(path);

    expect(loaded.status).toBe('corrupt');
    if (loaded.status !== 'corrupt') return;
    expect(loaded.diagnosis).toMatchObject({ path, field: 'gates.tests' });
    expect(formatSprintStateDiagnosis(loaded.diagnosis).join('\n')).toContain(path);
  });

  it('does not call a planned file a draft once anything has been recorded', () => {
    const root = initRepo();
    const allFalse = { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false };
    for (const file of [
      { phase: 'planned', gates: { ...allFalse, tests: true } },
      { phase: 'planned', gates: allFalse, started_at: '2026-09-30T00:00:00.000Z' },
      { phase: 'planned', gates: allFalse, updated_at: '2026-09-30T00:00:00.000Z' },
      { phase: 'planned', gates: { ...allFalse, tests: 'yes' } },
      { phase: 'implementing', gates: allFalse },
    ]) {
      expect(readSprintStateFile(writeState(root, file)).status, JSON.stringify(file)).toBe('corrupt');
    }
  });

  it('reports a sprint id as written rather than as normalized', () => {
    const root = initRepo();
    const path = writeState(root, { ...activeState('70'), sprint: 'H1-agentic-ui-kit' });

    const loaded = readSprintStateFile(path);

    expect(loaded.status === 'corrupt' && loaded.diagnosis.message).toContain('found "H1-agentic-ui-kit"');
  });

  it('reads a draft as no state through the lenient loader', () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, PRELUDE_DRAFT);

    expect(loadSprintState(root)).toBeNull();
  });
});

describe('persistence refuses null gates (#744)', () => {
  it('saveSprintState throws, names the file and field, and leaves the existing file untouched', () => {
    const root = initRepo();
    writeConfig(root);
    saveSprintState(root, activeState('70'));
    const path = join(root, SPRINT_STATE);
    const before = readFileSync(path, 'utf8');
    const bad = activeState('70') as any;
    bad.gates.tests = null;

    expect(() => saveSprintState(root, bad)).toThrow(new RegExp(`${path}.*gates\\.tests.*true or false`));

    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('mutateSprintState and replaceSprintState refuse to persist a null gate', () => {
    const root = initRepo();
    writeConfig(root);
    saveSprintState(root, activeState('70'));
    const path = join(root, SPRINT_STATE);
    const before = readFileSync(path, 'utf8');

    expect(() => mutateSprintState(root, state => { (state.gates as any).code_review = null; return true; }))
      .toThrow(/gates\.code_review/);
    expect(() => replaceSprintState(root, state => ({ ...state, gates: { ...state.gates, tests: undefined as any } })))
      .toThrow(/gates\.tests/);

    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('initializeSprintState will not create a state with a null gate', () => {
    const root = initRepo();
    writeConfig(root);
    const bad = createSprintState('5', 'planning') as any;
    bad.gates.review_md = null;

    expect(() => initializeSprintState(root, bad)).toThrow(/gates\.review_md/);
    expect(loadSprintStateResult(root).status).toBe('missing');
  });

  it('does not overwrite or normalize a draft when starting', () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, PRELUDE_DRAFT);
    const before = readFileSync(path, 'utf8');

    const result = initializeSprintState(root, createSprintState('5', 'planning'));

    expect(result).toEqual({ status: 'draft', path });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('sprintStatePath policy (#748)', () => {
  it('keeps shared (ignored) state with the primary checkout', () => {
    const primary = initRepo();
    writeFile(primary, '.gitignore', '.slope/\n');
    writeConfig(primary);
    writeState(primary, activeState('70'));
    const wt = addWorktree(primary, 'feat/shared');

    expect(sprintStatePath(wt)).toBe(join(primary, SPRINT_STATE));
    expect(sprintStatePath(primary)).toBe(join(primary, SPRINT_STATE));
  });

  it('gives each checkout its own tracked copy', () => {
    const primary = initRepo();
    writeConfig(primary);
    writeState(primary, completeState('64.6'));
    const base = commitAll(primary, 'tracked evidence');
    const wt = addWorktree(primary, 'feat/tracked', base);

    expect(sprintStatePath(wt)).toBe(join(wt, SPRINT_STATE));
    expect(sprintStatePath(primary)).toBe(join(primary, SPRINT_STATE));
  });

  it('points a worktree with no copy at its own path when the primary\'s copy is tracked, so writes stay on its branch', () => {
    const primary = initRepo();
    writeConfig(primary);
    const base = commitAll(primary, 'config only');
    writeState(primary, activeState('70'));
    commitAll(primary, 'primary tracks evidence');
    const wt = addWorktree(primary, 'feat/none', base);

    expect(sprintStatePath(wt)).toBe(join(wt, SPRINT_STATE));
    expect(loadSprintStateResult(wt).status).toBe('missing');

    saveSprintState(wt, activeState('71'));
    expect(JSON.parse(readFileSync(join(wt, SPRINT_STATE), 'utf8')).sprint).toBe('71');
    expect(JSON.parse(readFileSync(join(primary, SPRINT_STATE), 'utf8')).sprint).toBe('70');
  });

  it('keeps ownership with a tracked file that is deleted from disk, for reads and writes', () => {
    const primary = initRepo();
    writeConfig(primary);
    writeState(primary, completeState('64.6'));
    const base = commitAll(primary, 'branch tracks its evidence');
    git(primary, ['rm', '-r', '--cached', '-q', '.slope']);
    writeFile(primary, '.gitignore', '.slope/\n');
    git(primary, ['add', '.gitignore']);
    git(primary, ['commit', '-q', '-m', 'untrack .slope']);
    const sharedPath = writeState(primary, activeState('71'));
    const wt = addWorktree(primary, 'feat/deleted', base);
    rmSync(join(wt, SPRINT_STATE));
    const before = readFileSync(sharedPath, 'utf8');

    expect(sprintStatePath(wt)).toBe(join(wt, SPRINT_STATE));
    expect(loadSprintStateResult(wt).status).toBe('missing');

    saveSprintState(wt, activeState('70'));

    expect(JSON.parse(readFileSync(join(wt, SPRINT_STATE), 'utf8')).sprint).toBe('70');
    expect(readFileSync(sharedPath, 'utf8')).toBe(before);
  });

  it('does not borrow a primary file that is tracked but deleted from its disk', () => {
    const primary = initRepo();
    writeConfig(primary);
    const base = commitAll(primary, 'config only');
    const primaryPath = writeState(primary, activeState('71'));
    commitAll(primary, 'primary tracks evidence');
    rmSync(primaryPath);
    const wt = addWorktree(primary, 'feat/none', base);

    expect(sprintStatePath(wt)).toBe(join(wt, SPRINT_STATE));
    saveSprintState(wt, activeState('70'));
    expect(JSON.parse(readFileSync(join(wt, SPRINT_STATE), 'utf8')).sprint).toBe('70');
  });

  it('does not move sessions or claims: only sprint-state resolution changed', () => {
    const primary = initRepo();
    writeConfig(primary);
    writeState(primary, completeState('64.6'));
    const base = commitAll(primary, 'tracked evidence');
    const wt = addWorktree(primary, 'feat/ops', base);

    // Other repository state still resolves to the primary checkout.
    expect(resolveRepoStatePath(wt, '.slope/slope.db')).toBe(join(primary, '.slope', 'slope.db'));
  });
});

describe('doctor and the guard share one diagnosis (#742)', () => {
  function pr(cwd: string) {
    return {
      session_id: 'parity',
      cwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --title x' },
    } as const;
  }

  it('reports the same file, field and repair for the same corrupt evidence', async () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, nullGateActiveState());

    const check = runDoctorChecks(root).find(c => c.name === 'sprint-state');
    const guard = await sprintCompletionGuard(pr(root), root);

    expect(check?.status).toBe('fail');
    // Literal expectations, so the parity claim does not depend on the shared helper.
    for (const text of [
      `Sprint evidence file: ${path}`,
      'Problem: `gates.tests` must be true or false (found null)',
      `Edit ${path} and set \`gates.tests\` to \`false\``,
      'complete the gate with `slope sprint gate tests`',
      `mv "${path}" "${path}.bak"`,
    ]) {
      expect(check?.message, text).toContain(text);
      expect(guard.blockReason, text).toContain(text);
    }
  });

  it('builds both reports from the shared formatter lines', async () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, nullGateActiveState());
    const loaded = loadSprintStateResult(root);
    if (loaded.status !== 'corrupt') throw new Error('fixture should be corrupt');

    const check = runDoctorChecks(root).find(c => c.name === 'sprint-state');
    const guard = await sprintCompletionGuard(pr(root), root);

    for (const line of formatSprintStateDiagnosis(loaded.diagnosis)) {
      expect(check?.message).toContain(line);
      expect(guard.blockReason).toContain(line);
    }
  });

  it('reports a JSON parse error identically', async () => {
    const root = initRepo();
    writeConfig(root);
    const path = writeState(root, '{"sprint": ');

    const check = runDoctorChecks(root).find(c => c.name === 'sprint-state');
    const guard = await sprintCompletionGuard(pr(root), root);

    for (const text of [`Sprint evidence file: ${path}`, 'Problem: `JSON` is not valid JSON: ', `Fix the JSON syntax error in ${path}`]) {
      expect(check?.message, text).toContain(text);
      expect(guard.blockReason, text).toContain(text);
    }
  });

  it('judges the checkout it runs in: a repaired worktree is healthy beside a corrupt primary', () => {
    const primary = initRepo();
    writeConfig(primary);
    writeScorecard(primary, '64.6');
    writeState(primary, completeState('64.6'));
    const repaired = commitAll(primary, 'repaired');
    writeState(primary, nullGateActiveState());
    commitAll(primary, 'bad');
    const wt = addWorktree(primary, 'feat/doctor', repaired);

    expect(runDoctorChecks(wt).find(c => c.name === 'sprint-state')).toMatchObject({ status: 'ok' });
    expect(runDoctorChecks(primary).find(c => c.name === 'sprint-state')).toMatchObject({ status: 'fail' });
  });

  it('treats a planned draft as healthy and says no sprint is in progress', () => {
    const root = initRepo();
    writeConfig(root);
    writeState(root, PRELUDE_DRAFT);

    expect(runDoctorChecks(root).find(c => c.name === 'sprint-state')).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('planned draft; no sprint in progress'),
    });
  });

  it('adds no sprint-state check when no sprint-state exists', () => {
    const root = initRepo();
    writeConfig(root);

    expect(runDoctorChecks(root).find(c => c.name === 'sprint-state')).toBeUndefined();
  });
});
