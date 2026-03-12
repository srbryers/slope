import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { aiderExecutor, getActiveChildPids } from '../../../src/cli/loop/aider-executor.js';

describe('getActiveChildPids', () => {
  it('returns a Set', () => {
    const pids = getActiveChildPids();
    expect(pids).toBeInstanceOf(Set);
  });
});

describe('aiderExecutor', () => {
  it('has id "aider"', () => {
    expect(aiderExecutor.id).toBe('aider');
  });

  it('implements the execute method', () => {
    expect(typeof aiderExecutor.execute).toBe('function');
  });
});

/**
 * Token and file parsing are private functions, but we can test them
 * indirectly by verifying the executor's output. For unit coverage,
 * we extract the regex patterns and test them directly.
 */
describe('Aider output parsing (regex patterns)', () => {
  // These mirror the regexes in parseAiderTokens and parseAiderFiles

  describe('token parsing regex', () => {
    const tokenRegex = /Tokens:\s*([\d.]+)k?\s*sent,\s*([\d.]+)k?\s*received/i;

    it('matches "Tokens: 12.3k sent, 4.5k received"', () => {
      const match = 'Tokens: 12.3k sent, 4.5k received'.match(tokenRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('12.3');
      expect(match![2]).toBe('4.5');
    });

    it('matches "Tokens: 500 sent, 200 received" (no k suffix)', () => {
      const match = 'Tokens: 500 sent, 200 received'.match(tokenRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('500');
      expect(match![2]).toBe('200');
    });

    it('does not match unrelated lines', () => {
      const match = 'Some random log output'.match(tokenRegex);
      expect(match).toBeNull();
    });
  });

  describe('file change parsing regex', () => {
    const fileRegex = /Applied edit to\s+(.+)/;

    it('matches "Applied edit to src/foo.ts"', () => {
      const match = 'Applied edit to src/foo.ts'.match(fileRegex);
      expect(match).not.toBeNull();
      expect(match![1].trim()).toBe('src/foo.ts');
    });

    it('matches "Applied edit to  packages/core/src/index.ts"', () => {
      const match = 'Applied edit to  packages/core/src/index.ts'.match(fileRegex);
      expect(match).not.toBeNull();
      expect(match![1].trim()).toBe('packages/core/src/index.ts');
    });

    it('does not match "Editing src/foo.ts"', () => {
      const match = 'Editing src/foo.ts'.match(fileRegex);
      expect(match).toBeNull();
    });
  });
});
