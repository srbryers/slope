import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
    phases: [{ name: 'P1', sprints: [1, 2] }],
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
    }, {
      id: 2,
      theme: 'Next sprint',
      par: 4,
      slope: 1,
      type: 'feature',
      tickets: [
        { key: 'S2-1', title: 'next', club: 'wedge', complexity: 'small' },
      ],
    }],
  }));
  return dir;
}

function envWithoutActor(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (['SLOPE_ACTOR', 'SLOPE_PLAYER', 'USER', 'USERNAME'].includes(key.toUpperCase())) {
      delete env[key];
    }
  }
  env.USER = 'unknown';
  env.USERNAME = 'unknown';
  return env;
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
      const out = runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
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
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      const out2 = runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      expect(out2).toContain('already started');
      expect(out2).toContain('already claimed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses to begin a different sprint when state exists for another', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);

      let stderr = '';
      let exitCode = 0;
      try {
        runSlope(cwd, ['sprint', 'begin', '--sprint=2', '--ticket=S2-1', '--actor=recovery-agent']);
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('Refusing to begin S2');
      expect(stderr).toContain('slope sprint rollover --from=1 --to=2 --force --reason="<why>"');
      expect(stderr).toContain('slope sprint begin --sprint=2 --ticket=S2-1 --actor=recovery-agent');
      expect(stderr).not.toContain('sprint reset');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('recommends a safe non-force rollover for terminal prior state', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      const statePath = join(cwd, '.slope', 'sprint-state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      for (const gate of Object.keys(state.gates)) state.gates[gate] = true;
      state.review_gates = {
        code_review: { provenance: 'independent_review', evidence: ['code-review.md'], reviewer: 'reviewer' },
        architect_review: { provenance: 'independent_review', evidence: ['architecture-review.md'], reviewer: 'architect' },
      };
      writeFileSync(statePath, JSON.stringify(state, null, 2));

      const result = spawnSync(process.execPath, [
        SLOPE_BIN,
        'sprint',
        'begin',
        '--sprint=2',
        '--ticket=S2-1',
      ], { cwd, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('slope sprint rollover --from=1 --to=2');
      expect(result.stderr).not.toContain('--force');
      expect(result.stderr).toContain('slope sprint begin --sprint=2 --ticket=S2-1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves corrupt state instead of treating it as missing', () => {
    const cwd = setupRepo();
    try {
      const statePath = join(cwd, '.slope', 'sprint-state.json');
      const corrupt = '{"sprint": 1, "gates": ';
      writeFileSync(statePath, corrupt);

      const result = spawnSync(process.execPath, [
        SLOPE_BIN,
        'sprint',
        'begin',
        '--sprint=2',
        '--ticket=S2-1',
      ], { cwd, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('corrupt sprint evidence was preserved');
      expect(readFileSync(statePath, 'utf8')).toBe(corrupt);
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
        runSlope(cwd, ['sprint', 'begin']);
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

  it('honors --actor override and prints the identity source', () => {
    const cwd = setupRepo();
    try {
      const out = runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1', '--actor=codex-reviewer']);

      expect(out).toContain('player codex-reviewer, actor source: override');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('prints fallback actor source when no identity source exists', () => {
    const cwd = setupRepo();
    try {
      const result = spawnSync(process.execPath, [
        SLOPE_BIN,
        'sprint',
        'begin',
        '--sprint=1',
        '--ticket=S1-1',
      ], {
        cwd,
        encoding: 'utf8',
        env: envWithoutActor(),
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('player unknown, actor source: fallback (unknown)');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
