import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { checkBranchHygiene } from '../../src/cli/commands/doctor.js';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-doctor-bh-'));
  execSync('git init -q', { cwd: dir });
  execSync('git checkout -b main -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m initial', { cwd: dir });
  return dir;
}

function makeBranch(cwd: string, name: string, mergeIntoMain = false) {
  execSync(`git checkout -q -b ${name}`, { cwd });
  execSync(`git commit -q --allow-empty -m "branch ${name}"`, { cwd });
  if (mergeIntoMain) {
    execSync('git checkout -q main', { cwd });
    execSync(`git merge -q --no-ff ${name} -m "merge ${name}"`, { cwd });
  } else {
    execSync('git checkout -q main', { cwd });
  }
}

describe('checkBranchHygiene (GH #322)', () => {
  let cwd: string;

  beforeEach(() => { cwd = setupRepo(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('returns empty array outside a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slope-doctor-not-git-'));
    try {
      expect(checkBranchHygiene(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports OK when no merged branches exist', () => {
    const checks = checkBranchHygiene(cwd);
    const merged = checks.find(c => c.name === 'branch-hygiene-merged');
    expect(merged?.status).toBe('ok');
    expect(merged?.message).toContain('No merged-to-main cleanup needed');
  });

  it('reports OK with low merged-branch count under threshold', () => {
    makeBranch(cwd, 'feat/one', true);
    makeBranch(cwd, 'feat/two', true);
    const checks = checkBranchHygiene(cwd);
    const merged = checks.find(c => c.name === 'branch-hygiene-merged');
    expect(merged?.status).toBe('ok');
    expect(merged?.message).toContain('2 merged-to-main branch(es)');
    expect(merged?.message).toContain('under threshold');
  });

  it('warns when 5 or more merged branches accumulate', () => {
    for (let i = 0; i < 5; i++) makeBranch(cwd, `feat/${i}`, true);
    const checks = checkBranchHygiene(cwd);
    const merged = checks.find(c => c.name === 'branch-hygiene-merged');
    expect(merged?.status).toBe('warn');
    expect(merged?.message).toMatch(/5 merged-to-main/);
    expect(merged?.message).toContain('git branch -d');
  }, 15_000);

  it('reports OK for stale-remotes when no remote configured', () => {
    const checks = checkBranchHygiene(cwd);
    const stale = checks.find(c => c.name === 'branch-hygiene-stale-remotes');
    expect(stale?.status).toBe('ok');
    expect(stale?.message).toContain('No stale remote-tracking refs');
  });
});
