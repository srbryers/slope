import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultReviewType,
  extractIssueRefs,
  existingAutoCloseRefs,
  formatReviewRecommendations,
  parsePrReviewFlags,
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
