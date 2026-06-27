import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { workflowStepGateGuard } from '../../../src/cli/guards/workflow-step-gate.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';
import type { HookInput } from '../../../src/core/index.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

let TMP: string;

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: 'test-session',
    cwd: TMP,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: '/foo/bar.ts' },
    tool_response: {},
    ...overrides,
  };
}

function writeConfig(overrides: Record<string, unknown> = {}): void {
  const slopeDir = join(TMP, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  writeFileSync(join(slopeDir, 'config.json'), JSON.stringify({
    store_path: '.slope/slope.db',
    ...overrides,
  }));
}

/** Write a minimal workflow definition that the guard can load */
function writeWorkflow(name: string, stepType: string): void {
  const workflowDir = join(TMP, '.slope', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  const stepExtra = stepType === 'command' ? '\n        command: echo test' :
                     stepType === 'validation' ? '\n        conditions:\n          - pnpm test passes' : '';
  writeFileSync(join(workflowDir, `${name}.yaml`), [
    "version: '1'",
    `name: ${name}`,
    'phases:',
    '  - id: phase1',
    '    name: Test Phase',
    '    steps:',
    '      - id: step1',
    `        type: ${stepType}`,
    `        prompt: Do something${stepExtra}`,
  ].join('\n'));
}

async function createRunningExecution(
  store: SqliteSlopeStore,
  workflow: string,
  phase: string,
  step: string,
  options: { sprintId?: string; sessionId?: string } = {},
): Promise<string> {
  const exec = await store.startExecution({
    workflow_name: workflow,
    sprint_id: options.sprintId ?? 'S77',
    session_id: options.sessionId,
  });
  await store.updateExecutionState(exec.id, phase, step);
  return exec.id;
}

function writeScorecard(sprint: number): void {
  mkdirSync(join(TMP, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(TMP, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify({
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par: 4,
    slope: 1,
    score: 4,
    score_label: 'par',
    shots: [],
    stats: { fairways_hit: 0, fairways_total: 0, greens_in_regulation: 0, greens_total: 0, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0, miss_directions: { long: 0, short: 0, left: 0, right: 0 } },
    conditions: [],
    special_plays: [],
    bunker_locations: [],
    yardage_book_updates: [],
    course_management_notes: [],
  }));
}

function writeRoadmap(sprints: Array<{ id: number; status: string }>): void {
  mkdirSync(join(TMP, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(TMP, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Workflow Step Gate Test Roadmap',
    phases: [{ name: 'Phase 1', sprints: sprints.map(sprint => sprint.id) }],
    sprints: sprints.map(({ id, status }) => ({
      id,
      theme: `Sprint ${id}`,
      par: 4,
      slope: 1,
      type: 'bugfix',
      status,
      tickets: [
        { key: `S${id}-1`, title: 'Ticket 1', club: 'short_iron', complexity: 'standard' },
        { key: `S${id}-2`, title: 'Ticket 2', club: 'wedge', complexity: 'small' },
        { key: `S${id}-3`, title: 'Ticket 3', club: 'putter', complexity: 'trivial' },
      ],
    })),
  }, null, 2));
}

function waitForTimestampTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 5));
}

function initGitForSprint(sprint: number): void {
  execFileSync('git', ['init'], { cwd: TMP, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: TMP });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: TMP });
  writeFileSync(join(TMP, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: TMP });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: TMP, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', `feat/sprint-${sprint}`], { cwd: TMP, stdio: 'ignore' });
  writeFileSync(join(TMP, 'feature.txt'), `S${sprint}\n`);
  execFileSync('git', ['add', 'feature.txt'], { cwd: TMP });
  execFileSync('git', ['commit', '-m', `fix(S${sprint}-1): existing sprint work`], { cwd: TMP, stdio: 'ignore' });
}

describe('workflowStepGateGuard', () => {
  beforeEach(() => {
    TMP = mkdtempSync(join(tmpdir(), 'slope-step-gate-'));
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) {
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('allows when store does not exist', async () => {
    writeConfig();
    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows when no active execution', async () => {
    writeConfig();
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows file edit on agent_work step', async () => {
    writeConfig();
    writeWorkflow('test-wf', 'agent_work');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'test-wf', 'phase1', 'step1');
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('uses current sprint execution instead of unrelated active[0] (#531)', async () => {
    writeConfig();
    saveSprintState(TMP, createSprintState(531, 'implementing'));
    writeWorkflow('current-wf', 'agent_work');
    writeWorkflow('unrelated-wf', 'command');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'current-wf', 'phase1', 'step1', { sprintId: 'S531' });
    await waitForTimestampTick();
    await createRunningExecution(store, 'unrelated-wf', 'phase1', 'step1', { sprintId: 'S85' });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('uses matching session execution instead of unrelated active[0] (#531)', async () => {
    writeConfig();
    writeWorkflow('session-wf', 'agent_work');
    writeWorkflow('unrelated-wf', 'command');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'session-wf', 'phase1', 'step1', {
      sprintId: 'S77',
      sessionId: 'test-session',
    });
    await waitForTimestampTick();
    await createRunningExecution(store, 'unrelated-wf', 'phase1', 'step1', {
      sprintId: 'S85',
      sessionId: 'other-session',
    });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('prefers current sprint over a stale execution from the same session (#531)', async () => {
    writeConfig();
    saveSprintState(TMP, createSprintState(531, 'implementing'));
    writeWorkflow('current-wf', 'agent_work');
    writeWorkflow('stale-session-wf', 'command');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'current-wf', 'phase1', 'step1', { sprintId: 'S531' });
    await waitForTimestampTick();
    await createRunningExecution(store, 'stale-session-wf', 'phase1', 'step1', {
      sprintId: 'S85',
      sessionId: 'test-session',
    });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
  });

  it('fails open when multiple executions cannot be disambiguated (#531)', async () => {
    writeConfig();
    writeWorkflow('command-wf', 'command');
    writeWorkflow('validation-wf', 'validation');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'command-wf', 'phase1', 'step1', { sprintId: 'S77' });
    await waitForTimestampTick();
    await createRunningExecution(store, 'validation-wf', 'phase1', 'step1', { sprintId: 'S85' });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('multiple running workflow executions');
  });

  it('fails open when a single validation execution does not match current sprint context (#572)', async () => {
    writeConfig();
    saveSprintState(TMP, createSprintState(217, 'implementing'));
    writeWorkflow('stale-validation-wf', 'validation');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'stale-validation-wf', 'phase1', 'step1', { sprintId: 'S23' });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);

    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('does not match the current sprint/session context');
    expect(result.context).toContain('S23');
    expect(result.context).toContain('cleanup --stale');
  });

  it('pauses scorecarded roadmap-complete validation executions before they can block edits (#572)', async () => {
    writeConfig({
      roadmapPath: 'docs/backlog/roadmap.json',
      scorecardDir: 'docs/retros',
      scorecardPattern: 'sprint-*.json',
    });
    saveSprintState(TMP, createSprintState(217, 'implementing'));
    writeWorkflow('stale-validation-wf', 'validation');
    writeScorecard(23);
    writeRoadmap([
      { id: 23, status: 'complete' },
      { id: 217, status: 'planned' },
    ]);

    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    const execId = await createRunningExecution(store, 'stale-validation-wf', 'phase1', 'step1', { sprintId: 'S23' });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);

    expect(result.decision).toBeUndefined();
    expect(result.blockReason).toBeUndefined();
    expect(result.context).toContain('paused 1 stale workflow execution');

    const updated = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    try {
      await expect(updated.getExecution(execId)).resolves.toMatchObject({ status: 'paused' });
    } finally {
      updated.close();
    }
  });

  it('blocks file edit on command step', async () => {
    writeConfig();
    writeWorkflow('test-wf', 'command');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'test-wf', 'phase1', 'step1');
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('command');
    expect(result.blockReason).toContain('not "agent_work"');
  });

  it('blocks file edit on validation step', async () => {
    writeConfig();
    writeWorkflow('test-wf', 'validation');
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'test-wf', 'phase1', 'step1');
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBe('deny');
    expect(result.blockReason).toContain('validation');
    expect(result.blockReason).toContain('cleanup --stale');
  });

  it('fast-forwards a branch sprint execution before blocking edits (#503)', async () => {
    writeConfig();
    initGitForSprint(66);
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    const exec = await store.startExecution({ workflow_name: 'sprint-standard', sprint_id: 'S66' });
    await store.updateExecutionState(exec.id, 'pre_hole', 'verify_previous');
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result.decision).toBeUndefined();
    expect(result.context).toContain('fast-forwarded S66');

    const updated = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    try {
      await expect(updated.getExecutionBySprint('S66')).resolves.toMatchObject({
        current_phase: 'per_ticket',
        current_step: 'implement',
      });
    } finally {
      updated.close();
    }
  });

  it('allows when workflow definition not found', async () => {
    writeConfig();
    // No workflow file written — guard should fail open
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    await createRunningExecution(store, 'nonexistent-wf', 'phase1', 'step1');
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });

  it('allows when execution has no current step', async () => {
    writeConfig();
    const store = new SqliteSlopeStore(join(TMP, '.slope/slope.db'));
    // startExecution creates with current_phase/step = undefined — exactly what we want
    await store.startExecution({ workflow_name: 'test-wf', sprint_id: 'S77' });
    store.close();

    const result = await workflowStepGateGuard(makeInput(), TMP);
    expect(result).toEqual({});
  });
});
