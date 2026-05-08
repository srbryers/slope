import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { collectCommitReady } from '../../../src/cli/commands/commit-ready.js';

function setupRepo(opts: {
  branch?: string;
  withRoadmap?: boolean;
  withSprintState?: boolean;
  withCodebaseMap?: boolean;
  modifiedFile?: boolean;
} = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-cr-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));

  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m initial', { cwd: dir });

  if (opts.branch && opts.branch !== 'main') {
    execSync(`git checkout -q -b ${opts.branch}`, { cwd: dir });
  }

  if (opts.withRoadmap) {
    writeFileSync(join(dir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
      name: 'Test',
      phases: [{ name: 'P1', sprints: [1] }],
      sprints: [{
        id: 1, theme: 'Test', par: 4, slope: 1, type: 'feature',
        tickets: [
          { key: 'S1-1', title: 'a', club: 'wedge', complexity: 'small' },
          { key: 'S1-2', title: 'b', club: 'wedge', complexity: 'small' },
          { key: 'S1-3', title: 'c', club: 'wedge', complexity: 'small' },
        ],
      }],
    }));
  }

  if (opts.withSprintState) {
    writeFileSync(join(dir, '.slope', 'sprint-state.json'), JSON.stringify({
      sprint: 1,
      phase: 'implementing',
      gates: { tests: false, code_review: false, architect_review: false, scorecard: false, review_md: false },
      started_at: '2026-05-07T00:00:00Z',
      updated_at: '2026-05-07T00:00:00Z',
    }));
  }

  if (opts.withCodebaseMap) {
    writeFileSync(join(dir, 'CODEBASE.md'), '# Codebase\n');
    execSync('git add -A && git commit -q -m "add map"', { cwd: dir });
  }

  if (opts.modifiedFile) {
    writeFileSync(join(dir, 'changed.txt'), 'edit');
  }

  return dir;
}

describe('collectCommitReady (GH #314)', () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it('blocks on main branch', async () => {
    cwd = setupRepo({ branch: 'main', withRoadmap: true, withSprintState: true, withCodebaseMap: true, modifiedFile: true });
    const r = await collectCommitReady(cwd);
    const branch = r.checks.find(c => c.name === 'branch');
    expect(branch?.ok).toBe(false);
    expect(branch?.severity).toBe('block');
    expect(r.ok).toBe(false);
  });

  it('passes when on a feature branch with everything in place', async () => {
    cwd = setupRepo({
      branch: 'feat/test',
      withRoadmap: true,
      withSprintState: true,
      withCodebaseMap: true,
      modifiedFile: true,
    });
    const r = await collectCommitReady(cwd);
    const branch = r.checks.find(c => c.name === 'branch');
    expect(branch?.ok).toBe(true);
    expect(r.blockers).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('warns when no sprint state exists', async () => {
    cwd = setupRepo({ branch: 'feat/test', modifiedFile: true });
    const r = await collectCommitReady(cwd);
    const sprint = r.checks.find(c => c.name === 'sprint');
    expect(sprint?.ok).toBe(false);
    expect(sprint?.severity).toBe('warn');
    expect(sprint?.suggestion).toContain('sprint start');
    expect(r.ok).toBe(true); // warn does not block
  });

  it('warns when no roadmap file', async () => {
    cwd = setupRepo({ branch: 'feat/test', modifiedFile: true });
    const r = await collectCommitReady(cwd);
    const rm = r.checks.find(c => c.name === 'roadmap');
    expect(rm?.ok).toBe(false);
    expect(rm?.suggestion).toContain('roadmap generate');
  });

  it('warns when CODEBASE.md is missing', async () => {
    cwd = setupRepo({ branch: 'feat/test', withRoadmap: true, modifiedFile: true });
    const r = await collectCommitReady(cwd);
    const cm = r.checks.find(c => c.name === 'codebase-map');
    expect(cm?.ok).toBe(false);
    expect(cm?.suggestion).toContain('slope map');
  });

  it('reports pending gates from sprint state', async () => {
    cwd = setupRepo({ branch: 'feat/test', withRoadmap: true, withSprintState: true, withCodebaseMap: true, modifiedFile: true });
    const r = await collectCommitReady(cwd);
    const gates = r.checks.find(c => c.name === 'gates');
    expect(gates?.ok).toBe(false);
    expect(gates?.reason).toContain('5 pending gate');
  });

  it('warns when working tree is clean', async () => {
    cwd = setupRepo({ branch: 'feat/test', withRoadmap: true, withSprintState: true, withCodebaseMap: true });
    const r = await collectCommitReady(cwd);
    const u = r.checks.find(c => c.name === 'uncommitted');
    expect(u?.ok).toBe(false);
    expect(u?.reason).toContain('clean');
  });
});
