import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadReviewState, saveReviewState, shouldRouteToReviewState } from '../../src/cli/commands/review-state.js';
import type { ReviewState } from '../../src/cli/commands/review-state.js';

let tmpDir: string;

// Mock homedir so findPlanContent's global fallback doesn't find real user plans
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => tmpDir };
});
let origCwd: typeof process.cwd;
let origExit: typeof process.exit;
let origArgv: string[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-review-state-'));
  origCwd = process.cwd;
  process.cwd = () => tmpDir;
  origArgv = process.argv;
  origExit = process.exit;
  process.exit = ((code: number) => { throw new Error(`process.exit(${code})`); }) as never;
});

afterEach(() => {
  process.cwd = origCwd;
  process.exit = origExit;
  process.argv = origArgv;
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe('loadReviewState', () => {
  it('returns null when no state file', () => {
    expect(loadReviewState(tmpDir)).toBeNull();
  });

  it('loads valid state', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    const state: ReviewState = {
      rounds_required: 2,
      rounds_completed: 1,
      tier: 'standard',
      started_at: '2026-02-22T00:00:00.000Z',
    };
    writeFileSync(join(tmpDir, '.slope/review-state.json'), JSON.stringify(state));
    expect(loadReviewState(tmpDir)).toEqual(state);
  });

  it('returns null for malformed JSON', () => {
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope/review-state.json'), 'not json');
    expect(loadReviewState(tmpDir)).toBeNull();
  });
});

describe('saveReviewState', () => {
  it('creates .slope dir and writes state', () => {
    const state: ReviewState = {
      rounds_required: 3,
      rounds_completed: 0,
      tier: 'deep',
      started_at: '2026-02-22T00:00:00.000Z',
    };
    saveReviewState(tmpDir, state);

    const written = JSON.parse(readFileSync(join(tmpDir, '.slope/review-state.json'), 'utf8'));
    expect(written.rounds_required).toBe(3);
    expect(written.tier).toBe('deep');
  });
});

describe('reviewStateCommand', () => {
  // Dynamic import to pick up process.exit mock
  async function runCommand(args: string[]) {
    const { reviewStateCommand } = await import('../../src/cli/commands/review-state.js');
    return reviewStateCommand(args);
  }

  describe('--help is read-only (#353)', () => {
    it('routes top-level review help to the read-only review-state dispatcher (#412)', () => {
      expect(shouldRouteToReviewState(['--help'])).toBe(true);
      expect(shouldRouteToReviewState(['-h'])).toBe(true);
      expect(shouldRouteToReviewState(['start', '--help'])).toBe(true);
      expect(shouldRouteToReviewState(['docs/retros/sprint-1.json'])).toBe(false);
      expect(shouldRouteToReviewState(['--plain'])).toBe(false);
    });

    it('does NOT start a review when called as `slope review start --help`', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runCommand(['start', '--help']);
        // No state file should be written — the bug was that --help
        // triggered the start handler and wrote review-state.json.
        expect(loadReviewState(tmpDir)).toBeNull();
        // Help output should mention the subcommand
        const helpText = log.mock.calls.map(c => c[0] as string).join('\n');
        expect(helpText).toMatch(/Usage: slope review start/);
        expect(helpText).toMatch(/--rounds|--tier/);
      } finally {
        log.mockRestore();
      }
    });

    it('does NOT advance the round counter when called as `slope review round --help`', async () => {
      // Pre-seed an in-progress review so the bug would have been visible
      mkdirSync(join(tmpDir, '.slope'), { recursive: true });
      const initial: ReviewState = {
        rounds_required: 3,
        rounds_completed: 1,
        tier: 'deep',
        started_at: '2026-05-10T00:00:00.000Z',
      };
      saveReviewState(tmpDir, initial);

      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runCommand(['round', '--help']);
        // Counter must be untouched
        const state = loadReviewState(tmpDir)!;
        expect(state.rounds_completed).toBe(1);
        const helpText = log.mock.calls.map(c => c[0] as string).join('\n');
        expect(helpText).toMatch(/Usage: slope review round/);
      } finally {
        log.mockRestore();
      }
    });

    it('prints subcommand-specific help for findings/amend/reset/recommend', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        for (const sub of ['findings', 'amend', 'reset', 'recommend']) {
          log.mockClear();
          await runCommand([sub, '--help']);
          const helpText = log.mock.calls.map(c => c[0] as string).join('\n');
          expect(helpText).toMatch(new RegExp(`Usage: slope review ${sub}`));
        }
      } finally {
        log.mockRestore();
      }
    });

    it('documents bounded and repeatable path scope for review run', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runCommand(['run', '--help']);
        const helpText = log.mock.calls.map(c => c[0] as string).join('\n');
        expect(helpText).toContain('--path=GLOB');
        expect(helpText).toContain('--exclude-path=GLOB');
        expect(helpText).toContain('--max-diff-bytes=N');
        expect(helpText).toContain('provider-partial');
      } finally {
        log.mockRestore();
      }
    });

    it('prints top-level help for `slope review --help` (no subcommand)', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runCommand(['--help']);
        const helpText = log.mock.calls.map(c => c[0] as string).join('\n');
        expect(helpText).toMatch(/slope review \[scorecard\.json \| --sprint=N\]/);
        expect(helpText).toContain('multiple scorecards');
        expect(helpText).toMatch(/slope review <subcommand>/);
        expect(helpText).toContain('Format sprint retrospective markdown');
        expect(helpText).toContain('start');
        expect(helpText).toContain('round');
        expect(helpText).toContain('findings');
      } finally {
        log.mockRestore();
      }
    });

    it('-h short flag is also read-only', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runCommand(['start', '-h']);
        expect(loadReviewState(tmpDir)).toBeNull();
        const helpText = log.mock.calls.map(c => c[0] as string).join('\n');
        expect(helpText).toMatch(/Usage: slope review start/);
      } finally {
        log.mockRestore();
      }
    });
  });

  describe('start', () => {
    it('creates review-state.json with --rounds', async () => {
      await runCommand(['start', '--rounds=2']);

      const state = loadReviewState(tmpDir);
      expect(state).not.toBeNull();
      expect(state!.rounds_required).toBe(2);
      expect(state!.rounds_completed).toBe(0);
      expect(state!.tier).toBe('standard');
      expect(state!.started_at).toBeDefined();
    });

    it('creates review-state.json with --tier=deep', async () => {
      await runCommand(['start', '--tier=deep']);

      const state = loadReviewState(tmpDir);
      expect(state).not.toBeNull();
      expect(state!.rounds_required).toBe(3);
      expect(state!.tier).toBe('deep');
    });

    it('creates review-state.json with --tier=light', async () => {
      await runCommand(['start', '--tier=light']);

      const state = loadReviewState(tmpDir);
      expect(state!.rounds_required).toBe(1);
      expect(state!.tier).toBe('light');
    });

    it('creates review-state.json with --tier=skip', async () => {
      await runCommand(['start', '--tier=skip']);

      const state = loadReviewState(tmpDir);
      expect(state!.rounds_required).toBe(0);
      expect(state!.tier).toBe('skip');
    });

    it('auto-detects tier from plan file', async () => {
      // Create a plan with 3 tickets → standard tier
      const plansDir = join(tmpDir, '.claude', 'plans');
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(join(plansDir, 'test-plan.md'), [
        '# Sprint Plan',
        '### S1-1: First ticket',
        'packages/core changes',
        '### S1-2: Second ticket',
        'packages/cli changes',
        '### S1-3: Third ticket',
        'More work',
      ].join('\n'));

      await runCommand(['start']);

      const state = loadReviewState(tmpDir);
      expect(state).not.toBeNull();
      expect(state!.rounds_required).toBe(2);
      expect(state!.tier).toBe('standard');
      expect(state!.plan_file).toContain('test-plan.md');
    });

    it('auto-detects deep tier for 5+ tickets', async () => {
      const plansDir = join(tmpDir, '.claude', 'plans');
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(join(plansDir, 'big-plan.md'), [
        '# Sprint Plan',
        '### S1-1: T1', '### S1-2: T2', '### S1-3: T3',
        '### S1-4: T4', '### S1-5: T5',
      ].join('\n'));

      await runCommand(['start']);

      const state = loadReviewState(tmpDir);
      expect(state!.rounds_required).toBe(3);
      expect(state!.tier).toBe('deep');
    });

    it('auto-detects light tier for 1-2 tickets in single package', async () => {
      const plansDir = join(tmpDir, '.claude', 'plans');
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(join(plansDir, 'small-plan.md'), [
        '# Sprint Plan',
        '### S1-1: One ticket',
        'packages/core only',
      ].join('\n'));

      await runCommand(['start']);

      const state = loadReviewState(tmpDir);
      expect(state!.rounds_required).toBe(1);
      expect(state!.tier).toBe('light');
    });

    it('errors with invalid tier', async () => {
      await expect(runCommand(['start', '--tier=mega']))
        .rejects.toThrow('process.exit(1)');
    });

    it('errors when no plan and no flags', async () => {
      await expect(runCommand(['start']))
        .rejects.toThrow('process.exit(1)');
    });

    it('sets plan_file when plan exists with explicit flags', async () => {
      const plansDir = join(tmpDir, '.claude', 'plans');
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(join(plansDir, 'my-plan.md'), '# Plan');

      await runCommand(['start', '--rounds=1']);

      const state = loadReviewState(tmpDir);
      expect(state!.plan_file).toContain('my-plan.md');
    });
  });

  describe('round', () => {
    it('increments rounds_completed', async () => {
      saveReviewState(tmpDir, {
        rounds_required: 2,
        rounds_completed: 0,
        tier: 'standard',
        started_at: '2026-02-22T00:00:00.000Z',
      });

      await runCommand(['round']);

      const state = loadReviewState(tmpDir);
      expect(state!.rounds_completed).toBe(1);
    });

    it('prints done message when review complete', async () => {
      saveReviewState(tmpDir, {
        rounds_required: 2,
        rounds_completed: 1,
        tier: 'standard',
        started_at: '2026-02-22T00:00:00.000Z',
      });

      const spy = vi.spyOn(console, 'log');
      await runCommand(['round']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      const state = loadReviewState(tmpDir);
      expect(state!.rounds_completed).toBe(2);
      expect(logged).toContain('Review done');
      expect(logged).toContain('ExitPlanMode is unblocked');
    });

    it('prints remaining message when not complete', async () => {
      saveReviewState(tmpDir, {
        rounds_required: 3,
        rounds_completed: 0,
        tier: 'deep',
        started_at: '2026-02-22T00:00:00.000Z',
      });

      const spy = vi.spyOn(console, 'log');
      await runCommand(['round']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      expect(logged).toContain('2 rounds remaining');
    });

    it('errors with no active review', async () => {
      await expect(runCommand(['round']))
        .rejects.toThrow('process.exit(1)');
    });
  });

  describe('status', () => {
    it('shows current state', async () => {
      saveReviewState(tmpDir, {
        rounds_required: 2,
        rounds_completed: 1,
        plan_file: '.claude/plans/test.md',
        tier: 'standard',
        started_at: '2026-02-22T00:00:00.000Z',
      });

      const spy = vi.spyOn(console, 'log');
      await runCommand(['status']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      expect(logged).toContain('Standard');
      expect(logged).toContain('1/2');
      expect(logged).toContain('test.md');
    });

    it('shows message with no active review', async () => {
      const spy = vi.spyOn(console, 'log');
      await runCommand(['status']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      expect(logged).toContain('No active review');
    });

    it('shows complete indicator when done', async () => {
      saveReviewState(tmpDir, {
        rounds_required: 1,
        rounds_completed: 1,
        tier: 'light',
        started_at: '2026-02-22T00:00:00.000Z',
      });

      const spy = vi.spyOn(console, 'log');
      await runCommand(['status']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      expect(logged).toContain('complete');
    });
  });

  describe('reset', () => {
    it('deletes state file', async () => {
      saveReviewState(tmpDir, {
        rounds_required: 2,
        rounds_completed: 0,
        tier: 'standard',
        started_at: '2026-02-22T00:00:00.000Z',
      });

      await runCommand(['reset']);

      expect(existsSync(join(tmpDir, '.slope/review-state.json'))).toBe(false);
    });

    it('succeeds when no state file exists', async () => {
      const spy = vi.spyOn(console, 'log');
      await runCommand(['reset']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      expect(logged).toContain('Review state cleared');
    });
  });

  describe('deferred finding selectors', () => {
    it('keeps trailing-zero target sprints distinct', async () => {
      await runCommand([
        'defer',
        '--from=458.9',
        '--to=458.1',
        '--severity=medium',
        '--description=Sprint .1 work',
      ]);
      await runCommand([
        'defer',
        '--from=458.9',
        '--to=458.10',
        '--severity=high',
        '--description=Sprint .10 work',
      ]);

      const spy = vi.spyOn(console, 'log');
      await runCommand(['deferred', '--sprint=458.10']);
      const logged = spy.mock.calls.map(c => c[0]).join('\n');
      spy.mockRestore();

      expect(logged).toContain('Deferred findings for Sprint 458.10');
      expect(logged).toContain('Sprint .10 work');
      expect(logged).not.toContain('Sprint .1 work');
    });
  });

  describe('unknown subcommand', () => {
    it('errors on unknown subcommand', async () => {
      await expect(runCommand(['bogus']))
        .rejects.toThrow('process.exit(1)');
    });
  });
});
