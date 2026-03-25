import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { workflowStepGateGuard } from '../../../src/cli/guards/workflow-step-gate.js';
import { SqliteSlopeStore } from '../../../src/store/index.js';
import type { HookInput } from '../../../src/core/index.js';

const TMP = join(import.meta.dirname ?? __dirname, '..', '..', '..', '.test-tmp-step-gate');

function makeInput(): HookInput {
  return {
    session_id: 'test-session',
    cwd: TMP,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: '/foo/bar.ts' },
    tool_response: {},
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

async function createRunningExecution(store: SqliteSlopeStore, workflow: string, phase: string, step: string): Promise<void> {
  const exec = await store.startExecution({ workflow_name: workflow, sprint_id: 'S77' });
  await store.updateExecutionState(exec.id, phase, step);
}

describe('workflowStepGateGuard', () => {
  beforeEach(() => {
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
