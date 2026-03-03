import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import { createWorktree, removeWorktree, getHeadSha, countCommits, pushBranch, refreshIndex } from '../../../src/cli/loop/worktree.js';
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

describe('createWorktree', () => {
  it('reuses existing worktree if path exists', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const result = createWorktree('S-001', '/repo', mockLog);
    expect(result.path).toContain('.slope-loop-worktree-S-001');
    expect(result.branch).toBe('slope-loop/S-001');
    expect(result.created).toBe(false);
  });

  it('creates new worktree and installs deps', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    const result = createWorktree('S-002', '/repo', mockLog);
    expect(result.created).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'add']),
      expect.any(Object),
    );
    // Should install deps and build (still uses execSync for shell commands)
    expect(execSync).toHaveBeenCalledWith(
      'pnpm install --frozen-lockfile',
      expect.any(Object),
    );
    expect(execSync).toHaveBeenCalledWith(
      'pnpm build',
      expect.any(Object),
    );
  });

  it('throws on worktree creation failure', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('git failed');
    });
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    expect(() => createWorktree('S-003', '/repo', mockLog)).toThrow('Failed to create worktree');
  });
});

describe('removeWorktree', () => {
  it('removes worktree and deletes branch', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    removeWorktree('/repo/.slope-loop-worktree-S-001', 'slope-loop/S-001', '/repo', mockLog);
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'remove']),
      expect.any(Object),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['branch', '-d', 'slope-loop/S-001']),
      expect.any(Object),
    );
  });

  it('warns but does not throw on removal failure', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('failed');
    });
    expect(() =>
      removeWorktree('/repo/.slope-loop-worktree-S-001', 'slope-loop/S-001', '/repo', mockLog),
    ).not.toThrow();
    expect(mockLog.warn).toHaveBeenCalled();
  });
});

describe('getHeadSha', () => {
  it('returns trimmed SHA', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('abc123\n');
    expect(getHeadSha('/repo')).toBe('abc123');
  });
});

describe('countCommits', () => {
  it('returns commit count between SHAs', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('3\n');
    expect(countCommits('aaa', 'bbb', '/repo')).toBe(3);
  });

  it('returns 0 on error', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('fail');
    });
    expect(countCommits('aaa', 'bbb', '/repo')).toBe(0);
  });
});

describe('pushBranch', () => {
  it('returns true on success', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    expect(pushBranch('feat/x', '/repo', mockLog)).toBe(true);
  });

  it('returns false on failure', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('push failed');
    });
    expect(pushBranch('feat/x', '/repo', mockLog)).toBe(false);
    expect(mockLog.warn).toHaveBeenCalled();
  });
});

describe('refreshIndex', () => {
  it('skips refresh when index is current', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('abc123\n') // git rev-parse HEAD
      .mockReturnValueOnce(JSON.stringify({ lastSha: 'abc123' })); // slope index --status
    refreshIndex('/repo', mockLog);
    // Should NOT have called slope index (the full refresh) — only 2 execFileSync calls
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('refreshes when index is stale', () => {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('abc123\n') // git rev-parse HEAD
      .mockReturnValueOnce(JSON.stringify({ lastSha: 'old-sha' })) // slope index --status
      .mockReturnValueOnce(''); // slope index (refresh)
    refreshIndex('/repo', mockLog);
    expect(execFileSync).toHaveBeenCalledTimes(3);
    expect(mockLog.info).toHaveBeenCalledWith('Updating semantic index...');
  });
});
