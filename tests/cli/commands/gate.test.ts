import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function setupRepoWithInitiative(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-gate-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeFileSync(join(dir, '.slope', 'initiative.json'), JSON.stringify({
    name: 'Test',
    description: 'test',
    roadmap: 'docs/backlog/roadmap.json',
    review_gates: {
      plan: { required: ['architect'], specialists: 'manual' },
      pr: { required: ['code'], specialists: 'manual' },
    },
    sprints: [
      {
        sprint_number: 1,
        phase: 'plan_review',
        plan_reviews: [],
        pr_reviews: [],
      },
      {
        sprint_number: 2,
        phase: 'pr_review',
        plan_reviews: [{ reviewer: 'architect', completed: true, findings_count: 0, reviewer_mode: 'manual' }],
        pr_reviews: [],
      },
    ],
  }));
  return dir;
}

describe('slope gate (GH #313)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('status shows pending plan and pr gates', () => {
    const cwd = setupRepoWithInitiative();
    try {
      const out = execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'status'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out).toContain('S1 plan: architect');
      expect(out).toContain('S2 pr: code');
      expect(out).toContain('slope gate complete');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('status --json emits machine-readable pending list', () => {
    const cwd = setupRepoWithInitiative();
    try {
      const out = execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'status', '--json'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(out);
      expect(parsed.pending).toHaveLength(2);
      expect(parsed.pending[0]).toEqual(expect.objectContaining({
        sprint: '1',
        gate: 'plan',
        outstanding: ['architect'],
      }));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('checklist prints questions for valid gate+reviewer', () => {
    // Doesn't need an initiative — checklist data is static
    const cwd = mkdtempSync(join(tmpdir(), 'slope-gate-'));
    try {
      const out = execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'checklist', 'plan', 'architect'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out).toContain('# architect — plan review checklist');
      expect(out).toMatch(/□\s+\[/); // at least one checklist item rendered
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('complete records the review and updates state', () => {
    const cwd = setupRepoWithInitiative();
    try {
      const out = execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'complete', 'plan', 'architect', '--sprint=1'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(out).toContain('Recorded plan review: architect');

      // Status should now show S1 plan complete (no longer in pending list)
      const status = execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'status', '--json'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(status);
      expect(parsed.pending.find((p: { sprint: string; gate: string }) => p.sprint === '1' && p.gate === 'plan')).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('completes only the exact trailing-zero sprint gate', () => {
    const cwd = setupRepoWithInitiative();
    try {
      const initiativePath = join(cwd, '.slope', 'initiative.json');
      const initiative = JSON.parse(readFileSync(initiativePath, 'utf8'));
      initiative.sprints = [
        {
          sprint_number: '458.1',
          phase: 'plan_review',
          plan_reviews: [],
          pr_reviews: [],
        },
        {
          sprint_number: '458.10',
          phase: 'plan_review',
          plan_reviews: [],
          pr_reviews: [],
        },
      ];
      writeFileSync(initiativePath, JSON.stringify(initiative));

      execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'complete', 'plan', 'architect', '--sprint=458.10'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });

      const updated = JSON.parse(readFileSync(initiativePath, 'utf8'));
      expect(updated.sprints[0].plan_reviews).toEqual([]);
      expect(updated.sprints[1].plan_reviews).toEqual([
        expect.objectContaining({ reviewer: 'architect', completed: true }),
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('complete rejects invalid gate', () => {
    const cwd = setupRepoWithInitiative();
    try {
      let exitCode = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'complete', 'bogus', 'architect', '--sprint=1'], {
          cwd, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('Invalid gate');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('complete rejects invalid reviewer', () => {
    const cwd = setupRepoWithInitiative();
    try {
      let exitCode = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, [SLOPE_BIN, 'gate', 'complete', 'plan', 'bogus', '--sprint=1'], {
          cwd, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exitCode = e.status ?? 0;
        stderr = (e.stderr instanceof Buffer ? e.stderr.toString() : (e.stderr ?? '')) as string;
      }
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('Invalid reviewer');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
