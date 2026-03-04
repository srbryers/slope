import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { runGuards, isSubstantive } from '../../../src/cli/loop/guard-runner.js';
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
  // Helper: mock substantiveness check (git diff -w) to return real code changes
  function mockSubstantiveDiff(): void {
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(
        '+import { foo } from "./bar";\n+export function doStuff() {\n+  return foo();\n+}\n',
      ); // git diff -w (substantiveness check)
  }

  it('passes when substantiveness + typecheck + tests all succeed', () => {
    mockSubstantiveDiff();
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    const result = runGuards(PRE_SHA, mockConfig, '/repo', mockLog);
    expect(result.passed).toBe(true);
    expect(result.failedGuard).toBeUndefined();
  });

  it('fails substantiveness guard on comment-only changes', () => {
    // Return only comment lines in the diff
    (execFileSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(
        '+// This is a comment\n+// Another comment\n-// Old comment\n',
      ) // git diff -w (only comments)
      .mockReturnValueOnce('') // git reset --hard
      .mockReturnValueOnce(''); // git clean -fd
    const result = runGuards(PRE_SHA, mockConfig, '/repo', mockLog);
    expect(result.passed).toBe(false);
    expect(result.failedGuard).toBe('substantiveness');
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not substantive'));
  });

  it('fails and reverts on typecheck failure', () => {
    mockSubstantiveDiff();
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
    mockSubstantiveDiff();
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
    mockSubstantiveDiff();
    const customConfig = { ...mockConfig, loopTestCmd: 'pnpm test:custom' } as LoopConfig;
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    runGuards(PRE_SHA, customConfig, '/repo', mockLog);
    expect(execSync).toHaveBeenCalledWith('pnpm test:custom', expect.any(Object));
  });

  it('reverts to exact preSha on failure', () => {
    mockSubstantiveDiff();
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

describe('isSubstantive', () => {
  it('returns true for real code changes', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '+import { foo } from "./bar";\n+export function doStuff() {\n+  return foo();\n+}\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(true);
  });

  it('returns false for comment-only changes', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '+// Added a comment\n+// Another comment\n-// Removed comment\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(false);
  });

  it('returns false for whitespace-only changes', () => {
    // -w flag means whitespace changes produce empty diff
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce('');
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(false);
  });

  it('returns false for JSDoc-only changes', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '+/**\n+ * New JSDoc comment\n+ */\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(false);
  });

  it('returns true when mix of comments and real code', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '+// Added a comment\n+import { foo } from "./bar";\n+const x = foo();\n+export { x };\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(true);
  });

  it('requires at least 3 substantive lines (boundary: 2 lines = false)', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '+import { foo } from "./bar";\n+const x = 1;\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(false);
  });

  it('passes at exactly 3 substantive lines (boundary)', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '+import { foo } from "./bar";\n+const x = 1;\n+export { x };\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(true);
  });

  it('returns true when diff fails (conservative fallback)', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('not a git repo');
    });
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(true);
  });

  it('filters out diff header lines (+++/---)', () => {
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      '--- a/src/foo.ts\n+++ b/src/foo.ts\n+// just a comment\n',
    );
    expect(isSubstantive(PRE_SHA, '/repo')).toBe(false);
  });
});
