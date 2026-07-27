import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    mkdirSync(join(primary, '.slope'), { recursive: true });
    writeFileSync(join(primary, '.slope', 'config.json'), '{}\n');
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

  it('shares one sprint state across the primary and sibling worktree', () => {
    const feature = addWorktree('feature');
    seedSprintState(primary, 246, 'implementing');

    const results = updateSprintPhaseForSprintAcrossWorktrees(primary, 246, 'complete');

    expect(loadSprintState(feature)?.phase).toBe('complete');
    expect(loadSprintState(primary)?.phase).toBe('complete');
    expect(results.filter(r => r.changed)).toHaveLength(1);
    expect(existsSync(join(feature, '.slope', 'sprint-state.json'))).toBe(false);
  });

  it('writes through the shared state owner when invoked from a worktree', () => {
    const other = addWorktree('write-through');
    seedSprintState(primary, 246, 'implementing');
    const state = createSprintState(247);
    state.phase = 'implementing';
    saveSprintState(other, state);

    expect(loadSprintState(primary)?.sprint).toBe(247);
    expect(loadSprintState(other)?.sprint).toBe(247);
    expect(existsSync(join(other, '.slope', 'sprint-state.json'))).toBe(false);
  });

  it('reports no results when no checkout holds sprint state', () => {
    addWorktree('empty');

    const results = updateSprintPhaseForSprintAcrossWorktrees(primary, 246, 'complete');

    expect(results).toEqual([]);
  });

  it('works when invoked from the worktree rather than the primary checkout', () => {
    const feature = addWorktree('from-worktree');
    seedSprintState(primary, 246, 'implementing');

    updateSprintPhaseForSprintAcrossWorktrees(feature, 246, 'complete');

    expect(loadSprintState(primary)?.phase).toBe('complete');
    expect(loadSprintState(feature)?.phase).toBe('complete');
  });
});
