// SLOPE — PR Signal Parser
// Parses GitHub PR metadata (from `gh pr view --json`) into structured PRSignal objects.
// Pure parser — no I/O. CLI handles `gh` execution.

import type { PRSignal, PRReviewDecision, CISignal } from './types.js';

/** Fields to request from `gh pr view --json` */
export const GH_PR_JSON_FIELDS = [
  'number',
  'additions',
  'deletions',
  'changedFiles',
  'comments',
  'reviews',
  'reviewDecision',
  'statusCheckRollup',
  'createdAt',
  'mergedAt',
] as const;

/** Build the `gh pr view` CLI command string */
export function buildGhCommand(prNumber: number): string {
  const fields = GH_PR_JSON_FIELDS.join(',');
  return `gh pr view ${prNumber} --json ${fields}`;
}

/** Parse raw `gh pr view --json` output into a PRSignal */
export function parsePRJson(json: Record<string, unknown>): PRSignal {
  const reviews = Array.isArray(json.reviews) ? json.reviews as Record<string, unknown>[] : [];
  const comments = Array.isArray(json.comments) ? json.comments as Record<string, unknown>[] : [];
  const statusCheckRollup = Array.isArray(json.statusCheckRollup)
    ? json.statusCheckRollup as Record<string, unknown>[]
    : [];

  const { passed, failed } = extractStatusChecks(statusCheckRollup);

  return {
    platform: 'github',
    pr_number: typeof json.number === 'number' ? json.number : 0,
    review_cycles: countReviewCycles(reviews),
    change_request_count: countChangeRequests(reviews),
    time_to_merge_minutes: computeTimeToMerge(
      json.createdAt as string | undefined,
      json.mergedAt as string | undefined,
    ),
    ci_checks_passed: passed,
    ci_checks_failed: failed,
    file_count: typeof json.changedFiles === 'number' ? json.changedFiles : 0,
    additions: typeof json.additions === 'number' ? json.additions : 0,
    deletions: typeof json.deletions === 'number' ? json.deletions : 0,
    comment_count: comments.length,
    review_decision: normalizeReviewDecision(json.reviewDecision),
  };
}

/** Safe defaults for graceful degradation when PR data is unavailable */
export function emptyPRSignal(prNumber?: number): PRSignal {
  return {
    platform: 'unknown',
    pr_number: prNumber ?? 0,
    review_cycles: 0,
    change_request_count: 0,
    time_to_merge_minutes: null,
    ci_checks_passed: 0,
    ci_checks_failed: 0,
    file_count: 0,
    additions: 0,
    deletions: 0,
    comment_count: 0,
    review_decision: 'NONE',
  };
}

/**
 * Merge PR check data with an existing CISignal.
 *
 * - Both exist: keep CI runner data (more granular), detect retry scenario
 *   (PR had failures but CI shows passing → increment retries)
 * - No existing CI: derive CISignal from PR check counts (runner='unknown')
 */
export function mergePRChecksWithCI(prSignal: PRSignal, existingCI?: CISignal): CISignal {
  if (!existingCI) {
    // Derive CISignal from PR check counts
    return {
      runner: 'unknown',
      test_total: prSignal.ci_checks_passed + prSignal.ci_checks_failed,
      test_passed: prSignal.ci_checks_passed,
      test_failed: prSignal.ci_checks_failed,
      test_skipped: 0,
      suites_total: prSignal.ci_checks_passed + prSignal.ci_checks_failed,
      suites_passed: prSignal.ci_checks_passed,
      suites_failed: prSignal.ci_checks_failed,
      retries: 0,
    };
  }

  // Both exist: keep CI data, detect retry scenario
  const retryBoost = (prSignal.ci_checks_failed > 0 && existingCI.test_failed === 0)
    ? prSignal.ci_checks_failed  // PR had failures, CI now passing → retries occurred
    : 0;

  return {
    ...existingCI,
    retries: existingCI.retries + retryBoost,
  };
}

/**
 * Count checks that failed initially then succeeded (retry detection).
 * Looks at statusCheckRollup for checks with multiple runs where earlier runs failed.
 */
export function detectCheckRetries(statusCheckRollup: unknown): number {
  if (!Array.isArray(statusCheckRollup)) return 0;

  let retries = 0;
  // Group by check name, count those with mixed results
  const byName = new Map<string, string[]>();
  for (const check of statusCheckRollup) {
    const rec = check as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name : 'unknown';
    const conclusion = typeof rec.conclusion === 'string' ? rec.conclusion.toUpperCase() : '';
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(conclusion);
  }

  for (const conclusions of byName.values()) {
    if (conclusions.length > 1) {
      const hasFail = conclusions.some(c => c === 'FAILURE' || c === 'TIMED_OUT');
      const hasPass = conclusions.some(c => c === 'SUCCESS');
      if (hasFail && hasPass) retries++;
    }
  }

  return retries;
}

// --- Internal helpers ---

/**
 * Count review cycles: each time a reviewer submits a review constitutes a cycle.
 * Multiple reviews from the same author count as separate cycles (re-reviews).
 */
function countReviewCycles(reviews: Record<string, unknown>[]): number {
  return reviews.length;
}

/** Count reviews with CHANGES_REQUESTED state */
function countChangeRequests(reviews: Record<string, unknown>[]): number {
  return reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;
}

/** Compute time to merge in minutes. Returns null if not merged. */
function computeTimeToMerge(
  createdAt: string | undefined,
  mergedAt: string | undefined,
): number | null {
  if (!createdAt || !mergedAt) return null;
  const created = new Date(createdAt).getTime();
  const merged = new Date(mergedAt).getTime();
  if (isNaN(created) || isNaN(merged)) return null;
  return Math.round((merged - created) / 60000);
}

/** Extract pass/fail counts from statusCheckRollup */
function extractStatusChecks(
  rollup: Record<string, unknown>[],
): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  for (const check of rollup) {
    const conclusion = (check.conclusion as string ?? '').toUpperCase();
    const status = (check.status as string ?? '').toUpperCase();

    if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') {
      passed++;
    } else if (conclusion === 'FAILURE' || conclusion === 'TIMED_OUT' || conclusion === 'CANCELLED') {
      failed++;
    } else if (status === 'COMPLETED') {
      // No conclusion but completed — count as passed
      passed++;
    } else if (status === 'IN_PROGRESS' || status === 'QUEUED' || status === 'PENDING') {
      // Still running — don't count either way
    } else if (conclusion) {
      // Unknown conclusion — be conservative, count as failed
      failed++;
    }
  }

  return { passed, failed };
}

/** Normalize review decision to our union type */
function normalizeReviewDecision(decision: unknown): PRReviewDecision {
  if (typeof decision !== 'string') return 'NONE';
  const upper = decision.toUpperCase();
  const valid: PRReviewDecision[] = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'COMMENTED'];
  return (valid.includes(upper as PRReviewDecision) ? upper : 'NONE') as PRReviewDecision;
}
