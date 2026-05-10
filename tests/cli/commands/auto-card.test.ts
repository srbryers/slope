import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
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

  it('returns null once positional cursor exhausts the allowed keys', () => {
    const cursor = { next: 3 }; // already past the last allowed key
    expect(matchSprintTicket('feat(S1): one too many', 1, allowedKeys, cursor)).toBeNull();
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

      const out = execSync(`node ${SLOPE_BIN} auto-card --sprint=1 --dry-run`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const card = JSON.parse(out.trim());
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

      // Capture stderr by redirecting via a shell. execSync's `stderr` property
      // on success is undefined, and the dry-run exits 0, so route stderr
      // through stdout for inspection.
      const combined = execSync(
        `node ${SLOPE_BIN} auto-card --sprint=1 --dry-run 2>&1 1>/dev/null`,
        { cwd, encoding: 'utf8', shell: '/bin/sh' },
      );
      expect(combined).toMatch(/Filtered 1 commit/);
      expect(combined).toContain('chore: unrelated cleanup');
      expect(combined).toContain('--include-untracked');
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

      const out = execSync(`node ${SLOPE_BIN} auto-card --sprint=1 --include-untracked --dry-run`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const card = JSON.parse(out.trim());
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

      let exitCode: number | null = null;
      let stderr = '';
      try {
        execSync(`node ${SLOPE_BIN} auto-card --sprint=1 --dry-run`, {
          cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        const err = e as { status?: number; stderr?: string };
        exitCode = err.status ?? null;
        stderr = err.stderr ?? '';
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/No commits .* reference S1 tickets/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('falls back to legacy positional inference when sprint is not in roadmap', () => {
    const cwd = setupRepoWithRoadmap();
    try {
      // Sprint 2 has no roadmap entry — fall back to old behavior
      commitWith(cwd, 'feat: anything');

      const out = execSync(`node ${SLOPE_BIN} auto-card --sprint=2 --dry-run`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const card = JSON.parse(out.trim());
      expect(card.shots.length).toBe(1);
      expect(card.shots[0].ticket_key).toBe('S2-1'); // legacy positional
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

