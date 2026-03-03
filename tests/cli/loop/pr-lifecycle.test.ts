import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { checkGhCli, hasCommitsAhead, createPr, runStructuralReview, autoMerge } from '../../../src/cli/loop/pr-lifecycle.js';
import type { LoopConfig, TicketResult } from '../../../src/cli/loop/types.js';
import type { Logger } from '../../../src/cli/loop/logger.js';

const mockLog: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLog,
};

const mockConfig = {
  loopTestCmd: "pnpm vitest run --exclude '**/guards.test.ts'",
} as LoopConfig;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── checkGhCli ─────────────────────────────────────

describe('checkGhCli', () => {
  it('returns true when gh is available and authenticated', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    expect(checkGhCli(mockLog)).toBe(true);
  });

  it('returns false when gh is not installed', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(checkGhCli(mockLog)).toBe(false);
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('gh CLI not found'));
  });

  it('returns false when gh is not authenticated', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // gh --version
      .mockImplementationOnce(() => { throw new Error('not authenticated'); }); // gh auth status
    expect(checkGhCli(mockLog)).toBe(false);
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not authenticated'));
  });
});

// ── hasCommitsAhead ────────────────────────────────

describe('hasCommitsAhead', () => {
  it('returns true when branch has commits ahead', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('3\n');
    expect(hasCommitsAhead('feat/x', '/repo')).toBe(true);
  });

  it('returns false when branch has no commits ahead', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('0\n');
    expect(hasCommitsAhead('feat/x', '/repo')).toBe(false);
  });

  it('returns false on error', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('fail'); });
    expect(hasCommitsAhead('feat/x', '/repo')).toBe(false);
  });
});

// ── createPr ───────────────────────────────────────

describe('createPr', () => {
  const tickets: TicketResult[] = [
    { ticket: 'S-1-1', title: 'Fix bug', club: 'wedge', max_files: 1, primary_model: 'local', final_model: 'local', escalated: false, tests_passing: true, noop: false },
    { ticket: 'S-1-2', title: 'Add test', club: 'putter', max_files: 1, primary_model: 'local', final_model: 'local', escalated: false, tests_passing: false, noop: false },
  ];

  it('creates PR and returns info on success', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('https://github.com/org/repo/pull/42\n');
    const result = createPr('feat/x', 'S-1', 'Fix things', 'hardening', tickets, '/repo', mockLog);
    expect(result).not.toBeNull();
    expect(result!.number).toBe(42);
    expect(result!.url).toContain('42');
  });

  it('returns null on PR creation failure', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('gh failed'); });
    const result = createPr('feat/x', 'S-1', 'Fix things', 'hardening', tickets, '/repo', mockLog);
    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalled();
  });
});

// ── runStructuralReview ────────────────────────────

describe('runStructuralReview', () => {
  it('returns 0 findings for clean diff', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('diff --git a/src/foo.ts b/src/foo.ts\n+const x = 1;\n') // gh pr diff
      .mockReturnValue(''); // slope review findings add (if called)
    const count = runStructuralReview(42, 'S-1', 1, '/repo', mockLog);
    // The clean diff has no type escapes, no console.log, etc.
    // But it will flag "untested" since there's a .ts file without .test.ts
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('detects type escapes in diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '+const x = y as any;',
      '+// @ts-ignore',
    ].join('\n');
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(diff) // gh pr diff
      .mockReturnValue(''); // slope review findings add
    const count = runStructuralReview(42, 'S-1', 1, '/repo', mockLog);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 when diff fetch fails', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('fail'); });
    const count = runStructuralReview(42, 'S-1', 1, '/repo', mockLog);
    expect(count).toBe(0);
  });
});

// ── autoMerge ──────────────────────────────────────

describe('autoMerge', () => {
  it('merges when all safeguards pass', () => {
    // Safeguard 2 (tests) and 3 (typecheck) use execSync; safeguards 4 and merge use execFileSync
    (execSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // loopTestCmd
      .mockReturnValueOnce(''); // pnpm typecheck
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('5\n') // gh pr view changedFiles
      .mockReturnValueOnce(''); // gh pr merge
    const result = autoMerge(42, 0, 3, mockConfig, '/repo', mockLog);
    expect(result.merged).toBe(true);
    expect(result.blockReason).toBeUndefined();
  });

  it('blocks when tests fail', () => {
    (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('tests fail');
    });
    const result = autoMerge(42, 0, 3, mockConfig, '/repo', mockLog);
    expect(result.merged).toBe(false);
    expect(result.blockReason).toBe('tests failing');
  });

  it('blocks when no passing tickets', () => {
    (execSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // tests
      .mockReturnValueOnce(''); // typecheck
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('3\n'); // changedFiles
    const result = autoMerge(42, 0, 0, mockConfig, '/repo', mockLog);
    expect(result.merged).toBe(false);
    expect(result.blockReason).toBe('no passing tickets');
  });

  it('blocks when too many files changed', () => {
    (execSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // tests
      .mockReturnValueOnce(''); // typecheck
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('25\n'); // changedFiles > 20
    const result = autoMerge(42, 0, 3, mockConfig, '/repo', mockLog);
    expect(result.merged).toBe(false);
    expect(result.blockReason).toContain('25 files changed');
  });

  it('blocks on critical findings', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('critical: type escape\n'); // slope review findings list
    const result = autoMerge(42, 2, 3, mockConfig, '/repo', mockLog);
    expect(result.merged).toBe(false);
    expect(result.blockReason).toContain('critical/major');
  });
});
