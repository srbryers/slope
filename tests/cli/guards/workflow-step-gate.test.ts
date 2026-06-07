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
): Promise<void> {
  const exec = await store.startExecution({
    workflow_name: workflow,
    sprint_id: options.sprintId ?? 'S77',
    session_id: options.sessionId,
  });
  await store.updateExecutionState(exec.id, phase, step);
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
