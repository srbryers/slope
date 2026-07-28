import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { sprintCommand } from '../../src/cli/commands/sprint.js';
import { loadSprintState, saveSprintState, createSprintState } from '../../src/cli/sprint-state.js';
import { createStore } from '../../src/store/index.js';
import { RESUME_POINTER_SCHEMA } from '../../src/cli/sprint-resume.js';
import type { RoadmapDefinition } from '../../src/core/index.js';

class ProcessExitError extends Error {
  constructor(public code: number | undefined) { super(`process.exit(${code})`); }
}

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `slope-sprint-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  mkdirSync(join(tmpDir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(tmpDir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeRoadmap(177);
  initGit();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return logs.join('\n');
}

function initGit(): void {
  execFileSync('git', ['init', '-q'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: tmpDir });
  execFileSync('git', ['add', '.'], { cwd: tmpDir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });
  execFileSync('git', ['checkout', '-q', '-b', 'feature/S177-3'], { cwd: tmpDir });
}

function headSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).trim();
}

function writeRoadmap(sprint: number, status = 'planned'): void {
  const roadmap: RoadmapDefinition = {
    name: 'Resume Test Roadmap',
    phases: [{ name: 'Phase', sprints: [sprint] }],
    sprints: [{
      id: sprint,
      theme: 'Portable Resume',
      par: 4,
      slope: 2,
      type: 'workflow',
      tickets: [
        { key: `S${sprint}-1`, title: 'One', club: 'wedge', complexity: 'small' },
        { key: `S${sprint}-2`, title: 'Two', club: 'wedge', complexity: 'small' },
        { key: `S${sprint}-3`, title: 'Three', club: 'wedge', complexity: 'small' },
      ],
      ...(status === 'planned' ? {} : { status }),
    } as RoadmapDefinition['sprints'][number]],
  };
  writeFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify(roadmap, null, 2));
}

function writePointer(overrides: Record<string, unknown> = {}): void {
  writeFileSync(join(tmpDir, 'docs', 'backlog', '.sprint-active.json'), JSON.stringify({
    schema: RESUME_POINTER_SCHEMA,
    sprint: '177',
    phase: 'implementing',
    source_branch: 'feature/S177-3',
    source_commit: headSha(),
    generated_at: '2026-06-06T00:00:00.000Z',
    evidence: { roadmap: 'docs/backlog/roadmap.json#S177' },
    resume_claims: [{ id: 'S177-3', state: 'in_progress', last_evidence: 'commit abc123' }],
    local_only_excluded: ['slope.db', 'session locks', 'guard metrics', 'baselines'],
    unsafe_to_auto_resume_if: [],
    ...overrides,
  }, null, 2));
}

describe('portable sprint resume (#507)', () => {
  it('recreates local sprint state and claims from a tracked pointer without importing locks or metrics', async () => {
    writePointer();

    const output = await captureLog(() => sprintCommand(['resume', '--portable']));

    expect(output).toContain('Portable sprint resume complete');
    const state = loadSprintState(tmpDir);
    expect(state).toMatchObject({ sprint: '177', phase: 'implementing' });
    expect(existsSync(join(tmpDir, '.slope', 'session-state.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.slope', 'guard-metrics.jsonl'))).toBe(false);
    expect(existsSync(join(tmpDir, '.slope', 'baselines'))).toBe(false);

    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      const claims = await store.list(177);
      expect(claims.map(c => c.target)).toContain('S177-3');
    } finally {
      store.close();
    }
  });

  it('refuses a branch-mismatched pointer unless forced', async () => {
    writePointer();
    execFileSync('git', ['checkout', '-q', '-b', 'other-branch'], { cwd: tmpDir });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(sprintCommand(['resume', '--portable'])).rejects.toBeInstanceOf(ProcessExitError);
      expect(loadSprintState(tmpDir)).toBeNull();
    } finally {
      const errors = errSpy.mock.calls.flat().join('\n');
      errSpy.mockRestore();
      exitSpy.mockRestore();
      expect(errors).toContain('Portable resume refused');
    }

    await captureLog(() => sprintCommand(['resume', '--portable', '--force']));
    expect(loadSprintState(tmpDir)).toMatchObject({ sprint: '177', phase: 'implementing' });
  });

  it('writes a tracked pointer from current local state and active claims', async () => {
    saveSprintState(tmpDir, createSprintState(177, 'implementing'));
    const store = createStore({ storePath: '.slope/slope.db', cwd: tmpDir });
    try {
      await store.claim({
        sprint_number: 177,
        player: 'tester',
        target: 'S177-2',
        scope: 'ticket',
        notes: 'halfway through',
      });
    } finally {
      store.close();
    }

    const output = await captureLog(() => sprintCommand(['resume', '--write-pointer']));
    const pointer = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', '.sprint-active.json'), 'utf8'));

    expect(output).toContain('Sprint resume pointer written');
    expect(pointer.schema).toBe(RESUME_POINTER_SCHEMA);
    expect(pointer.sprint).toBe('177');
    expect(pointer.source_branch).toBe('feature/S177-3');
    expect(pointer.local_only_excluded).toContain('slope.db');
    expect(pointer.resume_claims).toEqual([
      { id: 'S177-2', state: 'in_progress', scope: 'ticket', last_evidence: 'halfway through' },
    ]);
  });

  it('preserves an existing same-sprint state instead of recreating it', async () => {
    writePointer({ phase: 'planning' });
    const state = createSprintState(177, 'scoring');
    state.gates.tests = true;
    saveSprintState(tmpDir, state);

    const output = await captureLog(() => sprintCommand(['resume', '--portable']));
    const preserved = loadSprintState(tmpDir)!;

    expect(output).toContain('Existing local sprint-state and rollover lineage preserved');
    expect(preserved.phase).toBe('scoring');
    expect(preserved.gates.tests).toBe(true);
  });

  it('refuses a different local sprint even with force and preserves exact retry flags', async () => {
    writePointer();
    saveSprintState(tmpDir, createSprintState(176, 'implementing'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new ProcessExitError(code as number); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let errors = '';
    try {
      await expect(sprintCommand([
        'resume', '--portable', '--sprint=177', '--phase=scoring',
        '--from=docs/backlog/.sprint-active.json', '--force',
      ])).rejects.toBeInstanceOf(ProcessExitError);
      errors = errSpy.mock.calls.flat().join('\n');
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }

    expect(errors).toContain('slope sprint resume --portable --sprint=177 --phase=scoring --from=docs/backlog/.sprint-active.json --force');
    expect(loadSprintState(tmpDir)?.sprint).toBe('176');
  });

  it('can dry-run from branch inference when no pointer exists', async () => {
    execFileSync('git', ['checkout', '-q', '-b', 'feature/S178-2'], { cwd: tmpDir });
    const output = await captureLog(() => sprintCommand(['resume', '--portable', '--dry-run']));

    expect(output).toContain('Sprint: S178');
    expect(output).toContain('Source: branch');
    expect(output).toContain('Dry run');
    expect(loadSprintState(tmpDir)).toBeNull();
  });

  it('persists 458.10 as a canonical string without aliasing 458.1', async () => {
    saveSprintState(tmpDir, createSprintState('458.10', 'implementing'));

    const output = await captureLog(() => sprintCommand(['resume', '--write-pointer']));
    const pointer = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', '.sprint-active.json'), 'utf8'));

    expect(output).toContain('S458.10');
    expect(pointer.sprint).toBe('458.10');
    expect(pointer.sprint).not.toBe('458.1');
  });

  it('preserves 458.10 during branch-based portable inference', async () => {
    execFileSync('git', ['checkout', '-q', '-b', 'feature/S458.10-3'], { cwd: tmpDir });

    const output = await captureLog(() => sprintCommand(['resume', '--portable', '--dry-run']));

    expect(output).toContain('Sprint: S458.10');
    expect(output).not.toContain('Sprint: S458.1\n');
  });
});
