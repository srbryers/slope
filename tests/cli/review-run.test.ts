import { describe, expect, it } from 'vitest';
import {
  collectReviewDiff,
  formatReviewDiffError,
  matchesReviewScope,
  ReviewDiffError,
  runBoundedProcess,
  sanitizeGhDiagnostic,
  type BoundedProcessResult,
  type ReviewGhRunner,
} from '../../src/cli/review-diff.js';
import { parseReviewRunArgs, reviewRunInternals } from '../../src/cli/commands/review-run.js';

function result(overrides: Partial<BoundedProcessResult> = {}): BoundedProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdoutOverflow: false,
    stderrOverflow: false,
    ...overrides,
  };
}

function pullFile(filename: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@\n-old\n+new',
    ...overrides,
  };
}

function fakeRunner(pages: Array<Record<string, unknown>[]>): { runner: ReviewGhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: ReviewGhRunner = async args => {
    calls.push(args);
    if (args[0] === 'pr') return result({ stdout: '590\n' });
    if (args[0] === 'repo') return result({ stdout: 'srbryers/slope\n' });
    const pageArg = args.find(arg => arg.startsWith('page='));
    const page = Number(pageArg?.slice('page='.length) ?? '1');
    return result({ stdout: JSON.stringify(pages[page - 1] ?? []) });
  };
  return { runner, calls };
}

describe('bounded review diff transport (GH #590)', () => {
  it('captures output larger than the prior one MiB execSync boundary', async () => {
    const bytes = 1_250_000;
    const output = await runBoundedProcess(process.execPath, [
      '-e',
      `process.stdout.write('x'.repeat(${bytes}))`,
    ], { timeoutMs: 10_000, maxStdoutBytes: 2_000_000 });

    expect(output.exitCode).toBe(0);
    expect(output.stdoutOverflow).toBe(false);
    expect(Buffer.byteLength(output.stdout)).toBe(bytes);
  });

  it('classifies authentication separately and retains redacted diagnostics', async () => {
    const runner: ReviewGhRunner = async () => result({
      exitCode: 1,
      stderr: 'HTTP 401: Bad credentials github_pat_secretvalue GH_TOKEN=ghp_abcdef123456',
    });

    await expect(collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 100 }, runner))
      .rejects.toMatchObject({ kind: 'auth', exitCode: 1 });
    try {
      await collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 100 }, runner);
    } catch (error) {
      const diagnostic = formatReviewDiffError(error as ReviewDiffError);
      expect(diagnostic).toContain('gh exit code: 1');
      expect(diagnostic).toContain('[REDACTED]');
      expect(diagnostic).not.toContain('secretvalue');
      expect(diagnostic).not.toContain('abcdef123456');
    }
  });

  it('distinguishes lookup, timeout, and bounded-buffer failures', async () => {
    const lookup: ReviewGhRunner = async () => result({ exitCode: 1, stderr: 'no pull requests found for branch' });
    const timeout: ReviewGhRunner = async () => result({ exitCode: null, timedOut: true });
    const overflow: ReviewGhRunner = async () => result({ exitCode: 0, stdoutOverflow: true });

    await expect(collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 10 }, lookup))
      .rejects.toMatchObject({ kind: 'lookup' });
    await expect(collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 10 }, timeout))
      .rejects.toMatchObject({ kind: 'timeout' });
    await expect(collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 10 }, overflow))
      .rejects.toMatchObject({ kind: 'buffer' });
  });

  it('redacts common credential forms from gh stderr', () => {
    const sanitized = sanitizeGhDiagnostic(
      'Authorization: Bearer ghp_abcdef GH_TOKEN=github_pat_xyz https://user:password@example.test?a=1&token=secret',
    );
    expect(sanitized).not.toContain('ghp_abcdef');
    expect(sanitized).not.toContain('github_pat_xyz');
    expect(sanitized).not.toContain('user:password');
    expect(sanitized).not.toContain('token=secret');
    expect(sanitized).toContain('[REDACTED]');
  });
});

describe('review path scope and patch coverage', () => {
  it('parses repeatable paths, exclusions, decimal sprints, and budgets', () => {
    expect(parseReviewRunArgs([
      '--pr=590', '--sprint=234.5', '--type=code', '--json',
      '--path=src/**', '--path=tests/**', '--exclude-path=docs/archive/**', '--max-diff-bytes=4096',
    ])).toEqual({
      prNumber: 590,
      reviewType: 'code',
      sprint: 234.5,
      json: true,
      scope: {
        include: ['src/**', 'tests/**'],
        exclude: ['docs/archive/**'],
        maxDiffBytes: 4096,
      },
    });
  });

  it('supports root globs, basename globs, Windows separators, and renamed paths', () => {
    const scope = { include: ['src/**', '*.test.ts'], exclude: ['src/generated/**'] };
    expect(matchesReviewScope('src/cli/review.ts', undefined, scope)).toBe(true);
    expect(matchesReviewScope('tests/cli/review.test.ts', undefined, scope)).toBe(true);
    expect(matchesReviewScope('src\\generated\\roadmap.ts', undefined, scope)).toBe(false);
    expect(matchesReviewScope('docs/new.md', 'src/old.ts', scope)).toBe(true);
  });

  it('paginates metadata and filters generated paths before prompt construction', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => pullFile(
      index === 0 ? 'src/review.ts' : `docs/archive/generated-${index}.yaml`,
    ));
    const secondPage = [pullFile('tests/review.test.ts')];
    const { runner, calls } = fakeRunner([firstPage, secondPage]);

    const review = await collectReviewDiff('.', 590, {
      include: ['src/**', 'tests/**'],
      exclude: ['docs/archive/**'],
      maxDiffBytes: 1024,
    }, runner);

    expect(review.allFiles).toHaveLength(21);
    expect(review.files.map(file => file.filename)).toEqual(['src/review.ts', 'tests/review.test.ts']);
    expect(calls.filter(args => args[0] === 'api')).toHaveLength(2);
  });

  it('reports provider partial/omitted patches separately from local budget truncation', async () => {
    const records = [
      pullFile('src/partial.ts', {
        additions: 10,
        deletions: 0,
        changes: 10,
        patch: '@@ -1 +1 @@\n-old\n+only-one-line',
      }),
      pullFile('assets/evidence.bin', { additions: 0, deletions: 0, changes: 0, patch: undefined }),
      pullFile('src/large.ts', { patch: `@@ -1 +1 @@\n-${'a'.repeat(80)}\n+${'b'.repeat(80)}` }),
    ];
    const { runner } = fakeRunner([records]);

    const review = await collectReviewDiff('.', 590, {
      include: [],
      exclude: [],
      maxDiffBytes: 40,
    }, runner);

    expect(review.coverage.providerPartial).toContain('src/partial.ts');
    expect(review.coverage.providerOmitted).toEqual(['assets/evidence.bin']);
    expect(review.coverage.localTruncated).toContain('src/large.ts');
    const warnings = reviewRunInternals.coverageWarnings(review).join('\n');
    expect(warnings).toContain('partial patches');
    expect(warnings).toContain('omitted patches');
    expect(warnings).toContain('local prompt budget');
  });

  it('counts authored lines beginning with triple markers as patch changes', async () => {
    const { runner } = fakeRunner([[
      pullFile('src/markers.ts', {
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1 +1 @@\n---authored deletion\n+++authored addition',
      }),
    ]]);
    const review = await collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 1024 }, runner);
    expect(review.files[0].providerPatchState).toBe('complete');
    expect(review.files[0].providerChangedLines).toBe(2);
  });

  it('shares a small prompt budget across available patches', async () => {
    const { runner } = fakeRunner([[
      pullFile('src/one.ts', { patch: `@@\n+${'a'.repeat(100)}` }),
      pullFile('src/two.ts', { patch: `@@\n+${'b'.repeat(100)}` }),
    ]]);
    const review = await collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 40 }, runner);

    expect(review.files[0].includedPatch.length).toBeGreaterThan(0);
    expect(review.files[1].includedPatch.length).toBeGreaterThan(0);
    expect(review.includedDiffBytes).toBeLessThanOrEqual(40);
    expect(review.coverage.localTruncated).toEqual(['src/one.ts', 'src/two.ts']);
  });

  it('rejects malformed provider pages with a typed diagnostic', async () => {
    const runner: ReviewGhRunner = async args => {
      if (args[0] === 'pr') return result({ stdout: '590' });
      if (args[0] === 'repo') return result({ stdout: 'srbryers/slope' });
      return result({ stdout: '{not-json' });
    };
    await expect(collectReviewDiff('.', 590, { include: [], exclude: [], maxDiffBytes: 10 }, runner))
      .rejects.toMatchObject({ kind: 'malformed-response', stage: 'PR file metadata page 1' });
  });
});
