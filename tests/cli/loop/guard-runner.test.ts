import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { runGuards } from '../../../src/cli/loop/guard-runner.js';
import type { LoopConfig } from '../../../src/cli/loop/types.js';
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

// Valid 40-char hex SHAs for tests
const PRE_SHA = 'a'.repeat(40);
const POST_SHA = 'b'.repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runGuards', () => {
  it('passes when both typecheck and tests succeed', () => {
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    const result = runGuards(PRE_SHA, mockConfig, '/repo', mockLog);
    expect(result.passed).toBe(true);
    expect(result.failedGuard).toBeUndefined();
  });

  it('fails and reverts on typecheck failure', () => {
    // Guard 1 (typecheck) uses execSync
    (execSync as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => { throw new Error('typecheck failed'); }); // pnpm typecheck
    // countRevertable + revert use execFileSync
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(POST_SHA + '\n') // git rev-parse HEAD
      .mockReturnValueOnce('2\n') // git rev-list --count
      .mockReturnValueOnce('') // git reset --hard
      .mockReturnValueOnce(''); // git clean -fd
    const result = runGuards(PRE_SHA, mockConfig, '/repo', mockLog);
    expect(result.passed).toBe(false);
    expect(result.failedGuard).toBe('typecheck');
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('REVERT: typecheck'));
  });

  it('fails and reverts on test failure (typecheck passes)', () => {
    (execSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('') // pnpm typecheck (passes)
      .mockImplementationOnce(() => { throw new Error('tests failed'); }); // test cmd
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(POST_SHA + '\n') // git rev-parse HEAD
      .mockReturnValueOnce('1\n') // git rev-list --count
      .mockReturnValueOnce('') // git reset --hard
      .mockReturnValueOnce(''); // git clean -fd
    const result = runGuards(PRE_SHA, mockConfig, '/repo', mockLog);
    expect(result.passed).toBe(false);
    expect(result.failedGuard).toBe('tests');
  });

  it('uses configurable test command', () => {
    const customConfig = { ...mockConfig, loopTestCmd: 'pnpm test:custom' } as LoopConfig;
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    runGuards(PRE_SHA, customConfig, '/repo', mockLog);
    // Second call should be the custom test command
    expect(execSync).toHaveBeenCalledWith('pnpm test:custom', expect.any(Object));
  });

  it('reverts to exact preSha on failure', () => {
    (execSync as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => { throw new Error('typecheck failed'); });
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(POST_SHA + '\n') // git rev-parse HEAD
      .mockReturnValueOnce('2\n') // git rev-list --count
      .mockReturnValueOnce('') // git reset --hard
      .mockReturnValueOnce(''); // git clean -fd
    runGuards(PRE_SHA, mockConfig, '/repo', mockLog);
    expect(execFileSync).toHaveBeenCalledWith(
      'git', ['reset', '--hard', PRE_SHA], expect.any(Object),
    );
  });
});
