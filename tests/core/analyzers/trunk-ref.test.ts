import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { resolveTrunkRef, findShippedSprintsOnMain } from '../../../src/core/analyzers/git.js';

// #687 — shipped-commit detection resolved the trunk to the LOCAL `main`.
// A git worktree never fast-forwards its local main, so every recently
// merged sprint read as unshipped in exactly the workflow SLOPE recommends
// for parallel sprints.

function run(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

function initRepo(cwd: string): void {
  run('git init -b main', cwd);
  run('git config user.email "test@test.com"', cwd);
  run('git config user.name "Test User"', cwd);
  run('git config commit.gpgsign false', cwd);
}

function commit(cwd: string, message: string): void {
  execSync(`git commit -m "${message}" --allow-empty`, { cwd, stdio: 'pipe' });
}

describe('resolveTrunkRef (#687)', () => {
  let root: string;
  let origin: string;
  let clone: string;
  let worktree: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'slope-trunk-'));
    origin = join(root, 'origin');
    clone = join(root, 'clone');
    worktree = join(root, 'wt');

    // A bare origin the clone tracks.
    mkdirSync(origin);
    execSync(`git init --bare -b main "${origin}"`, { stdio: 'pipe' });

    const seed = join(root, 'seed');
    mkdirSync(seed);
    initRepo(seed);
    commit(seed, 'chore: seed');
    run(`git remote add origin "${origin}"`, seed);
    run('git push -u origin main', seed);

    execSync(`git clone "${origin}" "${clone}"`, { stdio: 'pipe' });
    run('git config user.email "test@test.com"', clone);
    run('git config user.name "Test User"', clone);
    run('git config commit.gpgsign false', clone);

    // Ship a sprint from the seed checkout and push it, so the clone's
    // origin/main carries it while its local main does not.
    commit(seed, 'feat(S240-1): the backlog, honest');
    run('git push origin main', seed);
    run('git fetch origin', clone);

    // The clone's local main is now behind origin/main — the worktree case.
    run(`git worktree add "${worktree}" -b feat/thing`, clone);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers the remote-tracking ref over the stale local trunk', () => {
    const resolved = resolveTrunkRef(clone);
    expect(resolved.ref).toBe('origin/main');
    expect(resolved.source).toBe('upstream');
    expect(resolved.localRef).toBe('main');
    expect(resolved.behind).toBe(1);
  });

  it('reports the same resolution from inside a worktree', () => {
    const resolved = resolveTrunkRef(worktree);
    expect(resolved.ref).toBe('origin/main');
    expect(resolved.behind).toBe(1);
  });

  it('finds the merged sprint from the clone, where local main is stale', () => {
    expect(findShippedSprintsOnMain(clone)).toEqual(new Set([240]));
  });

  // The defect as filed: run from a worktree, the sprint read as unshipped.
  it('finds the merged sprint from inside a worktree', () => {
    expect(findShippedSprintsOnMain(worktree)).toEqual(new Set([240]));
  });

  it('all four shipped-commit consumers see one trunk, so they agree', () => {
    // The four call sites (roadmap validate, slope status, slope retro and
    // the post-hole-enforcement guard) all read through this one helper.
    expect(findShippedSprintsOnMain(worktree)).toEqual(findShippedSprintsOnMain(clone));
  });

  it('honours an explicit ref over the resolved trunk', () => {
    const resolved = resolveTrunkRef(clone, 'main');
    expect(resolved.ref).toBe('main');
    expect(resolved.source).toBe('explicit');
    expect(findShippedSprintsOnMain(clone, 'main')).toEqual(new Set());
  });
});

describe('resolveTrunkRef without a remote', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-trunk-local-'));
    initRepo(tmpDir);
    commit(tmpDir, 'feat(S12): local only');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to the local trunk', () => {
    const resolved = resolveTrunkRef(tmpDir);
    expect(resolved.ref).toBe('main');
    expect(resolved.source).toBe('local');
    expect(resolved.behind).toBe(0);
  });

  it('still detects shipped sprints', () => {
    expect(findShippedSprintsOnMain(tmpDir)).toEqual(new Set([12]));
  });
});
