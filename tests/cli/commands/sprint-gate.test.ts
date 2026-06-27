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
    expect(output).toContain('manual_override (weaker)');
    expect(output).toContain('independent_review');
  });
});
