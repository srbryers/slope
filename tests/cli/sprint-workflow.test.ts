import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sprintCommand } from '../../src/cli/commands/sprint.js';
import { createStore } from '../../src/store/index.js';
import { WorkflowEngine, loadWorkflow, resolveVariables } from '../../src/core/index.js';

class ProcessExitError extends Error {
  constructor(public code: number | undefined) { super(`process.exit(${code})`); }
}

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-sprint-wf-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ currentSprint: 68 }));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Capture console.log output during an async call */
async function captureLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return logs.join('\n');
}

/** Start a workflow execution and return the execution ID */
async function startWorkflow(sprintId: string, workflowName = 'sprint-lightweight'): Promise<string> {
  const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
  try {
    const def = loadWorkflow(workflowName, tmpDir);
    const vars: Record<string, string> = { sprint_id: sprintId, tickets: 'T1,T2' };
    const resolved = resolveVariables(def, vars);
    const engine = new WorkflowEngine();
    const exec = await engine.start(resolved, store, { sprint_id: sprintId, variables: vars });
    return exec.id;
  } finally {
    store.close();
  }
}

describe('slope sprint run', () => {
  it('starts a workflow execution', async () => {
    const output = await captureLog(() =>
      sprintCommand(['run', 'S68', '--workflow=sprint-lightweight', '--var=tickets=T1,T2'])
    );
    expect(output).toContain('sprint-lightweight');
    expect(output).toContain('started');
    expect(output).toContain('running');
    expect(output).toContain('Next step');
  });

  it('errors without --workflow flag', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sprintCommand(['run', 'S68']);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExitError);
      expect((e as ProcessExitError).code).toBe(1);
    }
    const calls = errSpy.mock.calls;
    errSpy.mockRestore();
    exitSpy.mockRestore();
    expect(calls.some(c => c.join(' ').includes('--workflow'))).toBe(true);
  });

  it('passes --var arguments to workflow', async () => {
    const output = await captureLog(() =>
      sprintCommand(['run', 'S68', '--workflow=sprint-lightweight', '--var=sprint_id=S68', '--var=tickets=T1'])
    );
    expect(output).toContain('sprint-lightweight');
    expect(output).toContain('started');
  });
});

describe('slope sprint status (workflow mode)', () => {
  it('shows workflow execution status by sprint ID', async () => {
    await startWorkflow('70');
    const output = await captureLog(() =>
      sprintCommand(['status', '70'])
    );
    expect(output).toContain('Execution:');
    expect(output).toContain('sprint-lightweight');
    expect(output).toContain('running');
    expect(output).toContain('Sprint:    70');
  });

  it('lists all active executions when no sprint ID given', async () => {
    await startWorkflow('71');
    const output = await captureLog(() =>
      sprintCommand(['status'])
    );
    expect(output).toContain('active workflow execution');
    expect(output).toContain('sprint-lightweight');
  });

  it('reports no execution for unknown sprint', async () => {
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    store.close();

    const output = await captureLog(() =>
      sprintCommand(['status', '999'])
    );
    expect(output).toContain('No active workflow execution');
  });

  it('falls back to legacy status when no workflow executions exist', async () => {
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    store.close();

    const output = await captureLog(() =>
      sprintCommand(['status'])
    );
    expect(output).toContain('No active sprint');
  });
});

describe('slope sprint resume', () => {
  it('resumes an existing workflow execution', async () => {
    await startWorkflow('72');
    const output = await captureLog(() =>
      sprintCommand(['resume', '72'])
    );
    expect(output).toContain('Resuming workflow for sprint 72');
    expect(output).toContain('Next step');
  });

  it('errors without sprint ID', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sprintCommand(['resume']);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExitError);
      expect((e as ProcessExitError).code).toBe(1);
    }
    const calls = errSpy.mock.calls;
    errSpy.mockRestore();
    exitSpy.mockRestore();
    expect(calls.some(c => c.join(' ').includes('Usage'))).toBe(true);
  });

  it('errors for non-existent sprint execution', async () => {
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    store.close();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sprintCommand(['resume', '999']);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExitError);
      expect((e as ProcessExitError).code).toBe(1);
    }
    const calls = errSpy.mock.calls;
    errSpy.mockRestore();
    exitSpy.mockRestore();
    expect(calls.some(c => c.join(' ').includes('No active workflow'))).toBe(true);
  });
});

describe('slope sprint skip', () => {
  it('skips the current step with a reason', async () => {
    await startWorkflow('73');

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    let stepId: string;
    try {
      const def = loadWorkflow('sprint-lightweight', tmpDir);
      const resolved = resolveVariables(def, { sprint_id: '73', tickets: 'T1,T2' });
      const engine = new WorkflowEngine();
      const exec = await store.getExecutionBySprint('73');
      const next = await engine.next(exec!.id, resolved, store);
      stepId = next.step!.id;
    } finally {
      store.close();
    }

    const output = await captureLog(() =>
      sprintCommand(['skip', '73', `--step=${stepId}`, '--reason=Not needed'])
    );
    expect(output).toContain(`${stepId}`);
    expect(output).toContain('skipped');
  });

  it('errors without required arguments', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sprintCommand(['skip']);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExitError);
      expect((e as ProcessExitError).code).toBe(1);
    }
    const calls = errSpy.mock.calls;
    errSpy.mockRestore();
    exitSpy.mockRestore();
    expect(calls.some(c => c.join(' ').includes('Usage'))).toBe(true);
  });

  it('uses default reason when --reason not provided', async () => {
    await startWorkflow('74');

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    let stepId: string;
    try {
      const def = loadWorkflow('sprint-lightweight', tmpDir);
      const resolved = resolveVariables(def, { sprint_id: '74', tickets: 'T1,T2' });
      const engine = new WorkflowEngine();
      const exec = await store.getExecutionBySprint('74');
      const next = await engine.next(exec!.id, resolved, store);
      stepId = next.step!.id;
    } finally {
      store.close();
    }

    const output = await captureLog(() =>
      sprintCommand(['skip', '74', `--step=${stepId}`])
    );
    expect(output).toContain('skipped');
  });
});

describe('slope sprint (help)', () => {
  it('shows help with workflow commands listed', async () => {
    const output = await captureLog(() =>
      sprintCommand([])
    );
    expect(output).toContain('slope sprint run');
    expect(output).toContain('slope sprint resume');
    expect(output).toContain('slope sprint skip');
    expect(output).toContain('--workflow');
  });
});
