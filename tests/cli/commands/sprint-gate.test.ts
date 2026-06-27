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
});
