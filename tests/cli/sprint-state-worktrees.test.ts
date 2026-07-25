import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createSprintState,
  loadSprintState,
  saveSprintState,
  updateSprintPhaseForSprintAcrossWorktrees,
} from '../../src/cli/sprint-state.js';

let primary: string;
let extraDirs: string[];

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function seedSprintState(cwd: string, sprint: number, phase: 'implementing' | 'complete'): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  const state = createSprintState(sprint);
  state.phase = phase;
  saveSprintState(cwd, state);
}

describe('updateSprintPhaseForSprintAcrossWorktrees (GH #624)', () => {
  beforeEach(() => {
    primary = mkdtempSync(join(tmpdir(), 'slope-sprint-wt-'));
    extraDirs = [];
    git(primary, ['init', '-q']);
    git(primary, ['checkout', '-q', '-b', 'main']);
    git(primary, ['config', 'user.email', 'test@example.com']);
    git(primary, ['config', 'user.name', 'Test User']);
    git(primary, ['commit', '--allow-empty', '-m', 'init']);
  });

  afterEach(() => {
    for (const dir of extraDirs) rmSync(dir, { recursive: true, force: true });
    rmSync(primary, { recursive: true, force: true });
  });

  function addWorktree(name: string): string {
    const path = join(tmpdir(), `slope-sprint-wt-${name}-${basename(primary)}`);
    extraDirs.push(path);
    git(primary, ['worktree', 'add', '-q', path, '-b', name]);
    return path;
  }

  it('advances the sprint phase in a sibling worktree, not just the cwd', () => {
    const feature = addWorktree('feature');
    seedSprintState(primary, 246, 'implementing');
    seedSprintState(feature, 246, 'implementing');

    const results = updateSprintPhaseForSprintAcrossWorktrees(primary, 246, 'complete');

    expect(loadSprintState(feature)?.phase).toBe('complete');
    expect(loadSprintState(primary)?.phase).toBe('complete');
    expect(results.filter(r => r.changed)).toHaveLength(2);
  });

  it('leaves a worktree holding a different sprint untouched and reports it', () => {
    const other = addWorktree('other');
    seedSprintState(primary, 246, 'implementing');
    seedSprintState(other, 247, 'implementing');

    const results = updateSprintPhaseForSprintAcrossWorktrees(primary, 246, 'complete');

    // Unrelated in-flight work must never be clobbered.
    expect(loadSprintState(other)?.phase).toBe('implementing');
    expect(loadSprintState(primary)?.phase).toBe('complete');
    const unmatched = results.filter(r => !r.matched);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].changed).toBe(false);
  });

  it('reports no results when no checkout holds sprint state', () => {
    addWorktree('empty');

    const results = updateSprintPhaseForSprintAcrossWorktrees(primary, 246, 'complete');

    expect(results).toEqual([]);
  });

  it('works when invoked from the worktree rather than the primary checkout', () => {
    const feature = addWorktree('from-worktree');
    seedSprintState(primary, 246, 'implementing');
    seedSprintState(feature, 246, 'implementing');

    updateSprintPhaseForSprintAcrossWorktrees(feature, 246, 'complete');

    expect(loadSprintState(primary)?.phase).toBe('complete');
    expect(loadSprintState(feature)?.phase).toBe('complete');
  });
});
