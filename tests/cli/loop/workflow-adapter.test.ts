import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore } from '../../../src/store/index.js';
import { WorkflowAdapter } from '../../../src/cli/loop/workflow-adapter.js';
import type { LoopConfig, BacklogSprint } from '../../../src/cli/loop/types.js';
import { DEFAULT_LOOP_CONFIG } from '../../../src/cli/loop/types.js';
import type { Logger } from '../../../src/cli/loop/logger.js';

let store: SqliteSlopeStore;
let tmpDir: string;

const mockLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLog,
};

const TEST_SPRINT: BacklogSprint = {
  id: 'S99',
  title: 'Test Sprint',
  strategy: 'hardening',
  par: 4,
  slope: 1,
  type: 'feature',
  tickets: [
    { key: 'T1', title: 'Ticket 1', club: 'short_iron', description: 'Desc', acceptance_criteria: ['AC1'], modules: ['core'], max_files: 2 },
    { key: 'T2', title: 'Ticket 2', club: 'wedge', description: 'Desc', acceptance_criteria: ['AC1'], modules: ['cli'], max_files: 1 },
  ],
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-wf-adapter-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('WorkflowAdapter', () => {
  it('reports disabled when no workflowName', () => {
    const adapter = new WorkflowAdapter(DEFAULT_LOOP_CONFIG, store, mockLog);
    expect(adapter.enabled).toBe(false);
  });

  it('reports enabled when workflowName set', () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, workflowName: 'sprint-standard' };
    const adapter = new WorkflowAdapter(config, store, mockLog);
    expect(adapter.enabled).toBe(true);
  });

  it('returns null from start when disabled', async () => {
    const adapter = new WorkflowAdapter(DEFAULT_LOOP_CONFIG, store, mockLog);
    const result = await adapter.start(TEST_SPRINT, tmpDir);
    expect(result).toBeNull();
  });

  it('starts a workflow execution', async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, workflowName: 'sprint-standard' };
    const adapter = new WorkflowAdapter(config, store, mockLog);

    const exec = await adapter.start(TEST_SPRINT, tmpDir);
    expect(exec).not.toBeNull();
    expect(exec!.workflow_name).toBe('sprint-standard');
    expect(exec!.sprint_id).toBe('S99');
    expect(adapter.executionId).toBeTruthy();
    expect(adapter.status).toBe('running');
  });

  it('returns next step after start', async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, workflowName: 'sprint-standard' };
    const adapter = new WorkflowAdapter(config, store, mockLog);
    await adapter.start(TEST_SPRINT, tmpDir);

    const next = await adapter.next();
    expect(next).not.toBeNull();
    expect(next!.is_complete).toBe(false);
    expect(next!.phase).toBe('pre_hole');
    expect(next!.step_id).toBe('briefing');
    expect(next!.step_type).toBe('command');
  });

  it('advances through steps on complete', async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, workflowName: 'sprint-standard' };
    const adapter = new WorkflowAdapter(config, store, mockLog);
    await adapter.start(TEST_SPRINT, tmpDir);

    await adapter.completeStep('briefing', {}, 0);
    const next = await adapter.next();
    expect(next!.step_id).toBe('verify_previous');
  });

  it('skips steps', async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, workflowName: 'sprint-standard' };
    const adapter = new WorkflowAdapter(config, store, mockLog);
    await adapter.start(TEST_SPRINT, tmpDir);

    await adapter.skipStep('briefing', 'Test skip');
    const next = await adapter.next();
    expect(next!.step_id).toBe('verify_previous');
  });

  it('fails the workflow', async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, workflowName: 'sprint-standard' };
    const adapter = new WorkflowAdapter(config, store, mockLog);
    await adapter.start(TEST_SPRINT, tmpDir);

    await adapter.fail();
    expect(adapter.status).toBe('failed'); // fail() now updates local cache
    const exec = await store.getExecution(adapter.executionId!);
    expect(exec!.status).toBe('failed');
  });

  it('returns null from next when not started', async () => {
    const adapter = new WorkflowAdapter(DEFAULT_LOOP_CONFIG, store, mockLog);
    const next = await adapter.next();
    expect(next).toBeNull();
  });

  it('passes workflow variables from config', async () => {
    const config: LoopConfig = {
      ...DEFAULT_LOOP_CONFIG,
      workflowName: 'sprint-standard',
      workflowVariables: { custom: 'value' },
    };
    const adapter = new WorkflowAdapter(config, store, mockLog);
    const exec = await adapter.start(TEST_SPRINT, tmpDir);

    expect(exec!.variables.custom).toBe('value');
    expect(exec!.variables.sprint_id).toBe('S99');
    expect(exec!.variables.tickets).toBe('T1,T2');
  });
});
