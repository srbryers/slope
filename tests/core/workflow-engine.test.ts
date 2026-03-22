import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore } from '../../src/store/index.js';
import { WorkflowEngine, parseWorkflow, resolveVariables } from '../../src/core/index.js';
import type { WorkflowDefinition } from '../../src/core/index.js';

let store: SqliteSlopeStore;
let tmpDir: string;
let engine: WorkflowEngine;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-wf-test-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
  engine = new WorkflowEngine();
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const SIMPLE_WORKFLOW: WorkflowDefinition = {
  name: 'simple',
  version: '1',
  phases: [
    {
      id: 'setup',
      steps: [
        { id: 'briefing', type: 'command', command: 'echo hello' },
        { id: 'verify', type: 'validation', conditions: ['file_exists:.slope/config.json'] },
      ],
    },
    {
      id: 'work',
      steps: [
        { id: 'implement', type: 'agent_work', prompt: 'Do the work' },
      ],
    },
    {
      id: 'finish',
      steps: [
        { id: 'validate', type: 'command', command: 'slope validate' },
      ],
    },
  ],
};

const REPEAT_WORKFLOW: WorkflowDefinition = {
  name: 'repeat-test',
  version: '1',
  variables: {
    tickets: { type: 'array' },
  },
  phases: [
    {
      id: 'pre',
      steps: [{ id: 'setup', type: 'command', command: 'echo start' }],
    },
    {
      id: 'per_ticket',
      repeat_for: 'tickets',
      on_timeout: 'log_blocker_and_skip',
      steps: [
        { id: 'plan', type: 'agent_input', required_fields: ['club'] },
        { id: 'code', type: 'agent_work', prompt: 'Implement ticket' },
      ],
    },
    {
      id: 'post',
      steps: [{ id: 'review', type: 'command', command: 'slope review' }],
    },
  ],
};

describe('WorkflowEngine', () => {
  describe('start', () => {
    it('creates an execution at the first step', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      expect(exec.workflow_name).toBe('simple');
      expect(exec.status).toBe('running');
      expect(exec.current_phase).toBe('setup');
      expect(exec.current_step).toBe('briefing');
    });

    it('passes variables and sprint_id', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store, {
        sprint_id: 'S42',
        variables: { foo: 'bar' },
        session_id: 'sess-1',
      });
      expect(exec.sprint_id).toBe('S42');
      expect(exec.variables).toEqual({ foo: 'bar' });
      expect(exec.session_id).toBe('sess-1');
    });

    it('throws on empty phases', async () => {
      const empty: WorkflowDefinition = { name: 'empty', version: '1', phases: [] };
      await expect(engine.start(empty, store)).rejects.toThrow('no phases');
    });

    it('throws on empty steps in first phase', async () => {
      const noSteps: WorkflowDefinition = {
        name: 'no-steps', version: '1',
        phases: [{ id: 'p1', steps: [] }],
      };
      await expect(engine.start(noSteps, store)).rejects.toThrow('no steps');
    });
  });

  describe('next', () => {
    it('returns the current step', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      const next = await engine.next(exec.id, SIMPLE_WORKFLOW, store);
      expect(next.is_complete).toBe(false);
      expect(next.phase).toBe('setup');
      expect(next.step!.id).toBe('briefing');
    });

    it('returns is_complete after all steps done', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);

      // Complete all steps
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'implement', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'validate', {}, SIMPLE_WORKFLOW, store);

      const next = await engine.next(exec.id, SIMPLE_WORKFLOW, store);
      expect(next.is_complete).toBe(true);
    });

    it('throws on failed execution', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.fail(exec.id, store);
      await expect(engine.next(exec.id, SIMPLE_WORKFLOW, store))
        .rejects.toThrow('has failed');
    });
  });

  describe('complete', () => {
    it('advances to the next step in the same phase', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      const result = await engine.complete(exec.id, 'briefing', { exit_code: 0 }, SIMPLE_WORKFLOW, store);

      expect(result.is_complete).toBe(false);
      expect(result.advanced_to).toEqual({ phase: 'setup', step: 'verify' });
    });

    it('advances to the next phase', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      const result = await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);

      expect(result.advanced_to).toEqual({ phase: 'work', step: 'implement' });
    });

    it('completes the workflow on last step', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'implement', {}, SIMPLE_WORKFLOW, store);
      const result = await engine.complete(exec.id, 'validate', {}, SIMPLE_WORKFLOW, store);

      expect(result.is_complete).toBe(true);
      expect(result.advanced_to).toBeUndefined();

      // Execution should be marked completed
      const updated = await store.getExecution(exec.id);
      expect(updated!.status).toBe('completed');
    });

    it('records step output', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'briefing', {
        output: { summary: 'All good' },
        exit_code: 0,
      }, SIMPLE_WORKFLOW, store);

      const updated = await store.getExecution(exec.id);
      expect(updated!.completed_steps).toHaveLength(1);
      expect(updated!.completed_steps[0].step_id).toBe('briefing');
    });

    it('throws on step mismatch', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await expect(engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store))
        .rejects.toThrow('Step mismatch');
    });

    it('throws on non-existent execution', async () => {
      await expect(engine.complete('wf-nonexistent', 'briefing', {}, SIMPLE_WORKFLOW, store))
        .rejects.toThrow('not found');
    });
  });

  describe('skip', () => {
    it('skips a step and advances', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      const result = await engine.skip(exec.id, 'briefing', 'Not needed', SIMPLE_WORKFLOW, store);

      expect(result.is_complete).toBe(false);
      expect(result.advanced_to).toEqual({ phase: 'setup', step: 'verify' });
    });

    it('skipped steps count as done for phase advancement', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.skip(exec.id, 'briefing', 'Skip', SIMPLE_WORKFLOW, store);
      const result = await engine.skip(exec.id, 'verify', 'Skip', SIMPLE_WORKFLOW, store);

      expect(result.advanced_to).toEqual({ phase: 'work', step: 'implement' });
    });
  });

  describe('fail', () => {
    it('transitions running to failed', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.fail(exec.id, store);

      const updated = await store.getExecution(exec.id);
      expect(updated!.status).toBe('failed');
    });

    it('throws on invalid transition (completed → failed)', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      // Complete the workflow
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'implement', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'validate', {}, SIMPLE_WORKFLOW, store);

      await expect(engine.fail(exec.id, store))
        .rejects.toThrow('Invalid workflow transition');
    });
  });

  describe('repeat_for phases', () => {
    it('iterates over comma-separated items', async () => {
      const exec = await engine.start(REPEAT_WORKFLOW, store, {
        variables: { tickets: 'T1,T2' },
      });

      // Complete pre phase
      await engine.complete(exec.id, 'setup', {}, REPEAT_WORKFLOW, store);

      // Next should be per_ticket for T1
      let next = await engine.next(exec.id, REPEAT_WORKFLOW, store);
      expect(next.phase).toBe('per_ticket');
      expect(next.step!.id).toBe('plan');
      expect(next.current_item).toBe('T1');
      expect(next.total_items).toBe(2);
      expect(next.item_index).toBe(0);

      // Complete T1 steps
      await engine.complete(exec.id, 'plan', {}, REPEAT_WORKFLOW, store);
      await engine.complete(exec.id, 'code', {}, REPEAT_WORKFLOW, store);

      // Next should be per_ticket for T2
      next = await engine.next(exec.id, REPEAT_WORKFLOW, store);
      expect(next.current_item).toBe('T2');
      expect(next.item_index).toBe(1);
    });

    it('iterates over JSON array items', async () => {
      const exec = await engine.start(REPEAT_WORKFLOW, store, {
        variables: { tickets: '["T1","T2","T3"]' },
      });

      await engine.complete(exec.id, 'setup', {}, REPEAT_WORKFLOW, store);

      const next = await engine.next(exec.id, REPEAT_WORKFLOW, store);
      expect(next.current_item).toBe('T1');
      expect(next.total_items).toBe(3);
    });

    it('completes after all items processed', async () => {
      const exec = await engine.start(REPEAT_WORKFLOW, store, {
        variables: { tickets: 'T1' },
      });

      await engine.complete(exec.id, 'setup', {}, REPEAT_WORKFLOW, store);
      await engine.complete(exec.id, 'plan', {}, REPEAT_WORKFLOW, store);
      await engine.complete(exec.id, 'code', {}, REPEAT_WORKFLOW, store);
      const result = await engine.complete(exec.id, 'review', {}, REPEAT_WORKFLOW, store);

      expect(result.is_complete).toBe(true);
    });

    it('handles empty repeat_for gracefully', async () => {
      const exec = await engine.start(REPEAT_WORKFLOW, store, {
        variables: { tickets: '' },
      });

      await engine.complete(exec.id, 'setup', {}, REPEAT_WORKFLOW, store);

      // Should skip straight to post phase since no tickets
      const next = await engine.next(exec.id, REPEAT_WORKFLOW, store);
      expect(next.phase).toBe('post');
      expect(next.step!.id).toBe('review');
    });
  });

  describe('edge cases — error recovery and state transitions', () => {
    it('throws on complete after fail', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.fail(exec.id, store);
      await expect(engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store))
        .rejects.toThrow('status "failed"');
    });

    it('throws on skip after fail', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.fail(exec.id, store);
      await expect(engine.skip(exec.id, 'briefing', 'skip', SIMPLE_WORKFLOW, store))
        .rejects.toThrow('status "failed"');
    });

    it('next() throws on failed execution (via direct store mutation)', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await store.completeExecution(exec.id, 'failed');
      await expect(engine.next(exec.id, SIMPLE_WORKFLOW, store))
        .rejects.toThrow('has failed');
    });

    it('double fail throws on second attempt', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.fail(exec.id, store);
      await expect(engine.fail(exec.id, store))
        .rejects.toThrow('Invalid workflow transition');
    });

    it('fail on completed execution throws', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'implement', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'validate', {}, SIMPLE_WORKFLOW, store);

      await expect(engine.fail(exec.id, store))
        .rejects.toThrow('Invalid workflow transition');
    });

    it('complete on already-completed workflow throws', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'implement', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'validate', {}, SIMPLE_WORKFLOW, store);

      // Workflow is complete — trying to complete another step should fail
      await expect(engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store))
        .rejects.toThrow();
    });

    it('next() returns is_complete true after completion', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'verify', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'implement', {}, SIMPLE_WORKFLOW, store);
      await engine.complete(exec.id, 'validate', {}, SIMPLE_WORKFLOW, store);

      const next = await engine.next(exec.id, SIMPLE_WORKFLOW, store);
      expect(next.is_complete).toBe(true);
      expect(next.step).toBeUndefined();
    });

    it('requireExecution throws for nonexistent ID', async () => {
      await expect(engine.next('wf-doesnotexist', SIMPLE_WORKFLOW, store))
        .rejects.toThrow('not found');
    });
  });

  describe('store — completed_steps integrity', () => {
    it('completed_steps array grows with each complete call', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);

      await engine.complete(exec.id, 'briefing', { output: { a: 1 } }, SIMPLE_WORKFLOW, store);
      let updated = await store.getExecution(exec.id);
      expect(updated!.completed_steps).toHaveLength(1);
      expect(updated!.completed_steps[0].step_id).toBe('briefing');

      await engine.complete(exec.id, 'verify', { output: { b: 2 } }, SIMPLE_WORKFLOW, store);
      updated = await store.getExecution(exec.id);
      expect(updated!.completed_steps).toHaveLength(2);
      expect(updated!.completed_steps[1].step_id).toBe('verify');
    });

    it('skipped steps appear in completed_steps with skipped status', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      await engine.skip(exec.id, 'briefing', 'Not needed', SIMPLE_WORKFLOW, store);

      const updated = await store.getExecution(exec.id);
      expect(updated!.completed_steps).toHaveLength(1);
      expect(updated!.completed_steps[0].status).toBe('skipped');
    });

    it('getExecution returns fresh state after mutations', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store);
      expect(exec.status).toBe('running');
      expect(exec.completed_steps).toHaveLength(0);

      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);

      // Re-fetch — should reflect the new state
      const fresh = await store.getExecution(exec.id);
      expect(fresh!.completed_steps).toHaveLength(1);
      expect(fresh!.current_step).not.toBe('briefing'); // advanced past briefing
    });

    it('getExecutionBySprint returns null for failed/completed executions', async () => {
      const exec = await engine.start(SIMPLE_WORKFLOW, store, { sprint_id: 'S99' });
      await engine.complete(exec.id, 'briefing', {}, SIMPLE_WORKFLOW, store);
      await engine.fail(exec.id, store);

      // getExecutionBySprint only returns active (running/paused) executions
      const bySprintResult = await store.getExecutionBySprint('S99');
      expect(bySprintResult).toBeNull();

      // getExecution still returns the full state
      const byId = await store.getExecution(exec.id);
      expect(byId!.status).toBe('failed');
      expect(byId!.completed_steps).toHaveLength(1);
    });

    it('listExecutions filters by status correctly', async () => {
      await engine.start(SIMPLE_WORKFLOW, store, { sprint_id: 'A' });
      const exec2 = await engine.start(SIMPLE_WORKFLOW, store, { sprint_id: 'B' });
      await engine.fail(exec2.id, store);

      const running = await store.listExecutions({ status: 'running' });
      expect(running).toHaveLength(1);
      expect(running[0].sprint_id).toBe('A');

      const failed = await store.listExecutions({ status: 'failed' });
      expect(failed).toHaveLength(1);
      expect(failed[0].sprint_id).toBe('B');
    });

    it('step results persist across store reopen', async () => {
      const dbPath = join(tmpDir, 'persist.db');
      let s = new SqliteSlopeStore(dbPath);
      const exec = await engine.start(SIMPLE_WORKFLOW, s);
      await engine.complete(exec.id, 'briefing', { output: { key: 'val' } }, SIMPLE_WORKFLOW, s);
      s.close();

      // Reopen and verify
      s = new SqliteSlopeStore(dbPath);
      const reloaded = await s.getExecution(exec.id);
      expect(reloaded!.completed_steps).toHaveLength(1);
      expect(reloaded!.completed_steps[0].step_id).toBe('briefing');
      expect(reloaded!.completed_steps[0].status).toBe('completed');
      s.close();
    });
  });

  describe('YAML integration', () => {
    it('works end-to-end with parsed YAML', async () => {
      const yaml = `
name: e2e-test
version: "1"
variables:
  sprint_id:
    required: true
    type: string
phases:
  - id: setup
    steps:
      - id: greet
        type: command
        command: "echo Sprint \${sprint_id}"
  - id: done
    steps:
      - id: finish
        type: validation
        conditions:
          - exit_code_0
`;
      const def = parseWorkflow(yaml);
      const resolved = resolveVariables(def, { sprint_id: 'S42' });

      const exec = await engine.start(resolved, store, { sprint_id: 'S42' });
      expect(exec.current_step).toBe('greet');

      // Verify command was interpolated
      const next = await engine.next(exec.id, resolved, store);
      expect(next.step!.command).toBe('echo Sprint S42');

      await engine.complete(exec.id, 'greet', { exit_code: 0 }, resolved, store);
      await engine.complete(exec.id, 'finish', {}, resolved, store);

      const final = await store.getExecution(exec.id);
      expect(final!.status).toBe('completed');
    });
  });
});
