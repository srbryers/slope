import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore } from '../../src/store/index.js';
import { WorkflowEngine } from '../../src/core/index.js';
import type { WorkflowDefinition } from '../../src/core/index.js';

let store: SqliteSlopeStore;
let tmpDir: string;
let engine: WorkflowEngine;

const TEST_WORKFLOW: WorkflowDefinition = {
  name: 'test-mcp',
  version: '1',
  phases: [
    {
      id: 'setup',
      steps: [
        { id: 'init', type: 'command', command: 'echo start' },
        { id: 'check', type: 'validation', conditions: ['ready'] },
      ],
    },
    {
      id: 'work',
      steps: [
        { id: 'build', type: 'agent_work', prompt: 'Build it' },
      ],
    },
  ],
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-mcp-wf-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
  engine = new WorkflowEngine();
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Workflow MCP tool operations', () => {
  describe('workflow_next equivalent', () => {
    it('returns the current step for a running execution', async () => {
      const exec = await engine.start(TEST_WORKFLOW, store, { session_id: 'sess-1' });
      const next = await engine.next(exec.id, TEST_WORKFLOW, store);

      expect(next.is_complete).toBe(false);
      expect(next.phase).toBe('setup');
      expect(next.step!.id).toBe('init');
      expect(next.step!.type).toBe('command');
    });

    it('finds execution by session_id', async () => {
      const exec = await engine.start(TEST_WORKFLOW, store, { session_id: 'sess-99' });
      const executions = await store.listExecutions({ status: 'running' });
      const match = executions.find(e => e.session_id === 'sess-99');

      expect(match).toBeDefined();
      expect(match!.id).toBe(exec.id);
    });
  });

  describe('workflow_complete equivalent', () => {
    it('completes step and advances', async () => {
      const exec = await engine.start(TEST_WORKFLOW, store);

      const result = await engine.complete(exec.id, 'init', { exit_code: 0 }, TEST_WORKFLOW, store);
      expect(result.is_complete).toBe(false);
      expect(result.advanced_to).toEqual({ phase: 'setup', step: 'check' });
    });

    it('completes the workflow on last step', async () => {
      const exec = await engine.start(TEST_WORKFLOW, store);
      await engine.complete(exec.id, 'init', {}, TEST_WORKFLOW, store);
      await engine.complete(exec.id, 'check', {}, TEST_WORKFLOW, store);
      const result = await engine.complete(exec.id, 'build', {}, TEST_WORKFLOW, store);

      expect(result.is_complete).toBe(true);
    });

    it('rejects wrong step_id', async () => {
      const exec = await engine.start(TEST_WORKFLOW, store);
      await expect(engine.complete(exec.id, 'wrong', {}, TEST_WORKFLOW, store))
        .rejects.toThrow('Step mismatch');
    });
  });

  describe('workflow_status equivalent', () => {
    it('returns execution with progress', async () => {
      const exec = await engine.start(TEST_WORKFLOW, store, { sprint_id: 'S42' });
      await engine.complete(exec.id, 'init', {}, TEST_WORKFLOW, store);

      const updated = await store.getExecution(exec.id);
      expect(updated!.status).toBe('running');
      expect(updated!.completed_steps).toHaveLength(1);
      expect(updated!.sprint_id).toBe('S42');
    });

    it('lists active executions', async () => {
      await engine.start(TEST_WORKFLOW, store, { session_id: 'a' });
      await engine.start(TEST_WORKFLOW, store, { session_id: 'b' });

      const active = await store.listExecutions({ status: 'running' });
      expect(active).toHaveLength(2);
    });
  });
});
