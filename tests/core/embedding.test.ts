import { describe, it, expect } from 'vitest';
import { shouldSkipFile, chunkFile, SKIP_DIRS } from '../../src/core/embedding.js';

describe('shouldSkipFile', () => {
  it('skips files in node_modules', () => {
    expect(shouldSkipFile('node_modules/foo/index.js')).toBe(true);
  });

  it('skips files in dist', () => {
    expect(shouldSkipFile('dist/index.js')).toBe(true);
  });

  it('skips files in .git', () => {
    expect(shouldSkipFile('.git/HEAD')).toBe(true);
  });

  it('skips files in slope-loop', () => {
    expect(shouldSkipFile('slope-loop/backlog.json')).toBe(true);
    expect(shouldSkipFile('slope-loop/run.sh')).toBe(true);
    expect(shouldSkipFile('slope-loop/results/S-LOCAL-040.json')).toBe(true);
  });

  it('skips binary extensions', () => {
    expect(shouldSkipFile('src/logo.png')).toBe(true);
    expect(shouldSkipFile('fonts/sans.woff2')).toBe(true);
  });

  it('skips lock files by name', () => {
    expect(shouldSkipFile('pnpm-lock.yaml')).toBe(true);
    expect(shouldSkipFile('package-lock.json')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(shouldSkipFile('src/core/embedding.ts')).toBe(false);
    expect(shouldSkipFile('tests/core/embedding.test.ts')).toBe(false);
    expect(shouldSkipFile('CODEBASE.md')).toBe(false);
  });
});

describe('SKIP_DIRS', () => {
  it('contains slope-loop', () => {
    expect(SKIP_DIRS.has('slope-loop')).toBe(true);
  });
});

describe('chunkFile', () => {
  it('returns single chunk for small files', () => {
    const chunks = chunkFile('test.ts', 'const x = 1;\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].filePath).toBe('test.ts');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('returns empty for empty content', () => {
    expect(chunkFile('test.ts', '')).toEqual([]);
    expect(chunkFile('test.ts', '   \n  ')).toEqual([]);
  });
});
