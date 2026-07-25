import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultReviewType,
  extractIssueRefs,
  extractFixIntentIssueRefs,
  COMMIT_RECORD_SEPARATOR,
  existingAutoCloseRefs,
  formatReviewRecommendations,
  parsePrReviewFlags,
  planPrReview,
} from '../../src/cli/commands/pr.js';
import { branchSizeWarnings, buildPrCloseoutStatus, canSettlePrCloseout, formatPrCloseoutStatus, hasSuccessfulCodeRabbitStatus, isBlockedCodeRabbitComment } from '../../src/cli/pr-closeout.js';
import { recordPrReviewPromptsGenerated } from '../../src/cli/pr-review-state.js';
import { saveReviewState } from '../../src/cli/commands/review-state.js';

describe('extractIssueRefs (GH #321)', () => {
  it('extracts a single issue ref', () => {
    expect(extractIssueRefs('fix: handle null (closes #123)')).toEqual([123]);
  });

  it('extracts multiple unique refs sorted ascending', () => {
    expect(extractIssueRefs('fix: GH #299, #297 — multi-sprint findings')).toEqual([297, 299]);
  });

  it('deduplicates repeats', () => {
    expect(extractIssueRefs('mentions #42 once and #42 again and #42')).toEqual([42]);
  });

  it('ignores in-word numbers', () => {
    expect(extractIssueRefs('SHA abc#1234 in body')).toEqual([]);
  });

  it('handles "GH #N" parenthetical form (the original #321 motivator)', () => {
    expect(extractIssueRefs('fix: ... (GH #297, #299)')).toEqual([297, 299]);
  });

  it('returns empty for no refs', () => {
    expect(extractIssueRefs('refactor: rename foo')).toEqual([]);
  });
});

describe('existingAutoCloseRefs (GH #321)', () => {
  it('detects "Closes #N"', () => {
    expect(existingAutoCloseRefs('Closes #42.')).toEqual(new Set([42]));
  });

  it('detects "Fixes #N" and "Resolves #N"', () => {
    expect(existingAutoCloseRefs('Fixes #1\nResolves #2')).toEqual(new Set([1, 2]));
  });

  it('is case-insensitive', () => {
    expect(existingAutoCloseRefs('closes #1\nFIXES #2\nResolved #3')).toEqual(new Set([1, 2, 3]));
  });

  it('handles "Closes #1, #2, #3" comma list', () => {
    // Note: GitHub itself only auto-closes the FIRST in this style, but the
    // detector is conservative — flagging anything that looks intentional
    // so we don't double-up. The first ref will be detected.
    const refs = existingAutoCloseRefs('Closes #1, #2, #3');
    expect(refs.has(1)).toBe(true);
  });

  it('does not match plain mentions', () => {
    expect(existingAutoCloseRefs('See #42 for details.')).toEqual(new Set());
  });

  it('matches bare keyword forms (GitHub auto-close also accepts these)', () => {
    // GitHub treats "close #N", "fix #N", "resolve #N" as auto-close keywords too
    expect(existingAutoCloseRefs('To close #42 we will need...')).toEqual(new Set([42]));
  });

  it('matches "fixed" / "closed" past tense', () => {
    expect(existingAutoCloseRefs('Fixed #42')).toEqual(new Set([42]));
    expect(existingAutoCloseRefs('Closed #43')).toEqual(new Set([43]));
  });
});

describe('pr review workflow helpers (S94-5)', () => {
  it('defaults transport-independent PR review to both architect and code prompts', () => {
    expect(defaultReviewType([
      { review_type: 'architect', priority: 'required', reason: '4 tickets warrants architectural review' },
      { review_type: 'code', priority: 'optional', reason: 'Baseline code review' },
    ])).toBe('both');
  });

  it('formats review recommendations for command output', () => {
    const output = formatReviewRecommendations([
      { review_type: 'architect', priority: 'required', reason: '4 tickets warrants architectural review' },
      { review_type: 'code', priority: 'optional', reason: 'Baseline code review' },
    ]);

    expect(output).toContain('architect');
    expect(output).toContain('required');
    expect(output).toContain('Baseline code review');
  });

  it('preserves repeatable bounded review scope flags for review-run forwarding', () => {
    expect(parsePrReviewFlags([
      '--pr=590', '--path=src/**', '--path=tests/**',
      '--exclude-path=docs/archive/**', '--max-diff-bytes=8192', '--json',
    ])).toMatchObject({
      pr: 590,
      paths: ['src/**', 'tests/**'],
      excludePaths: ['docs/archive/**'],
      maxDiffBytes: 8192,
      json: true,
    });
  });

  it.each([
    [['--pr=0'], '--pr must be a positive integer'],
    [['--pr=nope'], '--pr must be a positive integer'],
    [['--sprint=0'], '--sprint must be a positive sprint number'],
    [['--sprint=nope'], '--sprint must be a positive sprint number'],
    [['--type=security'], '--type must be architect, code, or both'],
    [['--path='], '--path requires a non-empty glob'],
    [['--exclude-path=   '], '--exclude-path requires a non-empty glob'],
    [['--max-diff-bytes=0'], '--max-diff-bytes must be a positive integer'],
    [['--max-diff-bytes=NaN'], '--max-diff-bytes must be a positive integer'],
    [['--max-diff-bytes=4194305'], '--max-diff-bytes cannot exceed'],
  ])('rejects invalid review scope flags instead of silently falling back: %j', (args, message) => {
    expect(() => parsePrReviewFlags(args)).toThrow(message);
  });

  it('plans and reuses bounded paginated metadata instead of legacy name-only execSync', async () => {
    const reviewDiff = {
      prNum: 590,
      repository: 'srbryers/slope',
      allFiles: ['src/review.ts', 'docs/archive/generated.yaml'],
      files: [{
        filename: 'src/review.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        changes: 3,
        expectedChangedLines: 3,
        providerChangedLines: 3,
        providerPatchState: 'complete' as const,
        includedPatch: '@@\n-old\n+new\n+more',
        localTruncated: false,
      }],
      includedDiffBytes: 20,
      includedDiffLines: 4,
      coverage: {
        complete: ['src/review.ts'],
        providerPartial: [],
        providerOmitted: [],
        localTruncated: [],
      },
      providerFileListTruncated: false,
    };
    let call: { cwd: string; pr?: number; include: string[]; exclude: string[]; maxDiffBytes: number } | undefined;
    const collector = async (cwd: string, pr: number | undefined, scope: { include: string[]; exclude: string[]; maxDiffBytes: number }) => {
      call = { cwd, pr, ...scope };
      return reviewDiff;
    };

    const plan = await planPrReview({
      pr: 590,
      sprint: 234,
      paths: ['src/**'],
      excludePaths: ['docs/archive/**'],
      maxDiffBytes: 8192,
    }, collector);

    expect(call).toMatchObject({ pr: 590, include: ['src/**'], exclude: ['docs/archive/**'], maxDiffBytes: 8192 });
    expect(plan.changedFiles).toEqual(['src/review.ts']);
    expect(plan.totalChangedFiles).toBe(2);
    expect(plan.reviewDiff).toBe(reviewDiff);
  });
});

describe('pr closeout status helpers (S130)', () => {
  it('warns when branch size exceeds closeout thresholds', () => {
    expect(branchSizeWarnings({ commits: 51, files: 101 }, { commitWarnAt: 50, fileWarnAt: 100 })).toEqual([
      'Branch has 51 commits, above closeout warning threshold 50.',
      'Branch changes 101 files, above closeout warning threshold 100.',
    ]);
  });

  it('formats missing PR review as a closeout blocker', () => {
    const output = formatPrCloseoutStatus({
      sprint: 130,
      branch: 'feat/closeout',
      scorecardPath: '/repo/docs/retros/sprint-130.json',
      scorecardExists: true,
      sprintReviewPath: '/repo/docs/retros/sprint-130-review.md',
      sprintReviewExists: true,
      unpushedCommits: 0,
      pr: { number: 468, state: 'OPEN', url: 'https://github.com/org/repo/pull/468' },
      prReview: 'missing',
      prChecks: 'unknown',
      reviewerBot: 'unknown',
      prReviewThreads: 'unknown',
      closeoutSettlement: 'missing',
      branchSize: { base: 'origin/main', commits: 4, files: 8 },
      branchSizeWarnings: [],
      blockers: ['No PR implementation review record found; run slope pr review.'],
      warnings: [],
    });

    expect(output).toContain('PR closeout status');
    expect(output).toContain('PR review:       missing');
    expect(output).toContain('PR checks:       unknown');
    expect(output).toContain('Reviewer bot:    unknown');
    expect(output).toContain('Review threads:  unknown');
    expect(output).toContain('Closeout:        missing');
    expect(output).toContain('Not ready for PR closeout.');
  });

  it('requires checks and review threads to settle before closeout can settle', () => {
    const status = {
      sprint: 130,
      branch: 'feat/closeout',
      scorecardPath: '/repo/docs/retros/sprint-130.json',
      scorecardExists: true,
      sprintReviewPath: '/repo/docs/retros/sprint-130-review.md',
      sprintReviewExists: true,
      unpushedCommits: 0,
      pr: { number: 468, state: 'OPEN', url: 'https://github.com/org/repo/pull/468' },
      prReview: 'reviewed' as const,
      prChecks: 'pending' as const,
      reviewerBot: 'settled' as const,
      prReviewThreads: 'settled' as const,
      closeoutSettlement: 'pending' as const,
      branchSize: { base: 'origin/main', commits: 4, files: 8 },
      branchSizeWarnings: [],
      blockers: ['PR checks are still pending; wait for GitHub checks to finish.'],
      warnings: [],
    };

    expect(canSettlePrCloseout(status)).toBe(false);
    expect(canSettlePrCloseout({
      ...status,
      prChecks: 'passing',
      blockers: [],
    })).toBe(true);
    expect(canSettlePrCloseout({
      ...status,
      prChecks: 'passing',
      prReviewThreads: 'pending',
      unresolvedReviewThreads: 1,
      blockers: ['1 unresolved PR review thread remains; address or resolve review feedback before closeout.'],
    })).toBe(false);
    expect(canSettlePrCloseout({
      ...status,
      prChecks: 'passing',
      reviewerBot: 'unknown',
      blockers: ['Could not determine reviewer bot status from GitHub comments.'],
    })).toBe(false);
  });

  it('blocks settlement when reviewer bot review is rate limited', () => {
    const status = {
      sprint: 130,
      branch: 'feat/closeout',
      scorecardPath: '/repo/docs/retros/sprint-130.json',
      scorecardExists: true,
      sprintReviewPath: '/repo/docs/retros/sprint-130-review.md',
      sprintReviewExists: true,
      unpushedCommits: 0,
      pr: { number: 468, state: 'OPEN', url: 'https://github.com/org/repo/pull/468' },
      prReview: 'reviewed' as const,
      prChecks: 'passing' as const,
      reviewerBot: 'pending' as const,
      reviewerBotReason: 'CodeRabbit reported a review limit or credit block; retrigger reviewer bot review before closeout.',
      prReviewThreads: 'settled' as const,
      closeoutSettlement: 'pending' as const,
      branchSize: { base: 'origin/main', commits: 4, files: 8 },
      branchSizeWarnings: [],
      blockers: ['CodeRabbit reported a review limit or credit block; retrigger reviewer bot review before closeout.'],
      warnings: [],
    };

    expect(canSettlePrCloseout(status)).toBe(false);
    expect(formatPrCloseoutStatus(status)).toContain('Reviewer bot:    pending (CodeRabbit reported');
  });

  it('detects CodeRabbit comments that mean no review actually ran', () => {
    expect(isBlockedCodeRabbitComment({
      user: { login: 'coderabbitai[bot]' },
      body: "Review limit reached: we couldn't start this review because usage credits ran out.",
    })).toBe(true);

    expect(isBlockedCodeRabbitComment({
      user: { login: 'coderabbitai[bot]' },
      body: 'Walkthrough: implementation summary and recommendations.',
    })).toBe(false);
    expect(isBlockedCodeRabbitComment({
      user: { login: 'github-actions[bot]' },
      body: "Review limit reached: we couldn't start this review.",
    })).toBe(false);
  });

  it('recognizes successful current-head CodeRabbit status contexts', () => {
    expect(hasSuccessfulCodeRabbitStatus({
      statusCheckRollup: [{ __typename: 'StatusContext', context: 'CodeRabbit', state: 'SUCCESS' }],
    })).toBe(true);

    expect(hasSuccessfulCodeRabbitStatus({
      statusCheckRollup: [{ __typename: 'StatusContext', context: 'CodeRabbit', state: 'PENDING' }],
    })).toBe(false);
    expect(hasSuccessfulCodeRabbitStatus({
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'CodeRabbit', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    })).toBe(true);
    expect(hasSuccessfulCodeRabbitStatus({
      statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci', state: 'SUCCESS' }],
    })).toBe(false);
  });

  it('treats prompt-only PR review state as pending until review rounds are complete', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-pr-closeout-rounds-'));
    try {
      mkdirSync(join(cwd, '.slope'), { recursive: true });
      writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
        currentSprint: 130,
        scorecardDir: 'docs/retros',
        scorecardPattern: 'sprint-*.json',
      }));
      recordPrReviewPromptsGenerated(cwd, { pr: 468, sprint: 130, branch: 'feat/closeout', reviewType: 'both' });

      expect(buildPrCloseoutStatus(cwd, { sprint: 130 }).prReview).toBe('pending');

      saveReviewState(cwd, {
        rounds_required: 2,
        rounds_completed: 2,
        tier: 'standard',
        started_at: new Date().toISOString(),
      });

      expect(buildPrCloseoutStatus(cwd, { sprint: 130 }).prReview).toBe('reviewed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 15000);
});

describe('extractFixIntentIssueRefs (GH #623)', () => {
  const SEP = COMMIT_RECORD_SEPARATOR;

  it('ignores issues that a triage commit only plans', () => {
    // PR #622: fixed #615/#617/#618, but merely triaged the rest into sprints.
    const commits = [
      'fix(S241-1): match reconciliation targets by exact identity (#618)',
      'fix(S241-2): patch sprint status without reserializing (#615, #617)',
      'docs(roadmap): triage open issues into Phase 54 (#608, #611, #616, #619, #620, #621)',
    ].map(c => SEP + c).join('');

    expect(extractFixIntentIssueRefs(commits)).toEqual([615, 617, 618]);
  });

  it('collects every issue in a comma/paren multi-issue reference', () => {
    expect(extractFixIntentIssueRefs(`${SEP}fix(S241-2): patch status (#615, #617)`))
      .toEqual([615, 617]);
  });

  it('ignores chore, test, style and docs commits', () => {
    const commits = ['chore: bump (#1)', 'test: add case (#2)', 'style: reformat (#3)', 'docs: note (#4)']
      .map(c => SEP + c).join('');
    expect(extractFixIntentIssueRefs(commits)).toEqual([]);
  });

  it('counts feat, perf and refactor as fix intent', () => {
    const commits = ['feat: add (#10)', 'perf: speed up (#11)', 'refactor!: rework (#12)']
      .map(c => SEP + c).join('');
    expect(extractFixIntentIssueRefs(commits)).toEqual([10, 11, 12]);
  });

  it('ignores merge commits, whose number is a PR not an issue', () => {
    expect(extractFixIntentIssueRefs(SEP + 'Merge pull request #613 from srbryers/codex/s240')).toEqual([]);
  });

  it('ignores reverts, which un-fix the issue they name', () => {
    expect(extractFixIntentIssueRefs(SEP + 'Revert "fix: something (#99)"')).toEqual([]);
  });

  it('keeps untyped squash subjects eligible', () => {
    expect(extractFixIntentIssueRefs(`${SEP}Fix the thing (#42)`)).toEqual([42]);
  });

  it('reads issue refs from a commit body, not just the subject', () => {
    const body = [`${SEP}fix: repair thing`, '', 'Closes #77.'].join(String.fromCharCode(10));
    expect(extractFixIntentIssueRefs(body)).toEqual([77]);
  });
});
