import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sprintCommand } from '../../../src/cli/commands/sprint.js';
import { createSprintState, loadSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-sprint-gate-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  saveSprintState(tmpDir, createSprintState(219, 'implementing'));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('slope sprint gate review provenance', () => {
  it('rejects bare review gate completion', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(sprintCommand(['gate', 'code_review'])).rejects.toThrow('process.exit(1)');

    const state = loadSprintState(tmpDir)!;
    expect(state.gates.code_review).toBe(false);
    expect(state.review_gates.code_review).toEqual({ provenance: 'pending', evidence: [] });
    expect(errors.join('\n')).toContain('requires explicit independent-review evidence');
    expect(errors.join('\n')).toContain('--reviewer=<agent-or-person>');
  });

  it('records independent review evidence for review gates', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand([
      'gate',
      'architect_review',
      '--reviewer=architect-agent',
      '--evidence=reviews/architect-agent.md',
    ]);

    const state = loadSprintState(tmpDir)!;
    expect(state.gates.architect_review).toBe(true);
    expect(state.review_gates.architect_review).toMatchObject({
      provenance: 'independent_review',
      evidence: ['reviews/architect-agent.md'],
      reviewer: 'architect-agent',
      updated_at: expect.any(String),
    });
    expect(logs.join('\n')).toContain("Gate 'architect_review' marked complete (independent_review)");
  });

  it('requires an explicit waiver instead of self-review for a required gate', async () => {
    const state = createSprintState(219, 'implementing');
    state.review_requirements!.architect_review = {
      priority: 'required',
      reason: 'Three tickets warrants architectural review',
    };
    saveSprintState(tmpDir, state);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    await expect(sprintCommand([
      'gate',
      'architect_review',
      '--self-review',
      '--reason=No delegated reviewer available',
    ])).rejects.toThrow('process.exit(1)');

    expect(loadSprintState(tmpDir)!.gates.architect_review).toBe(false);
    expect(errors.join('\n')).toContain('required independent review');
    expect(errors.join('\n')).toContain('--waive-independent-review');
  });

  it('records required-review waivers as a visibly downgraded ready state', async () => {
    const state = createSprintState(219, 'complete');
    state.review_requirements!.architect_review = {
      priority: 'required',
      reason: 'Three tickets warrants architectural review',
    };
    state.gates.tests = true;
    state.gates.code_review = true;
    state.review_gates.code_review = {
      provenance: 'independent_review',
      evidence: ['reviews/code.md'],
      reviewer: 'code-agent',
    };
    state.gates.scorecard = true;
    state.gates.review_md = true;
    saveSprintState(tmpDir, state);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand([
      'gate',
      'architect_review',
      '--waive-independent-review',
      '--reason=Delegated reviewers require explicit operator authorization',
    ]);
    await sprintCommand(['status']);

    const loaded = loadSprintState(tmpDir)!;
    expect(loaded.review_gates.architect_review.provenance).toBe('independent_review_waived');
    const output = logs.join('\n');
    expect(output).toContain('ready_for_pr_with_review_waiver');
    expect(output).toContain('[~] architect_review (required independent review WAIVED');
    expect(output).toContain('Attach independent reviewer/PR evidence to replace the waiver');
  });

  it('shows self-review as a weaker provenance in sprint status', async () => {
    const state = createSprintState(219, 'implementing');
    state.gates.code_review = true;
    state.review_gates.code_review = {
      provenance: 'self_review',
      evidence: [],
      notes: 'Docs-only follow-up; no code behavior changed.',
      updated_at: '2026-06-27T00:00:00Z',
    };
    saveSprintState(tmpDir, state);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand(['status']);

    const output = logs.join('\n');
    expect(output).toContain('[x] code_review (self_review (weaker); reason=Docs-only follow-up; no code behavior changed.)');
    expect(output).not.toContain('code_review (independent_review');
  });

  it('shows independent reviewer and evidence in sprint status', async () => {
    const state = createSprintState(219, 'implementing');
    state.gates.architect_review = true;
    state.review_gates.architect_review = {
      provenance: 'independent_review',
      evidence: ['reviews/architect-agent.md'],
      reviewer: 'architect-agent',
      updated_at: '2026-06-27T00:00:00Z',
    };
    saveSprintState(tmpDir, state);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand(['status']);

    const output = logs.join('\n');
    expect(output).toContain('[x] architect_review (independent_review; reviewer=architect-agent; evidence=reviews/architect-agent.md)');
  });

  it('flags review gates with true booleans but missing evidence as incomplete in sprint status', async () => {
    const state = createSprintState(219, 'implementing');
    state.gates.tests = true;
    state.gates.code_review = true;
    saveSprintState(tmpDir, state);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    await sprintCommand(['status']);

    const output = logs.join('\n');
    expect(output).toContain('[!] code_review (pending review evidence)');
    expect(output).toContain('Remaining: code_review (review evidence incomplete)');
  });

  it('documents weaker review provenance modes in gate help', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });

    await sprintCommand(['gate', 'code_review', '--help']);

    const output = errors.join('\n');
    expect(output).toContain('self_review (weaker)');
    expect(output).toContain('independent_review_waived');
    expect(output).toContain('--waive-independent-review');
    expect(output).toContain('manual_override (weaker)');
    expect(output).toContain('independent_review');
  });
});
