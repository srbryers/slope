import { describe, it, expect } from 'vitest';
import { extractFileRefs, FILE_REF_PATTERN, AMBIGUOUS_BASENAMES } from '../../slope-loop/analyze-scorecards.js';

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

  it('filters ambiguous bare basenames like test.ts, init.ts, index.js', () => {
    const result = extractFileRefs([
      'test.ts init.ts index.js types.ts config.ts utils.js helpers.ts',
    ]);
    expect(result).toEqual([]);
  });

  it('accepts ambiguous names when they have a path prefix', () => {
    const result = extractFileRefs([
      'src/cli/commands/init.ts',
      'packages/core/src/index.ts',
      'src/store/test.ts',
    ]);
    expect(result).toContain('src/cli/commands/init.ts');
    expect(result).toContain('packages/core/src/index.ts');
    expect(result).toContain('src/store/test.ts');
  });

  it('prefers path-qualified refs over bare basenames', () => {
    const result = extractFileRefs([
      'Fixed enrich.ts in src/core/enrich.ts',
    ]);
    expect(result).toEqual(['src/core/enrich.ts']);
    expect(result).not.toContain('enrich.ts');
  });

  it('non-ambiguous bare names still pass', () => {
    const result = extractFileRefs([
      'enrich.ts run.sh continuous.sh dashboard.ts',
    ]);
    expect(result).toContain('enrich.ts');
    expect(result).toContain('run.sh');
    expect(result).toContain('continuous.sh');
    expect(result).toContain('dashboard.ts');
  });

  it('excludes .test.ts and .spec.ts files (hotspots target production code)', () => {
    const result = extractFileRefs([
      'src/mcp/index.test.ts',
      'tests/mcp/index-src.test.ts',
      'src/core/scoring.spec.ts',
      'guard-runner.test.ts',
    ]);
    expect(result).toEqual([]);
  });

  it('keeps production files that contain "test" in path but not as suffix', () => {
    const result = extractFileRefs([
      'src/store/test.ts',
      'src/test-utils/helpers.ts',
    ]);
    expect(result).toContain('src/store/test.ts');
    expect(result).toContain('src/test-utils/helpers.ts');
  });
});

describe('AMBIGUOUS_BASENAMES', () => {
  it('contains expected common basenames', () => {
    expect(AMBIGUOUS_BASENAMES.has('test')).toBe(true);
    expect(AMBIGUOUS_BASENAMES.has('index')).toBe(true);
    expect(AMBIGUOUS_BASENAMES.has('init')).toBe(true);
    expect(AMBIGUOUS_BASENAMES.has('types')).toBe(true);
    expect(AMBIGUOUS_BASENAMES.has('config')).toBe(true);
  });

  it('does not contain non-ambiguous names', () => {
    expect(AMBIGUOUS_BASENAMES.has('enrich')).toBe(false);
    expect(AMBIGUOUS_BASENAMES.has('dashboard')).toBe(false);
    expect(AMBIGUOUS_BASENAMES.has('continuous')).toBe(false);
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
