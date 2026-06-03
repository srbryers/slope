import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { matchSprintTicket } from '../../../src/cli/commands/auto-card.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

describe('matchSprintTicket (#352 helper)', () => {
  const allowedKeys = ['S1-1', 'S1-2', 'S1-3'];

  it('returns the explicit S{N}-{M} key when it is in the allowed set', () => {
    const cursor = { next: 0 };
    expect(matchSprintTicket('feat(S1-2): add thing', 1, allowedKeys, cursor)).toBe('S1-2');
  });

  it('returns null for an explicit key not in this sprint', () => {
    const cursor = { next: 0 };
    // Roadmap only has S1-1..S1-3 — a commit referencing S1-9 is invented
    expect(matchSprintTicket('feat(S1-9): bogus', 1, allowedKeys, cursor)).toBeNull();
  });

  it('returns null when the commit references a different sprint', () => {
    const cursor = { next: 0 };
    expect(matchSprintTicket('feat(S2-1): another sprint', 1, allowedKeys, cursor)).toBeNull();
  });

  it('returns null for setup/bootstrap commits with no sprint reference', () => {
    const cursor = { next: 0 };
    expect(matchSprintTicket('chore(SLOPE): update repo for SLOPE 1.55', 1, allowedKeys, cursor)).toBeNull();
    expect(matchSprintTicket('Initialize Cooper validation project', 1, allowedKeys, cursor)).toBeNull();
    expect(matchSprintTicket('docs(SLOPE): refresh codebase map', 1, allowedKeys, cursor)).toBeNull();
  });

  it('handles the (S{N}) umbrella by advancing through the allowed keys', () => {
    const cursor = { next: 0 };
    expect(matchSprintTicket('feat(S1): umbrella one', 1, allowedKeys, cursor)).toBe('S1-1');
    expect(matchSprintTicket('feat(S1): umbrella two', 1, allowedKeys, cursor)).toBe('S1-2');
  });

  it('treats sprint review/follow-up scopes as sprint-owned closeout commits', () => {
    const cursor = { next: 0 };
    expect(matchSprintTicket('fix(S1-review): tighten shell parsing', 1, allowedKeys, cursor)).toBe('S1-1');
    expect(matchSprintTicket('fix(S1-follow-up): address review', 1, allowedKeys, cursor)).toBe('S1-2');
    expect(matchSprintTicket('fix(S2-review): other sprint review', 1, allowedKeys, cursor)).toBeNull();
  });

  it('returns null once positional cursor exhausts the allowed keys', () => {
    const cursor = { next: 3 }; // already past the last allowed key
    expect(matchSprintTicket('feat(S1): one too many', 1, allowedKeys, cursor)).toBeNull();
  });

  it('matches decimal inserted sprint ticket keys and umbrella references', () => {
    const decimalKeys = ['S114.5-1', 'S114.5-2'];
    const cursor = { next: 0 };

    expect(matchSprintTicket('feat(S114.5-1): recommend skills', 114.5, decimalKeys, cursor)).toBe('S114.5-1');
    expect(matchSprintTicket('feat(S114.5): umbrella decimal', 114.5, decimalKeys, cursor)).toBe('S114.5-1');
    expect(matchSprintTicket('feat(S114-1): previous sprint', 114.5, decimalKeys, cursor)).toBeNull();
  });
});

function setupRepoWithRoadmap(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-auto-card-'));
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
      theme: 'First Sprint',
      par: 4,
      slope: 1,
      type: 'feature',
      tickets: [
        { key: 'S1-1', title: 'first', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 'second', club: 'wedge', complexity: 'small' },
        { key: 'S1-3', title: 'third', club: 'wedge', complexity: 'small' },
      ],
    }],
  }));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  return dir;
}

function commitWith(cwd: string, message: string) {
  execSync('git commit -q --allow-empty -m ' + JSON.stringify(message), { cwd });
}

function runAutoCard(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SLOPE_BIN, 'auto-card', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('slope auto-card --dry-run roadmap filtering (#352)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('drops setup/bootstrap commits and emits only roadmap-keyed shots', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      commitWith(cwd, 'Initialize Cooper validation project');
      commitWith(cwd, 'chore(SLOPE): update repo for SLOPE 1.55');
      commitWith(cwd, 'feat(S1-1): real ticket one');
      commitWith(cwd, 'feat(S1-2): real ticket two');

      const result = runAutoCard(cwd, ['--sprint=1', '--dry-run']);
      expect(result.status).toBe(0);
      const card = JSON.parse(result.stdout.trim());
      const keys = (card.shots as Array<{ ticket_key: string }>).map(s => s.ticket_key);

      // Order is git-log order (newest first), but the SET must be exactly
      // {S1-1, S1-2} — no invented S1-7+ keys from the bootstrap commits.
      expect(new Set(keys)).toEqual(new Set(['S1-1', 'S1-2']));
      expect(keys).not.toContain('S1-3'); // no commit for it
      // Any S1-N where N > 3 is invented — that's the bug
      expect(keys.some(k => {
        const m = /^S1-(\d+)$/.exec(k);
        return m ? parseInt(m[1], 10) > 3 : false;
      })).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('warns about and lists dropped commits on stderr', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      commitWith(cwd, 'chore: unrelated cleanup');
      commitWith(cwd, 'feat(S1-1): real ticket');

      const result = runAutoCard(cwd, ['--sprint=1', '--dry-run']);
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/Filtered 1 commit/);
      expect(result.stderr).toContain('chore: unrelated cleanup');
      expect(result.stderr).toContain('--include-untracked');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('warns when sprint-scoped commits do not cover every roadmap ticket', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      commitWith(cwd, 'feat(S1): broad implementation');
      commitWith(cwd, 'fix(S1-review): review follow-up');

      const result = runAutoCard(cwd, ['--sprint=1', '--dry-run']);
      expect(result.status).toBe(0);
      const combined = `${result.stderr}${result.stdout}`;
      const jsonStart = combined.indexOf('{');
      expect(jsonStart).toBeGreaterThanOrEqual(0);
      const card = JSON.parse(combined.slice(jsonStart).trim());
      const keys = (card.shots as Array<{ ticket_key: string }>).map(s => s.ticket_key);

      expect(keys).toEqual(['S1-1', 'S1-2']);
      expect(combined).toContain('matched 2/3 S1 roadmap ticket');
      expect(combined).toContain('may undercount multi-ticket closeout work');
      expect(combined).toContain('S1-3');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('--include-untracked keeps every commit (legacy behavior)', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      commitWith(cwd, 'chore(SLOPE): bootstrap');
      commitWith(cwd, 'docs(SLOPE): refresh map');
      commitWith(cwd, 'feat(S1-1): real ticket');

      const result = runAutoCard(cwd, ['--sprint=1', '--include-untracked', '--dry-run']);
      expect(result.status).toBe(0);
      const card = JSON.parse(result.stdout.trim());
      expect((card.shots as unknown[]).length).toBe(3);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exits non-zero when filtering eliminates every commit', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      commitWith(cwd, 'chore(SLOPE): bootstrap');
      commitWith(cwd, 'docs: random');

      const result = runAutoCard(cwd, ['--sprint=1', '--dry-run']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/No commits .* reference S1 tickets/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('blocks no-roadmap default HEAD scans before falling back to positional inference', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      // Sprint 2 has no roadmap entry. The default HEAD scan can traverse
      // unrelated history, so it must be bounded or explicitly opted in.
      commitWith(cwd, 'feat: anything');

      const result = runAutoCard(cwd, ['--sprint=2', '--dry-run']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Roadmap has no S2 sprint definition');
      expect(result.stderr).toContain('--since=<date>');
      expect(result.stderr).toContain('--include-untracked');

      const namedBranchResult = runAutoCard(cwd, ['--sprint=2', '--branch=main', '--dry-run']);
      expect(namedBranchResult.status).not.toBe(0);
      expect(namedBranchResult.stderr).toContain('git scan is unbounded');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('allows no-roadmap positional inference when an explicit scan bound is provided', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      commitWith(cwd, 'feat: anything');

      const result = runAutoCard(cwd, ['--sprint=2', '--since=1970-01-01', '--dry-run']);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Using explicit scan bounds');
      const card = JSON.parse(result.stdout.trim());
      expect(card.shots.length).toBe(1);
      expect(card.shots[0].ticket_key).toBe('S2-1'); // legacy positional
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
