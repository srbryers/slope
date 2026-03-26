import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore } from '../../src/store/index.js';
import { WorkflowEngine, parseWorkflow, resolveVariables, loadWorkflow } from '../../src/core/index.js';

let store: SqliteSlopeStore;
let tmpDir: string;
let engine: WorkflowEngine;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-wf-integ-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
  engine = new WorkflowEngine();
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Full workflow execution E2E', () => {
  it('runs sprint-standard through all phases', async () => {
    const cwd = '/tmp/slope-integ-nonexistent';
    const def = loadWorkflow('sprint-standard', cwd);
    const resolved = resolveVariables(def, { sprint_id: 'S42', tickets: 'T1,T2' });

    const exec = await engine.start(resolved, store, { sprint_id: 'S42', variables: { sprint_id: 'S42', tickets: 'T1,T2' } });
    expect(exec.status).toBe('running');

    // Phase 1: pre_hole
    let next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('pre_hole');
    expect(next.step!.id).toBe('briefing');
    await engine.complete(exec.id, 'briefing', { exit_code: 0 }, resolved, store);

    next = await engine.next(exec.id, resolved, store);
    expect(next.step!.id).toBe('verify_previous');
    await engine.complete(exec.id, 'verify_previous', {}, resolved, store);

    // Phase 2: plan_review
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('plan_review');
    expect(next.step!.id).toBe('write_plan');
    await engine.complete(exec.id, 'write_plan', {}, resolved, store);
    await engine.complete(exec.id, 'review_plan', { output: { review_tier: 'skip', review_complete: true } }, resolved, store);
    await engine.complete(exec.id, 'revise_plan', {}, resolved, store);

    // Phase 3: per_ticket — T1
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('per_ticket');
    expect(next.current_item).toBe('T1');
    expect(next.step!.id).toBe('pre_shot');
    await engine.complete(exec.id, 'pre_shot', { output: { club: 'short_iron' } }, resolved, store);
    await engine.complete(exec.id, 'implement', {}, resolved, store);
    await engine.complete(exec.id, 'post_shot', { output: { result: 'green' } }, resolved, store);

    // Phase 2: per_ticket — T2
    next = await engine.next(exec.id, resolved, store);
    expect(next.current_item).toBe('T2');
    expect(next.item_index).toBe(1);
    await engine.complete(exec.id, 'pre_shot', {}, resolved, store);
    await engine.complete(exec.id, 'implement', {}, resolved, store);
    await engine.complete(exec.id, 'post_shot', {}, resolved, store);

    // Phase 3: post_hole
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('post_hole');
    expect(next.step!.id).toBe('validate_scorecard');
    await engine.complete(exec.id, 'validate_scorecard', { exit_code: 0 }, resolved, store);
    await engine.complete(exec.id, 'review', { exit_code: 0 }, resolved, store);
    const result = await engine.complete(exec.id, 'update_map', { exit_code: 0 }, resolved, store);

    expect(result.is_complete).toBe(true);

    // Verify final state
    const final = await store.getExecution(exec.id);
    expect(final!.status).toBe('completed');
    expect(final!.completed_steps.length).toBe(14); // 2 + 3 (plan_review) + 3*2 + 3
  });
});

describe('State persistence and resume', () => {
  it('resumes from stored state after store reopen', async () => {
    const yaml = `
name: resume-test
version: "1"
phases:
  - id: p1
    steps:
      - id: s1
        type: command
        command: echo 1
      - id: s2
        type: command
        command: echo 2
`;
    const def = parseWorkflow(yaml);
    const dbPath = join(tmpDir, 'resume.db');

    // Start and complete one step
    let s = new SqliteSlopeStore(dbPath);
    const exec = await engine.start(def, s, { sprint_id: 'R1' });
    await engine.complete(exec.id, 's1', { exit_code: 0 }, def, s);
    s.close();

    // Reopen store and resume
    s = new SqliteSlopeStore(dbPath);
    const next = await engine.next(exec.id, def, s);
    expect(next.is_complete).toBe(false);
    expect(next.step!.id).toBe('s2');

    await engine.complete(exec.id, 's2', {}, def, s);
    const finalNext = await engine.next(exec.id, def, s);
    expect(finalNext.is_complete).toBe(true);
    s.close();
  });
});

describe('Skip step with reason', () => {
  it('skips and records reason in output', async () => {
    const yaml = `
name: skip-test
version: "1"
phases:
  - id: p1
    steps:
      - id: blocker
        type: command
        command: failing-cmd
      - id: next
        type: command
        command: echo ok
`;
    const def = parseWorkflow(yaml);
    const exec = await engine.start(def, store);

    const result = await engine.skip(exec.id, 'blocker', 'Command not available', def, store);
    expect(result.advanced_to).toEqual({ phase: 'p1', step: 'next' });

    // Verify the step result was recorded
    const updated = await store.getExecution(exec.id);
    expect(updated!.completed_steps[0].status).toBe('skipped');
  });
});

describe('Variable interpolation across steps', () => {
  it('interpolates variables in commands and prompts', async () => {
    const yaml = `
name: var-test
version: "1"
variables:
  env:
    type: string
    default: staging
phases:
  - id: deploy
    steps:
      - id: run
        type: command
        command: deploy --env=\${env}
`;
    const def = parseWorkflow(yaml);
    const resolved = resolveVariables(def, { env: 'production' });

    const exec = await engine.start(resolved, store);
    const next = await engine.next(exec.id, resolved, store);
    expect(next.step!.command).toBe('deploy --env=production');
  });
});

describe('Full workflow execution E2E — sprint-lightweight', () => {
  it('runs sprint-lightweight through all phases', async () => {
    const cwd = '/tmp/slope-integ-nonexistent';
    const def = loadWorkflow('sprint-lightweight', cwd);
    const resolved = resolveVariables(def, { sprint_id: 'S50', tickets: 'T1,T2' });

    const exec = await engine.start(resolved, store, { sprint_id: 'S50', variables: { sprint_id: 'S50', tickets: 'T1,T2' } });
    expect(exec.status).toBe('running');

    // Phase 1: per_ticket — T1
    let next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('per_ticket');
    expect(next.current_item).toBe('T1');
    expect(next.step!.id).toBe('implement');
    await engine.complete(exec.id, 'implement', {}, resolved, store);

    // Phase 1: per_ticket — T2
    next = await engine.next(exec.id, resolved, store);
    expect(next.current_item).toBe('T2');
    expect(next.step!.id).toBe('implement');
    await engine.complete(exec.id, 'implement', {}, resolved, store);

    // Phase 2: validate
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('validate');
    expect(next.step!.id).toBe('typecheck');
    await engine.complete(exec.id, 'typecheck', { exit_code: 0 }, resolved, store);

    const result = await engine.complete(exec.id, 'tests', { exit_code: 0 }, resolved, store);
    expect(result.is_complete).toBe(true);

    // Verify final state
    const final = await store.getExecution(exec.id);
    expect(final!.status).toBe('completed');
    expect(final!.completed_steps.length).toBe(4); // 2 implement + typecheck + tests
  });
});

describe('Full workflow execution E2E — sprint-autonomous', () => {
  it('runs sprint-autonomous through all phases', async () => {
    const cwd = '/tmp/slope-integ-nonexistent';
    const def = loadWorkflow('sprint-autonomous', cwd);
    const resolved = resolveVariables(def, { sprint_id: 'S51', tickets: 'T1,T2' });

    const exec = await engine.start(resolved, store, { sprint_id: 'S51', variables: { sprint_id: 'S51', tickets: 'T1,T2' } });
    expect(exec.status).toBe('running');

    // Phase 1: pre_hole — briefing
    let next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('pre_hole');
    expect(next.step!.id).toBe('briefing');
    expect(next.step!.command).toContain('slope briefing');
    await engine.complete(exec.id, 'briefing', { exit_code: 0 }, resolved, store);

    // Phase 2: plan — generate execution plan
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('plan');
    expect(next.step!.id).toBe('generate_plan');
    await engine.complete(exec.id, 'generate_plan', {}, resolved, store);

    // Phase 3: per_ticket — T1
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('per_ticket');
    expect(next.current_item).toBe('T1');
    expect(next.step!.id).toBe('implement');
    await engine.complete(exec.id, 'implement', {}, resolved, store);

    next = await engine.next(exec.id, resolved, store);
    expect(next.step!.id).toBe('verify');
    await engine.complete(exec.id, 'verify', { exit_code: 0 }, resolved, store);

    // Phase 3: per_ticket — T2
    next = await engine.next(exec.id, resolved, store);
    expect(next.current_item).toBe('T2');
    expect(next.step!.id).toBe('implement');
    await engine.complete(exec.id, 'implement', {}, resolved, store);

    next = await engine.next(exec.id, resolved, store);
    expect(next.step!.id).toBe('verify');
    await engine.complete(exec.id, 'verify', { exit_code: 0 }, resolved, store);

    // Phase 3: post_hole
    next = await engine.next(exec.id, resolved, store);
    expect(next.phase).toBe('post_hole');
    expect(next.step!.id).toBe('validate_scorecard');
    await engine.complete(exec.id, 'validate_scorecard', { exit_code: 0 }, resolved, store);

    const result = await engine.complete(exec.id, 'update_map', { exit_code: 0 }, resolved, store);
    expect(result.is_complete).toBe(true);

    // Verify final state
    const final = await store.getExecution(exec.id);
    expect(final!.status).toBe('completed');
    expect(final!.completed_steps.length).toBe(8); // 1 + 1 (plan) + 2*2 + 2
  });

  it('uses default model variable when not provided', async () => {
    const cwd = '/tmp/slope-integ-nonexistent';
    const def = loadWorkflow('sprint-autonomous', cwd);
    // Only provide required vars — model should default to 'local'
    const resolved = resolveVariables(def, { sprint_id: 'S52', tickets: 'T1' });
    const exec = await engine.start(resolved, store, { sprint_id: 'S52', variables: { sprint_id: 'S52', tickets: 'T1' } });
    expect(exec.status).toBe('running');
  });
});

describe('Per-ticket partial failures', () => {
  it('skips failed ticket and continues to next', async () => {
    const yaml = `
name: partial-fail
version: "1"
variables:
  tickets:
    type: array
phases:
  - id: work
    repeat_for: tickets
    on_timeout: log_blocker_and_skip
    steps:
      - id: do_it
        type: agent_work
        prompt: Work on ticket
`;
    const def = parseWorkflow(yaml);
    const resolved = resolveVariables(def, { tickets: 'T1,T2,T3' });
    const exec = await engine.start(resolved, store, { variables: { tickets: 'T1,T2,T3' } });

    // Complete T1
    await engine.complete(exec.id, 'do_it', {}, resolved, store);

    // Skip T2 (simulating timeout)
    await engine.skip(exec.id, 'do_it', 'Timed out', resolved, store);

    // T3 should be next
    const next = await engine.next(exec.id, resolved, store);
    expect(next.current_item).toBe('T3');

    // Complete T3
    const result = await engine.complete(exec.id, 'do_it', {}, resolved, store);
    expect(result.is_complete).toBe(true);
  });
});
