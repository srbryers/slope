import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { observeSessionBranches } from '../../src/core/index.js';
import type { SlopeSession } from '../../src/core/index.js';

const roots: string[] = [];

function session(overrides: Partial<SlopeSession> = {}): SlopeSession {
  return {
    session_id: 'session-1',
    role: 'primary',
    ide: 'test',
    branch: 'main',
    started_at: '2026-07-27T00:00:00.000Z',
    last_heartbeat_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('session branch observation', () => {
  it('reports the live checkout branch instead of the stored start branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'slope-session-branch-'));
    roots.push(root);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['checkout', '-q', '-b', 'feature/live'], { cwd: root });

    expect(observeSessionBranches([session()], root)).toEqual([
      expect.objectContaining({
        branch: 'feature/live',
        branch_source: 'current',
      }),
    ]);
  });

  it('labels an unresolvable stored branch as the branch at session start', () => {
    const root = mkdtempSync(join(tmpdir(), 'slope-session-branch-'));
    roots.push(root);
    const missingWorktree = join(root, 'missing');
    mkdirSync(root, { recursive: true });

    expect(observeSessionBranches([
      session({ worktree_path: missingWorktree }),
    ], root)).toEqual([
      expect.objectContaining({
        branch: 'main',
        branch_source: 'at_start',
      }),
    ]);
  });

  it('does not inspect a stored path outside the repository worktree set', () => {
    const project = mkdtempSync(join(tmpdir(), 'slope-session-project-'));
    const unrelated = mkdtempSync(join(tmpdir(), 'slope-session-unrelated-'));
    roots.push(project, unrelated);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
    execFileSync('git', ['init', '-q', '-b', 'secret/branch'], { cwd: unrelated });

    expect(observeSessionBranches([
      session({ worktree_path: unrelated }),
    ], project)).toEqual([
      expect.objectContaining({
        branch: 'main',
        branch_source: 'at_start',
      }),
    ]);
  });
});
