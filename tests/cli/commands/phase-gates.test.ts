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
  // Phase 1 owns sprint 1 only, and it is scored, so phase 1 is finished and
  // its gates can be earned. Phase 2 is unscored, which is what makes the
  // boundary live.
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

      // `--team` renders a filtered view and returns before the recorder.
      // An earlier version of this test used `--player=<nobody>`, which exits
      // at "no scorecards for player" and never reaches the branch at all, so
      // deleting the guard left it green.
      runSlope(cwd, ['card', '--team']);
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

  it('refuses to record a gate on a phase whose sprints are not all scored', () => {
    const cwd = setupRepo();
    try {
      // Give phase 1 a second, unscored sprint. Its cleanup gates are then
      // claims about work that has not finished.
      const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
      const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      roadmap.phases[0].sprints = [1, 3];
      roadmap.sprints.push({
        id: 3, theme: 'Unfinished', par: 3, slope: 1, type: 'feature',
        tickets: [{ key: 'S3-1', title: 'wip', club: 'wedge', complexity: 'small' }],
      });
      writeFileSync(roadmapPath, JSON.stringify(roadmap));

      runSlope(cwd, ['map']);
      runSlope(cwd, ['card']);

      // These commands run every sprint under the post-hole routine. Without
      // the precondition they record from the phase's first sprint onward and
      // stay true, so the boundary opens on evidence gathered before the
      // later sprints existed.
      expect(gates(cwd)['1']).toBeUndefined();

      // Score the missing sprint and the same commands now qualify.
      writeFileSync(join(cwd, 'docs', 'retros', 'sprint-3.json'), JSON.stringify(scorecard('3'), null, 2));
      runSlope(cwd, ['map']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.map_refreshed).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not let a single-file validate satisfy the all-sprints gate', () => {
    const cwd = setupRepo();
    try {
      const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
      const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      roadmap.phases[0].sprints = [1, 3];
      roadmap.sprints.push({
        id: 3, theme: 'Second', par: 3, slope: 1, type: 'feature',
        tickets: [{ key: 'S3-1', title: 'more', club: 'wedge', complexity: 'small' }],
      });
      writeFileSync(roadmapPath, JSON.stringify(roadmap));
      writeFileSync(join(cwd, 'docs', 'retros', 'sprint-3.json'), JSON.stringify(scorecard('3'), null, 2));

      // One file, for a gate that means every scorecard in the phase is valid.
      trySlope(cwd, ['validate', 'docs/retros/sprint-1.json']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.scorecards_verified).toBeUndefined();

      trySlope(cwd, ['validate']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.scorecards_verified).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('defaults to the phase being closed out, not the next one', () => {
    const cwd = setupRepo();
    try {
      // Phase 2's first sprint is scored, so the naive "latest scorecard"
      // rule resolves to phase 2 while phase 1's gates are what is actually
      // owed. Phase 2 is not finished, so it must not qualify.
      const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
      const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      roadmap.phases[1].sprints = [2, 4];
      roadmap.sprints.push({
        id: 4, theme: 'Later', par: 3, slope: 1, type: 'feature',
        tickets: [{ key: 'S4-1', title: 'later', club: 'wedge', complexity: 'small' }],
      });
      writeFileSync(roadmapPath, JSON.stringify(roadmap));
      writeFileSync(join(cwd, 'docs', 'retros', 'sprint-2.json'), JSON.stringify(scorecard('2'), null, 2));

      // No phase number given, so the default has to choose.
      runSlope(cwd, ['phase', 'gate', 'handicap_generated']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.handicap_generated).toBe(true);
      expect(gates(cwd)['2']).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ignores a scorecard that belongs to no phase', () => {
    const cwd = setupRepo();
    try {
      // Reading the highest scorecard number let one stray recovery card
      // silently veto every gate, with no message anywhere.
      writeFileSync(join(cwd, 'docs', 'retros', 'sprint-999.json'), JSON.stringify(scorecard('999'), null, 2));

      runSlope(cwd, ['map']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.map_refreshed).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not require a scorecard from a superseded sprint', () => {
    const cwd = setupRepo();
    try {
      // Six phases in this repo contain superseded sprints, which never
      // produce a scorecard. Requiring one from every listed sprint would
      // lock those phases out of gate recording permanently.
      const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
      const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      roadmap.phases[0].sprints = [1, 5];
      roadmap.sprints.push({
        id: 5, theme: 'Dropped', par: 3, slope: 1, type: 'feature', status: 'superseded',
        tickets: [{ key: 'S5-1', title: 'dropped', club: 'wedge', complexity: 'small' }],
      });
      writeFileSync(roadmapPath, JSON.stringify(roadmap));

      runSlope(cwd, ['map']);
      expect((gates(cwd)['1'] as Record<string, boolean>)?.map_refreshed).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a junk phase number instead of writing a phantom entry', () => {
    const cwd = setupRepo();
    try {
      for (const bad of ['-1', '0', '3.7', '1abc']) {
        const r = trySlope(cwd, ['phase', 'gate', 'map_refreshed', bad]);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('is not a phase number');
      }
      // `audit` and `complete` kept bare parseInt after the first fix, so
      // `slope phase audit 3.7` silently marked phase 3.
      for (const sub of ['audit', 'complete']) {
        expect(trySlope(cwd, ['phase', sub, '3.7']).status).toBe(1);
        expect(trySlope(cwd, ['phase', sub, '1abc']).status).toBe(1);
      }
      expect(Object.keys(gates(cwd))).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('clears the completion stamp when a gate is cleared', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['phase', 'complete', '1']);
      expect((gates(cwd)['1'] as Record<string, unknown>)?.completed_at).toBeTruthy();

      runSlope(cwd, ['phase', 'gate', 'map_refreshed', '1', '--clear']);

      // Leaving the stamp made `phase status` print a pending gate and a
      // completion time together, and made the session briefing report
      // COMPLETE, because it branches on the stamp alone.
      expect((gates(cwd)['1'] as Record<string, unknown>)?.completed_at).toBeUndefined();
      const status = runSlope(cwd, ['phase', 'status', '1']);
      expect(status).toContain('1 gate(s) pending');
      expect(status).not.toContain('Completed:');
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
