import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * S267.7 — every phase cleanup gate must be reachable from a command that
 * checks something, so `slope phase complete` goes back to being the manual
 * override its own label claims (#696).
 *
 * The reported failure was a workflow-level one: each individual command
 * succeeded and the boundary still refused. So the central test walks the
 * whole documented path and asserts the boundary opens, rather than checking
 * gates one at a time.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function runSlope(cwd: string, args: string[]): string {
  return execFileSync(process.execPath, [SLOPE_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function trySlope(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SLOPE_BIN, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function scorecard(sprint: string) {
  return {
    sprint_number: sprint,
    theme: `Sprint ${sprint}`,
    par: 3,
    slope: 1,
    score: 3,
    score_label: 'par',
    date: '2026-09-04',
    shots: [{
      ticket_key: `S${sprint}-1`,
      title: 'work',
      club: 'wedge',
      result: 'green',
      hazards: [],
    }],
    stats: {
      fairways_hit: 1, fairways_total: 1,
      greens_in_regulation: 1, greens_total: 1,
      putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
  };
}

/** A repo with two phases, phase 1 finished, so the boundary is live. */
function setupRepo(packageManager: 'pnpm' | 'npm' | 'bun' = 'pnpm'): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-phase-'));
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
    phases: [
      { name: 'Phase 1 — Groundwork', sprints: [1] },
      { name: 'Phase 2 — Next', sprints: [2] },
    ],
    sprints: [
      {
        id: 1, theme: 'Groundwork', par: 3, slope: 1, type: 'feature', status: 'complete',
        tickets: [{ key: 'S1-1', title: 'work', club: 'wedge', complexity: 'small' }],
      },
      {
        id: 2, theme: 'Next', par: 3, slope: 1, type: 'feature',
        tickets: [{ key: 'S2-1', title: 'later', club: 'wedge', complexity: 'small' }],
      },
    ],
  }));
  writeFileSync(join(dir, 'docs', 'retros', 'sprint-1.json'), JSON.stringify(scorecard('1'), null, 2));

  // A lockfile, so the regression command is derived rather than assumed.
  const lockfile = { pnpm: 'pnpm-lock.yaml', npm: 'package-lock.json', bun: 'bun.lockb' }[packageManager];
  writeFileSync(join(dir, lockfile), '');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));

  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

function gates(cwd: string): Record<string, unknown> {
  const path = join(cwd, '.slope', 'phase-cleanup.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')).phases ?? {};
}

describe('phase cleanup gates (#696)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('names the project package manager in the regression gate, not bun', () => {
    const cwd = setupRepo('pnpm');
    try {
      const out = runSlope(cwd, ['phase', 'status', '1']);
      expect(out).toContain('runs `pnpm test`');
      expect(out).not.toContain('bun test');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('still says bun for a bun project', () => {
    const cwd = setupRepo('bun');
    try {
      // The old behaviour was not wrong for bun projects, it was wrong for
      // everyone else. Detection must not overcorrect.
      expect(runSlope(cwd, ['phase', 'status', '1'])).toContain('runs `bun test`');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records the map gate from a real slope map run, and not from --check', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'start', '--number=1', '--phase=implementing']);

      // Exits 1 because no map exists yet, which is correct and is exactly
      // the state in which it must not claim the map was refreshed.
      expect(trySlope(cwd, ['map', '--check']).status).toBe(1);
      expect(gates(cwd)['1']).toBeUndefined();

      runSlope(cwd, ['map']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.map_refreshed).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records the scorecard gate from slope validate, and not from --read-only', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'start', '--number=1', '--phase=implementing']);

      trySlope(cwd, ['validate', '--read-only']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.scorecards_verified).toBeUndefined();

      trySlope(cwd, ['validate']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.scorecards_verified).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records the handicap gate from slope card, and not from a filtered view', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'start', '--number=1', '--phase=implementing']);

      runSlope(cwd, ['card', '--player=nobody-with-this-name']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.handicap_generated).toBeUndefined();

      runSlope(cwd, ['card']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.handicap_generated).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records the regression gate only when the command succeeds', () => {
    const cwd = setupRepo();
    try {
      const failed = trySlope(cwd, ['phase', 'regression', '1', '--command=node -e "process.exit(3)"']);
      expect(failed.status).toBe(3);
      expect(failed.stderr).toContain('Gate not recorded');
      expect((gates(cwd)['1'] as Record<string, boolean>)?.regression_passed).toBeUndefined();

      runSlope(cwd, ['phase', 'regression', '1', '--command=node -e "process.exit(0)"']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.regression_passed).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records and clears a single gate as evidence', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['phase', 'gate', 'handicap_generated', '1']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.handicap_generated).toBe(true);

      runSlope(cwd, ['phase', 'gate', 'handicap_generated', '1', '--clear']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.handicap_generated).toBe(false);

      const bad = trySlope(cwd, ['phase', 'gate', 'not_a_gate', '1']);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('Gate names:');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('opens the phase boundary through the documented workflow, with no override', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'start', '--number=1', '--phase=implementing']);

      // The exact sequence #696 reported as insufficient.
      trySlope(cwd, ['validate']);
      runSlope(cwd, ['card']);
      runSlope(cwd, ['map']);
      runSlope(cwd, ['phase', 'audit', '1']);
      runSlope(cwd, ['phase', 'regression', '1', '--command=node -e "process.exit(0)"']);

      const status = runSlope(cwd, ['phase', 'status', '1']);
      expect(status).toContain('COMPLETE');
      expect(status).not.toContain('gate(s) pending');

      // `phase complete` was never run, so the ledger holds earned evidence.
      const phase1 = gates(cwd)['1'] as Record<string, unknown>;
      expect(phase1.scorecards_verified).toBe(true);
      expect(phase1.handicap_generated).toBe(true);
      expect(phase1.map_refreshed).toBe(true);
      expect(phase1.findings_audited).toBe(true);
      expect(phase1.regression_passed).toBe(true);
      expect(phase1.completed_at).toBeTruthy();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
