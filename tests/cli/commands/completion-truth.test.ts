import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * S267.6 — the three surfaces that answer "what should I do next" must agree
 * with the ledger `slope ticket done` writes (#697), and the evidence it
 * records must be an immutable sha (#698).
 *
 * These drive the built CLI end to end on purpose. The bug was that each
 * surface reached its own answer in its own process, so a unit test of any one
 * of them would have passed while the reported defect stayed reproducible.
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

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-completion-'));
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
      theme: 'Completion Truth',
      par: 4,
      slope: 1,
      type: 'bugfix',
      tickets: [
        { key: 'S1-1', title: 'first', club: 'wedge', complexity: 'small' },
        { key: 'S1-2', title: 'second', club: 'wedge', complexity: 'small' },
      ],
    }],
  }));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

function beginAndFinish(dir: string, ticket: string, extra: string[] = []): void {
  runSlope(dir, ['sprint', 'begin', '--sprint=1', `--ticket=${ticket}`]);
  runSlope(dir, ['ticket', 'done', ticket, ...extra]);
}

describe('completion truth across surfaces (#697)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('slope now advances past a completed ticket after its claim is released', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');

      const parsed = JSON.parse(runSlope(cwd, ['now', '--json']));

      // Before the fix, `slope now` looked only at active claims. `ticket done`
      // releases the claim on success, so S1-1 came straight back as next.
      expect(parsed.nextTicket.key).toBe('S1-2');
      expect(parsed.tickets).toEqual({ total: 2, completed: 1 });
      expect(parsed.nextAction).toContain('S1-2');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('compact roadmap status marks the ticket done and recommends the next one', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');

      const out = runSlope(cwd, ['roadmap', 'status']);

      expect(out).toContain('S1-1: first [done]');
      expect(out).toContain('S1-2: second');
      expect(out).not.toContain('S1-2: second [done]');
      // Was `tickets[0]` unconditionally, which named the finished ticket.
      expect(out).toContain('Work S1-2: second');
      expect(out).not.toContain('Work S1-1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('compact roadmap status recommends closeout once every ticket is recorded done', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');
      beginAndFinish(cwd, 'S1-2');

      const out = runSlope(cwd, ['roadmap', 'status']);

      expect(out).toContain('All 2 tickets recorded done');
      expect(out).not.toMatch(/Work S1-[12]/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('agent status and slope now name the same next ticket', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');

      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      const agent = JSON.parse(runSlope(cwd, ['agent', 'status', '--json']));

      expect(agent.nextTicket).toBe(now.nextTicket.key);
      expect(agent.nextTicket).toBe('S1-2');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('completion evidence (#698)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('resolves an explicit --commit ref to an immutable sha', () => {
    const cwd = setupRepo();
    try {
      const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);

      const out = runSlope(cwd, ['ticket', 'done', 'S1-1', '--commit=HEAD']);

      // `HEAD` moves. Recording it verbatim made the evidence meaningless the
      // moment the next commit landed.
      expect(out).toContain(`Commit:  ${head}`);
      expect(out).not.toMatch(/Commit: {2}HEAD$/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses a --commit ref git cannot resolve and keeps the claim', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);

      const r = trySlope(cwd, ['ticket', 'done', 'S1-1', '--commit=not-a-real-ref']);

      expect(r.status).toBe(1);
      expect(r.stderr).toContain('could not resolve --commit=not-a-real-ref');
      expect(r.stderr).toContain('claim is still yours');

      // The claim survived, so the ticket can be completed properly.
      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      expect(now.claims.ticketClaims).toBe(1);
      expect(now.tickets.completed).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records a corrected completion that supersedes bad commit evidence', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      runSlope(cwd, ['ticket', 'done', 'S1-1']);
      const first = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      execSync('git commit -q --allow-empty -m second', { cwd });
      const second = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      expect(second).not.toBe(first);

      const out = runSlope(cwd, ['ticket', 'repair', 'S1-1', `--commit=${second}`]);

      expect(out).toContain(second);
      // Still one completed ticket, not two: the repair supersedes rather than
      // appends a second answer.
      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      expect(now.tickets).toEqual({ total: 2, completed: 1 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
