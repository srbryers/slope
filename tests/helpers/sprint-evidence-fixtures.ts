import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSprintState, type SprintState } from '../../src/cli/sprint-state.js';

const created: string[] = [];

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function cleanupFixtures(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export const SPRINT_STATE = '.slope/sprint-state.json';

/** A git checkout on branch `main` with one commit. SLOPE files are written by the caller. */
export function initRepo(prefix = 'slope-scope-'): string {
  const dir = tempDir(prefix);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);
  writeFile(dir, 'README.md', 'initial\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

export function writeFile(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function writeConfig(root: string): void {
  writeFile(root, '.slope/config.json', JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    roadmapPath: 'docs/backlog/roadmap.json',
  }));
}

export function writeScorecard(root: string, sprint: string): void {
  writeFile(root, `docs/retros/sprint-${sprint}.json`, JSON.stringify({ sprint_number: sprint, score: 4, par: 4 }));
}

export function writeState(root: string, state: unknown): string {
  writeFile(root, SPRINT_STATE, typeof state === 'string' ? state : JSON.stringify(state, null, 2) + '\n');
  return join(root, SPRINT_STATE);
}

export function commitAll(root: string, message: string): string {
  git(root, ['add', '-A', '-f']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

export function addWorktree(primary: string, branch: string, startPoint = 'HEAD'): string {
  const path = join(tempDir('slope-scope-wt-'), 'wt');
  git(primary, ['worktree', 'add', '-q', path, '-b', branch, startPoint]);
  return path;
}

/** A finished sprint: every gate true, review evidence recorded. */
export function completeState(sprint = '64.6'): SprintState {
  const state = createSprintState(sprint, 'complete');
  for (const gate of Object.keys(state.gates) as Array<keyof SprintState['gates']>) state.gates[gate] = true;
  state.review_gates.code_review = { provenance: 'pr_review', evidence: ['https://example.test/pr/1'] };
  state.review_gates.architect_review = { provenance: 'pr_review', evidence: ['https://example.test/pr/1'] };
  return state;
}

/** An active sprint with nothing done yet. */
export function activeState(sprint = '70'): SprintState {
  return createSprintState(sprint, 'implementing');
}

/** The file Prelude actually had: a never-started draft with null gates. */
export const PRELUDE_DRAFT = {
  sprint: 'H1-agentic-ui-kit',
  phase: 'planned',
  gates: { tests: null, code_review: null, architect_review: null, scorecard: null, review_md: null },
  note: "DRAFT for Sebastian's review (2026-09-30)",
};

/** The shape that is genuinely corrupt: active phase, null gate. */
export function nullGateActiveState(): Record<string, unknown> {
  const state = activeState('71') as unknown as Record<string, unknown>;
  (state.gates as Record<string, unknown>).tests = null;
  return state;
}
