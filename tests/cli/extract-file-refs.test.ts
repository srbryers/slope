import { describe, it, expect } from 'vitest';
import { extractFileRefs, FILE_REF_PATTERN } from '../../slope-loop/analyze-scorecards.js';

describe('extractFileRefs', () => {
  it('extracts bare filenames and relative paths', () => {
    const result = extractFileRefs([
      'enrich.ts',
      'run.sh',
      'src/core/prep.ts',
    ]);
    expect(result).toContain('enrich.ts');
    expect(result).toContain('run.sh');
    expect(result).toContain('src/core/prep.ts');
  });

  it('matches .ts, .js, and .sh extensions', () => {
    const result = extractFileRefs([
      'foo.ts bar.js baz.sh',
    ]);
    expect(result).toEqual(expect.arrayContaining(['foo.ts', 'bar.js', 'baz.sh']));
  });

  it('matches .json only with a path prefix', () => {
    const result = extractFileRefs([
      'analysis.json',
      'config/settings.json',
    ]);
    expect(result).not.toContain('analysis.json');
    expect(result).toContain('config/settings.json');
  });

  it('excludes docs/, templates/, dist/, node_modules/, .claude/, .slope/ directories', () => {
    const inputs = [
      'docs/retros/sprint-1.json',
      'templates/init.ts',
      'dist/index.js',
      'node_modules/foo/bar.ts',
      '.claude/hooks/test.sh',
      '.slope/config.json',
    ];
    const result = extractFileRefs(inputs);
    expect(result).toHaveLength(0);
  });

  it('excludes dot-stripped directory variants (claude/, slope/)', () => {
    // The \\b in the regex strips leading dots, so .claude/ may match as claude/
    const result = extractFileRefs([
      'claude/hooks/test.sh',
      'slope/config.json',
    ]);
    expect(result).toHaveLength(0);
  });

  it('deduplicates across multiple texts', () => {
    const result = extractFileRefs([
      'Fixed enrich.ts threshold',
      'enrich.ts still used old 0.55 threshold',
    ]);
    expect(result).toEqual(['enrich.ts']);
  });

  it('returns empty array for empty inputs', () => {
    expect(extractFileRefs([])).toEqual([]);
    expect(extractFileRefs([''])).toEqual([]);
    expect(extractFileRefs(['no file references here'])).toEqual([]);
  });

  it('extracts file refs embedded in prose', () => {
    const result = extractFileRefs([
      'enrich.ts still used old 0.55 threshold',
    ]);
    expect(result).toEqual(['enrich.ts']);
  });

  it('extracts multiple files from a single string', () => {
    const result = extractFileRefs([
      'Fixed run.sh and continuous.sh',
    ]);
    expect(result).toContain('run.sh');
    expect(result).toContain('continuous.sh');
    expect(result).toHaveLength(2);
  });
});

describe('FILE_REF_PATTERN', () => {
  it('is a global regex', () => {
    expect(FILE_REF_PATTERN.flags).toContain('g');
  });

  it('matches expected file extensions', () => {
    const input = 'foo.ts bar.js baz.sh config/x.json skip.py';
    const matches = [...input.matchAll(FILE_REF_PATTERN)].map(m => m[1]);
    expect(matches).toEqual(['foo.ts', 'bar.js', 'baz.sh', 'config/x.json']);
    expect(matches).not.toContain('skip.py');
  });
});
