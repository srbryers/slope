import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { sprintCommand } from '../../src/cli/commands/sprint.js';
import { createStore } from '../../src/store/index.js';
import type { RoadmapDefinition } from '../../src/core/index.js';
import { WorkflowEngine, loadWorkflow, resolveVariables } from '../../src/core/index.js';
import { findStaleWorkflowExecutions } from '../../src/cli/workflow-resync.js';

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

function writeScorecard(sprint: number): void {
  mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'retros', `sprint-${sprint}.json`), JSON.stringify({
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

function writeRoadmap(sprint: number, status = 'planned'): void {
  const roadmap: RoadmapDefinition = {
    name: 'Sprint Workflow Test Roadmap',
    phases: [{ name: 'Phase 1', sprints: [sprint] }],
    sprints: [{
      id: sprint,
      theme: `Sprint ${sprint}`,
      par: 4,
      slope: 2,
      type: 'feature',
      status,
      tickets: [
        { key: `S${sprint}-1`, title: 'Ticket 1', club: 'short_iron', complexity: 'standard' },
        { key: `S${sprint}-2`, title: 'Ticket 2', club: 'wedge', complexity: 'small' },
        { key: `S${sprint}-3`, title: 'Ticket 3', club: 'putter', complexity: 'trivial' },
      ],
    }],
  };
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(roadmap, null, 2));
}

function writeProjectWorkflow(name: string): void {
  mkdirSync(join(tmpDir, '.slope', 'workflows'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'workflows', `${name}.yaml`), `
name: ${name}
version: "1"
variables:
  sprint_id:
    required: true
    type: string
  tickets:
    required: true
    type: array
phases:
  - id: per_ticket
    repeat_for: tickets
    steps:
      - id: implement
        type: agent_work
        prompt: "Implement the ticket"
`);
}

function initGitForSprint(sprint: number): void {
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
  writeFileSync(join(tmpDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tmpDir, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', `feat/sprint-${sprint}`], { cwd: tmpDir, stdio: 'ignore' });
  writeFileSync(join(tmpDir, 'feature.txt'), `S${sprint}\n`);
  execFileSync('git', ['add', 'feature.txt'], { cwd: tmpDir });
  execFileSync('git', ['commit', '-m', `fix(S${sprint}-1): existing sprint work`], { cwd: tmpDir, stdio: 'ignore' });
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

  it('persists execution under sprint_id when sprint is only passed via --var (#480)', async () => {
    await captureLog(() =>
      sprintCommand(['run', '--workflow=sprint-lightweight', '--var', 'sprint_id=S64', '--var', 'tickets=T1'])
    );

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      const exec = await store.getExecutionBySprint('S64');
      expect(exec).not.toBeNull();
      expect(exec!.variables.sprint_id).toBe('S64');
      expect(exec!.sprint_id).toBe('S64');
    } finally {
      store.close();
    }

    const output = await captureLog(() =>
      sprintCommand(['status', 'S64'])
    );
    expect(output).toContain('Execution:');
    expect(output).toContain('Sprint:    S64');
  });

  it('defaults required tickets from the roadmap when omitted (#480)', async () => {
    writeRoadmap(64);
    writeProjectWorkflow('ticket-default-test');

    await captureLog(() =>
      sprintCommand(['run', '--workflow=ticket-default-test', '--var', 'sprint_id=S64'])
    );

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      const exec = await store.getExecutionBySprint('S64');
      expect(exec).not.toBeNull();
      expect(exec!.variables.tickets).toBe('S64-1,S64-2,S64-3');
    } finally {
      store.close();
    }
  });

  it('syncs sprint-state to implementing when workflow starts in per_ticket', async () => {
    await captureLog(() =>
      sprintCommand(['run', 'S98', '--workflow=sprint-lightweight', '--var=tickets=T1,T2'])
    );

    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.sprint).toBe(98);
    expect(state.phase).toBe('implementing');
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

describe('slope sprint workflow cleanup', () => {
  it('dry-runs stale running executions without pausing them', async () => {
    await startWorkflow('S1');
    await startWorkflow('S2');
    writeScorecard(1);

    const output = await captureLog(() =>
      sprintCommand(['workflow', 'cleanup', '--stale', '--dry-run'])
    );

    expect(output).toContain('Would pause S1');
    expect(output).toContain('scorecard exists');

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      expect(await store.getExecutionBySprint('S1')).toMatchObject({ status: 'running' });
    } finally {
      store.close();
    }
  });

  it('pauses stale running executions while leaving current ones active', async () => {
    await startWorkflow('S1');
    await startWorkflow('S2');
    writeScorecard(1);

    const output = await captureLog(() =>
      sprintCommand(['workflow', 'cleanup', '--stale'])
    );

    expect(output).toContain('Paused S1');
    expect(output).toContain('1 stale workflow execution(s) paused');

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      expect(await store.getExecutionBySprint('S1')).toMatchObject({ status: 'paused' });
      expect(await store.getExecutionBySprint('S2')).toMatchObject({ status: 'running' });
    } finally {
      store.close();
    }
  });

  it('pauses older running executions when a newer sprint execution exists (#503)', async () => {
    await startWorkflow('S65');
    await startWorkflow('S66');

    const output = await captureLog(() =>
      sprintCommand(['workflow', 'cleanup', '--stale'])
    );

    expect(output).toContain('Paused S65');
    expect(output).toContain('newer running sprint S66 exists');

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      expect(await store.getExecutionBySprint('S65')).toMatchObject({ status: 'paused' });
      expect(await store.getExecutionBySprint('S66')).toMatchObject({ status: 'running' });
    } finally {
      store.close();
    }
  });

  it('detects aged running executions as stale (#503)', async () => {
    const old = new Date('2026-01-01T00:00:00Z').toISOString();
    const store = {
      listExecutions: async () => [{
        id: 'wf-old',
        workflow_name: 'sprint-lightweight',
        sprint_id: 'S65',
        current_phase: 'pre_hole',
        current_step: 'verify_previous',
        status: 'running' as const,
        variables: {},
        completed_steps: [],
        started_at: old,
        updated_at: old,
      }],
    };

    const stale = await findStaleWorkflowExecutions(tmpDir, store, {
      now: new Date('2026-01-10T00:00:00Z'),
      staleAgeMs: 7 * 24 * 60 * 60 * 1000,
      branchSprint: null,
    });

    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toContain('older than 7 days');
  });

  it('resync fast-forwards a branch sprint execution when commits already exist (#503)', async () => {
    initGitForSprint(66);
    const execId = await startWorkflow('S66', 'sprint-standard');

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      await store.updateExecutionState(execId, 'pre_hole', 'verify_previous');
    } finally {
      store.close();
    }

    const output = await captureLog(() =>
      sprintCommand(['workflow', 'resync'])
    );

    expect(output).toContain('Fast-forwarded S66');
    expect(output).toContain('per_ticket/implement');

    const updatedStore = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      const exec = await updatedStore.getExecutionBySprint('S66');
      expect(exec).toMatchObject({ current_phase: 'per_ticket', current_step: 'implement' });
    } finally {
      updatedStore.close();
    }

    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.sprint).toBe(66);
    expect(state.phase).toBe('implementing');
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

  it('syncs sprint-state to implementing when standard workflow enters per_ticket', async () => {
    const execId = await startWorkflow('S99', 'sprint-standard');

    await captureLog(() =>
      sprintCommand(['start', '--number=99', '--phase=planning'])
    );

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      await store.recordStepResult({ execution_id: execId, phase: 'pre_hole', step_id: 'briefing', status: 'skipped' });
      await store.recordStepResult({ execution_id: execId, phase: 'pre_hole', step_id: 'verify_previous', status: 'skipped' });
      await store.recordStepResult({ execution_id: execId, phase: 'plan_review', step_id: 'write_plan', status: 'skipped' });
      await store.recordStepResult({ execution_id: execId, phase: 'plan_review', step_id: 'review_plan', status: 'skipped' });
      await store.updateExecutionState(execId, 'plan_review', 'revise_plan');
    } finally {
      store.close();
    }

    const output = await captureLog(() =>
      sprintCommand(['skip', 'S99', '--step=revise_plan', '--reason=review-complete'])
    );
    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));

    expect(output).toContain('Next: per_ticket/pre_shot');
    expect(state.phase).toBe('implementing');
  });
});

describe('slope sprint phase', () => {
  it('blocks sprint start when roadmap reality says the sprint already has a scorecard', async () => {
    writeRoadmap(98);
    writeScorecard(98);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let errors = '';
    try {
      await expect(sprintCommand(['start', '--number=98', '--phase=planning'])).rejects.toThrow(ProcessExitError);
      errors = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(errors).toContain('Pre-sprint reality check failed for S98');
    expect(errors).toContain('S98 has a scorecard');
  });

  it('starts decimal inserted sprint state without truncating', async () => {
    const output = await captureLog(() =>
      sprintCommand(['start', '--number=114.5', '--phase=planning'])
    );
    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));

    expect(output).toContain('Sprint 114.5 started');
    expect(state.sprint).toBe(114.5);
  });

  it('updates an existing sprint state phase', async () => {
    await captureLog(() =>
      sprintCommand(['start', '--number=98', '--phase=planning'])
    );

    const output = await captureLog(() =>
      sprintCommand(['phase', 'implementing'])
    );
    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));

    expect(output).toContain('planning -> implementing');
    expect(state.phase).toBe('implementing');
  });

  it('lets sprint start --phase update same-sprint state', async () => {
    await captureLog(() =>
      sprintCommand(['start', '--number=98', '--phase=planning'])
    );

    const output = await captureLog(() =>
      sprintCommand(['start', '--number=98', '--phase=implementing'])
    );
    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));

    expect(output).toContain('phase updated: implementing');
    expect(state.phase).toBe('implementing');
  });
});

describe('slope sprint (help)', () => {
  it('shows help with workflow commands listed', async () => {
    const output = await captureLog(() =>
      sprintCommand([])
    );
    expect(output).toContain('slope sprint run');
    expect(output).toContain('slope sprint phase');
    expect(output).toContain('slope sprint resume');
    expect(output).toContain('slope sprint skip');
    expect(output).toContain('slope sprint context');
    expect(output).toContain('slope sprint validate');
    expect(output).toContain('--workflow');
  });

  it('prints reset help without clearing sprint state (#501)', async () => {
    await captureLog(() =>
      sprintCommand(['start', '--number=160', '--phase=implementing'])
    );

    const output = await captureLog(() =>
      sprintCommand(['reset', '--help'])
    );
    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));

    expect(output).toContain('slope sprint reset');
    expect(output).toContain('Clear sprint state');
    expect(state.sprint).toBe(160);
    expect(state.phase).toBe('implementing');
  });

  it('rejects unknown reset flags without clearing sprint state (#501)', async () => {
    await captureLog(() =>
      sprintCommand(['start', '--number=160', '--phase=implementing'])
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    try {
      await expect(captureLog(() =>
        sprintCommand(['reset', '--bogus'])
      )).rejects.toThrow(ProcessExitError);
    } finally {
      exitSpy.mockRestore();
    }

    const state = JSON.parse(readFileSync(join(tmpDir, '.slope', 'sprint-state.json'), 'utf8'));
    expect(state.sprint).toBe(160);
    expect(state.phase).toBe('implementing');
  });
});
