import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-begin-'));
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
      theme: 'Test sprint',
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
  return dir;
}

describe('slope sprint begin (GH #311)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('starts sprint state, claims ticket, prints briefing/prep/next on first run', () => {
    const cwd = setupRepo();
    try {
      const out = execSync(`node ${SLOPE_BIN} sprint begin --sprint=1 --ticket=S1-1`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out).toContain('Sprint 1: started (phase: planning)');
      expect(out).toContain('Ticket S1-1: claimed');
      expect(out).toContain('PREP: S1-1');
      expect(out).toContain('NEXT');
      expect(out).toContain('Pending gates:');

      // Sprint state file should exist
      expect(existsSync(join(cwd, '.slope', 'sprint-state.json'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('is idempotent — running twice does not re-create state or re-claim', () => {
    const cwd = setupRepo();
    try {
      execSync(`node ${SLOPE_BIN} sprint begin --sprint=1 --ticket=S1-1`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const out2 = execSync(`node ${SLOPE_BIN} sprint begin --sprint=1 --ticket=S1-1`, {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out2).toContain('already started');
      expect(out2).toContain('already claimed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses to begin a different sprint when state exists for another', () => {
    const cwd = setupRepo();
    try {
      execSync(`node ${SLOPE_BIN} sprint begin --sprint=1 --ticket=S1-1`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      let exitCode = 0;
      try {
        execSync(`node ${SLOPE_BIN} sprint begin --sprint=2 --ticket=S2-1`, {
          cwd, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('Refusing to begin S2');
      expect(stderr).toContain('sprint reset');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('errors clearly when --sprint or --ticket is missing', () => {
    const cwd = setupRepo();
    try {
      let exitCode = 0;
      let stderr = '';
      try {
        execSync(`node ${SLOPE_BIN} sprint begin`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/sprint=N|ticket=KEY/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
