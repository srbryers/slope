import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function runSlope(cwd: string, args: string[]): string {
  return execFileSync(process.execPath, [SLOPE_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function setupRepoWithClaim(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-done-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeFileSync(join(dir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [1] }],
    sprints: [{
      id: 1,
      theme: 'Test',
      par: 4,
      slope: 1,
      type: 'feature',
      tickets: [
        { key: 'S1-1', title: 'a', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 'b', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 'c', club: 'wedge', complexity: 'small' },
      ],
    }],
  }));
  // git repo (so HEAD resolves)
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });

  // Create sprint state + claim via `sprint begin`
  runSlope(dir, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
  return dir;
}

function setupInsertedRepoWithClaim(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-done-inserted-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeFileSync(join(dir, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({
    name: 'Test',
    phases: [{ name: 'P1', sprints: [435] }],
    sprints: [{
      id: 435,
      theme: 'Inserted',
      par: 4,
      slope: 1,
      type: 'bugfix',
      tickets: [
        { key: 'S43.5-1', title: 'a', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-2', title: 'b', club: 'wedge', complexity: 'small' },
        { key: 'S43.5-3', title: 'c', club: 'wedge', complexity: 'small' },
      ],
    }],
  }));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
  runSlope(dir, ['claim', '--sprint=435', '--target=S43.5-1']);
  return dir;
}

function setupNoGitRepoWithClaim(): string {
  const dir = setupRepoWithClaim();
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  return dir;
}

describe('slope ticket done (GH #316)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('releases the active claim and prints commit SHA from HEAD', () => {
    const cwd = setupRepoWithClaim();
    try {
      const out = runSlope(cwd, ['ticket', 'done', 'S1-1']);
      expect(out).toContain('Ticket S1-1: done.');
      expect(out).toContain('Sprint:  S1');
      expect(out).toContain('Actor source:');
      expect(out).toMatch(/Commit:\s+[0-9a-f]{40}/);
      expect(out).toContain('Claim:   released');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('honors --commit flag instead of HEAD', () => {
    const cwd = setupRepoWithClaim();
    try {
      const out = runSlope(cwd, ['ticket', 'done', 'S1-1', '--commit=deadbeef']);
      expect(out).toContain('Commit:  deadbeef');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('honors --actor override for claim lookup', () => {
    const cwd = setupRepoWithClaim();
    try {
      runSlope(cwd, ['claim', '--sprint=1', '--target=S1-2', '--actor=codex']);
      const out = runSlope(cwd, ['ticket', 'done', 'S1-2', '--actor=codex']);

      expect(out).toContain('Ticket S1-2: done.');
      expect(out).toContain('Player:  codex');
      expect(out).toContain('Actor source: override');
      expect(out).toContain('Claim:   released');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records --notes flag in output', () => {
    const cwd = setupRepoWithClaim();
    try {
      const out = runSlope(cwd, ['ticket', 'done', 'S1-1', '--notes=all green']);
      expect(out).toContain('Notes:   all green');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('resolves inserted roadmap ticket labels to the encoded sprint id', () => {
    const cwd = setupInsertedRepoWithClaim();
    try {
      const out = runSlope(cwd, ['ticket', 'done', 'S43.5-1']);
      expect(out).toContain('Ticket S43.5-1: done.');
      expect(out).toContain('Sprint:  S43.5');
      expect(out).toContain('Claim:   released');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('warns without raw git fatal output when completing a ticket outside git', () => {
    const cwd = setupNoGitRepoWithClaim();
    try {
      const result = spawnSync(process.execPath, [SLOPE_BIN, 'ticket', 'done', 'S1-1'], {
        cwd,
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Ticket S1-1: done.');
      expect(result.stdout).not.toContain('Commit:');
      expect(result.stderr).toContain('Warning: no git repository detected');
      expect(result.stdout).not.toContain('fatal: not a git repository');
      expect(result.stderr).not.toContain('fatal: not a git repository');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('errors when no active claim exists for this player', () => {
    const cwd = setupRepoWithClaim();
    try {
      // Release once first
      runSlope(cwd, ['ticket', 'done', 'S1-1']);
      // Try to mark done again — no claim
      let exitCode = 0;
      let stderr = '';
      try {
        runSlope(cwd, ['ticket', 'done', 'S1-1']);
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('No active claim for S1-1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('errors clearly when ticket key argument is missing', () => {
    const cwd = setupRepoWithClaim();
    try {
      let exitCode = 0;
      let stderr = '';
      try {
        runSlope(cwd, ['ticket', 'done']);
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('ticket done <key>');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
