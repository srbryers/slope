import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { initStagingBranch, createUmbrellaPr, cleanupStagingBranch } from '../../../src/cli/loop/staging.js';
import type { SprintResult } from '../../../src/cli/loop/types.js';
import type { Logger } from '../../../src/cli/loop/logger.js';

const mockLog: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLog,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── initStagingBranch ─────────────────────────────

describe('initStagingBranch', () => {
  it('creates staging branch from origin/main and returns branch name', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    const branch = initStagingBranch('067', '/repo', mockLog);
    expect(branch).toBe('loop/batch-067');
    // fetch, branch create, push
    expect(execFileSync).toHaveBeenCalledTimes(3);
    expect(execFileSync).toHaveBeenCalledWith(
      'git', ['branch', 'loop/batch-067', 'origin/main'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('reuses existing branch on re-run (idempotent)', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // fetch
      .mockImplementationOnce(() => { throw new Error('already exists'); }) // branch create fails
      .mockReturnValueOnce('') // rev-parse succeeds (branch exists)
      .mockReturnValueOnce(''); // push
    const branch = initStagingBranch('067', '/repo', mockLog);
    expect(branch).toBe('loop/batch-067');
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Reusing existing'));
  });

  it('throws when branch creation fails and branch does not exist', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // fetch
      .mockImplementationOnce(() => { throw new Error('failed'); }) // branch create
      .mockImplementationOnce(() => { throw new Error('not found'); }); // rev-parse fails
    expect(() => initStagingBranch('067', '/repo', mockLog)).toThrow('Failed to create staging branch');
  });

  it('warns but does not throw when push fails', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // branch create
      .mockImplementationOnce(() => { throw new Error('push failed'); }); // push
    const branch = initStagingBranch('067', '/repo', mockLog);
    expect(branch).toBe('loop/batch-067');
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not push'));
  });
});

// ── createUmbrellaPr ──────────────────────────────

describe('createUmbrellaPr', () => {
  const results: SprintResult[] = [
    {
      sprint_id: 'S-67', title: 'Fix bugs', strategy: 'hardening',
      completed_at: '2025-01-01', branch: 'slope-loop/S-67',
      tickets_total: 3, tickets_passing: 2, tickets_noop: 1, tickets: [],
      pr_number: 100, merge_status: 'merged',
    },
    {
      sprint_id: 'S-68', title: 'Add tests', strategy: 'testing',
      completed_at: '2025-01-02', branch: 'slope-loop/S-68',
      tickets_total: 4, tickets_passing: 4, tickets_noop: 0, tickets: [],
      pr_number: 101, merge_status: 'merged',
    },
  ];

  it('creates umbrella PR with batch summary', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('5\n') // rev-list --count
      .mockReturnValueOnce('https://github.com/org/repo/pull/42\n'); // gh pr create
    const pr = createUmbrellaPr('loop/batch-067', results, '/repo', mockLog);
    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(42);
    // Verify PR targets main
    expect(execFileSync).toHaveBeenCalledWith('gh', expect.arrayContaining(['--base', 'main']),
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('returns null when staging has no commits ahead of main', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce('0\n'); // rev-list
    const pr = createUmbrellaPr('loop/batch-067', results, '/repo', mockLog);
    expect(pr).toBeNull();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('no commits ahead'));
  });

  it('returns null when gh pr create fails', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('5\n') // rev-list
      .mockImplementationOnce(() => { throw new Error('gh failed'); }); // gh pr create
    const pr = createUmbrellaPr('loop/batch-067', results, '/repo', mockLog);
    expect(pr).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Umbrella PR creation failed'));
  });
});

// ── cleanupStagingBranch ──────────────────────────

describe('cleanupStagingBranch', () => {
  it('deletes local and remote branch when merged', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    const result = cleanupStagingBranch('loop/batch-067', '/repo', mockLog);
    expect(result).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith(
      'git', ['branch', '-d', 'loop/batch-067'],
      expect.objectContaining({ cwd: '/repo' }),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      'git', ['push', 'origin', '--delete', 'loop/batch-067'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('returns false when local branch has unmerged changes', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('not fully merged');
    });
    const result = cleanupStagingBranch('loop/batch-067', '/repo', mockLog);
    expect(result).toBe(false);
  });

  it('returns true even when remote delete fails', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // local delete
      .mockImplementationOnce(() => { throw new Error('remote delete failed'); }); // remote delete
    const result = cleanupStagingBranch('loop/batch-067', '/repo', mockLog);
    expect(result).toBe(true);
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Could not delete remote'));
  });
});
