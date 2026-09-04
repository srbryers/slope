import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

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
    phases: [{ name: 'P1', sprints: [1, 2] }],
    sprints: [
      {
        id: 1,
        theme: 'Completion Truth',
        par: 4,
        slope: 1,
        type: 'bugfix',
        tickets: [
          { key: 'S1-1', title: 'first', club: 'wedge', complexity: 'small' },
          { key: 'S1-2', title: 'second', club: 'wedge', complexity: 'small' },
        ],
      },
      // A second sprint so state can legitimately advance. The rollover guard
      // refuses to start a sprint the roadmap does not contain, which is the
      // right behaviour and the reason the evidence-after-rollover test needs
      // somewhere real to roll to.
      {
        id: 2,
        theme: 'Next',
        par: 4,
        slope: 1,
        type: 'bugfix',
        tickets: [
          { key: 'S2-1', title: 'later work', club: 'wedge', complexity: 'small' },
        ],
      },
    ],
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
      expect(parsed.tickets).toMatchObject({ total: 2, completed: 1 });
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

describe('completion truth with a live claim (#697)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('all three surfaces skip a ticket claimed by someone else', () => {
    const cwd = setupRepo();
    try {
      // Someone else holds S1-1. The three surfaces used to answer this three
      // ways: `now` skipped it, `agent status` reported it as in-flight even
      // though it belongs to another player, and roadmap status ignored
      // claims entirely and named it.
      runSlope(cwd, ['claim', '--sprint=1', '--target=S1-1', '--actor=someone-else']);

      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      const agent = JSON.parse(runSlope(cwd, ['agent', 'status', '--json']));
      const status = runSlope(cwd, ['roadmap', 'status']);

      expect(now.nextTicket.key).toBe('S1-2');
      expect(agent.nextTicket).toBe('S1-2');
      expect(status).toContain('Work S1-2: second');
      expect(status).toContain('S1-1: first [claimed]');
      expect(agent.nextTicketReason).toBe('available');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('all three surfaces resume the asking actor own claim', () => {
    const cwd = setupRepo();
    try {
      // `sprint begin` claims as the resolved actor, so S1-1 is this actor's
      // work in flight. Resuming beats starting S1-2.
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);

      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      const agent = JSON.parse(runSlope(cwd, ['agent', 'status', '--json']));
      const status = runSlope(cwd, ['roadmap', 'status']);

      expect(now.nextTicket.key).toBe('S1-1');
      expect(agent.nextTicket).toBe('S1-1');
      expect(agent.nextTicketReason).toBe('in_flight');
      expect(status).toContain('Continue S1-1: first');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports work held by others rather than calling the sprint done', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');
      runSlope(cwd, ['claim', '--sprint=1', '--target=S1-2', '--actor=someone-else']);

      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      const status = runSlope(cwd, ['roadmap', 'status']);

      // One done, one held by another player. Recommending closeout here
      // would call the sprint finished while someone is mid-ticket.
      expect(now.nextTicket).toBeNull();
      expect(now.tickets.status).toBe('all_claimed');
      expect(now.nextAction).toContain('claimed by someone else');
      expect(status).toContain('claimed by someone else');
      expect(status).not.toContain('recorded done. Close out');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('emits nextTicket as null rather than omitting it when nothing is startable', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');
      beginAndFinish(cwd, 'S1-2');

      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      const agent = JSON.parse(runSlope(cwd, ['agent', 'status', '--json']));

      // Dropping the key entirely made `parsed.nextTicket.key` throw on one
      // surface and return null on the other.
      expect(Object.hasOwn(now, 'nextTicket')).toBe(true);
      expect(now.nextTicket).toBeNull();
      expect(agent.nextTicket).toBeNull();
      expect(now.tickets.status).toBe('all_complete');
      expect(agent.nextTicketReason).toBe('all_complete');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('says the ledger is unreadable instead of reporting nothing recorded', () => {
    const cwd = setupRepo();
    try {
      beginAndFinish(cwd, 'S1-1');
      const db = new Database(join(cwd, '.slope', 'slope.db'));
      db.exec('DROP TABLE events');
      db.close();

      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      const status = runSlope(cwd, ['roadmap', 'status']);

      // Swallowing this into an empty set is what the write side was fixed
      // for: every surface would call the finished ticket unfinished and
      // recommend it again, with no diagnostic.
      expect(now.ledgerError).toBeTruthy();
      expect(runSlope(cwd, ['now'])).toContain('Tickets: unknown');
      expect(status).toContain('Completion ledger unavailable');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('roadmap status does not create a store just to read the ledger', () => {
    const cwd = setupRepo();
    try {
      const db = join(cwd, '.slope', 'slope.db');
      expect(existsSync(db)).toBe(false);

      runSlope(cwd, ['roadmap', 'status']);

      // A read-only report was running a full schema migration in repos that
      // had never opened a store.
      expect(existsSync(db)).toBe(false);
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

  it('exits 1 and keeps the claim when the completion write fails', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);

      // Break only the write target. `claims` stays intact so the command
      // reaches the insert, which is the step S267.6-2 stopped swallowing.
      const db = new Database(join(cwd, '.slope', 'slope.db'));
      db.exec('DROP TABLE events');
      db.close();

      const r = trySlope(cwd, ['ticket', 'done', 'S1-1']);

      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Could not record completion for S1-1');
      expect(r.stderr).toContain('claim was NOT released');
      expect(r.stdout).not.toContain('Ticket S1-1: done.');

      // The claim really is still held, so the work is not silently lost.
      const claims = runSlope(cwd, ['claim', 'list', '--sprint=1']);
      expect(claims).toContain('S1-1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('shows and repairs a completion after sprint state has moved on', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      runSlope(cwd, ['ticket', 'done', 'S1-1']);
      const original = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

      // Advance sprint state, which is what happens before anyone audits
      // evidence. Resolving through the current sprint made `show` report the
      // completion as absent and `repair` refuse it. S1 is not terminal here
      // (no scorecard), so the rollover needs --force, which is what the
      // guard's own message tells you to run.
      runSlope(cwd, ['sprint', 'rollover', '--from=1', '--to=2', '--force', '--reason=test']);
      runSlope(cwd, ['sprint', 'start', '--number=2', '--phase=implementing']);

      const shown = JSON.parse(runSlope(cwd, ['ticket', 'show', 'S1-1', '--json']));
      expect(shown.completed).toBe(true);
      expect(shown.commit).toBe(original);
      expect(shown.sprint).toBe('1');

      execSync('git commit -q --allow-empty -m later', { cwd });
      const corrected = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      const out = runSlope(cwd, ['ticket', 'repair', 'S1-1', `--commit=${corrected}`]);

      // The correction lands on sprint 1, where the completion lives, not on
      // the sprint that happens to be current.
      expect(out).toContain('Sprint:  S1');
      const after = JSON.parse(runSlope(cwd, ['ticket', 'show', 'S1-1', '--json']));
      expect(after.commit).toBe(corrected);
      expect(after.sprint).toBe('1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses an explicit --commit outside a git work tree instead of storing it raw', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      rmSync(join(cwd, '.git'), { recursive: true, force: true });

      const r = trySlope(cwd, ['ticket', 'done', 'S1-1', '--commit=HEAD']);

      // This path used to store `HEAD` verbatim under a warning saying no SHA
      // had been attached, so #698 stayed fully reproducible here.
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('Commit:  HEAD');
      expect(r.stderr).toContain('No git repository was detected');
      expect(r.stderr).toContain('Nothing was recorded');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('clears notes on request and keeps the original player through a repair', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['claim', '--sprint=1', '--target=S1-1', '--actor=original-player']);
      runSlope(cwd, ['ticket', 'done', 'S1-1', '--actor=original-player', '--notes=wrong note']);

      const out = runSlope(cwd, ['ticket', 'repair', 'S1-1', '--notes=', '--actor=someone-else']);

      expect(out).toContain('Notes:   (cleared)');
      const after = JSON.parse(runSlope(cwd, ['ticket', 'show', 'S1-1', '--json']));
      expect(after.notes).toBeUndefined();
      // Correcting evidence is not a change of who did the work.
      expect(after.player).toBe('original-player');
      // A notes-only repair must not retarget the commit at whatever HEAD is.
      expect(after.commit).toBe(execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim());
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records a corrected completion that supersedes bad commit evidence', () => {
    const cwd = setupRepo();
    try {
      runSlope(cwd, ['sprint', 'begin', '--sprint=1', '--ticket=S1-1']);
      runSlope(cwd, ['ticket', 'done', 'S1-1', '--notes=original notes']);
      const first = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      execSync('git commit -q --allow-empty -m second', { cwd });
      const second = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      expect(second).not.toBe(first);

      // No claim is needed: `ticket done` released it, which was the whole
      // reason bad evidence had no repair path.
      const out = runSlope(cwd, ['ticket', 'repair', 'S1-1', `--commit=${second}`]);

      expect(out).toContain(`Was:     ${first}`);
      expect(out).toContain(`Commit:  ${second}`);
      // The correction replaces the old evidence rather than sitting beside it.
      const events = JSON.parse(runSlope(cwd, ['ticket', 'show', 'S1-1', '--json']));
      expect(events.commit).toBe(second);
      // `completed` is present on the success path, not only the absent one.
      expect(events.completed).toBe(true);
      expect(events.repaired).toBe(true);
      // Notes it did not replace survive the repair.
      expect(events.notes).toBe('original notes');

      // Still one completed ticket, not two.
      const now = JSON.parse(runSlope(cwd, ['now', '--json']));
      expect(now.tickets).toMatchObject({ total: 2, completed: 1 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
