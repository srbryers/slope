import { describe, it, expect } from 'vitest';
import { buildGhCommand, parsePRJson, emptyPRSignal, GH_PR_JSON_FIELDS } from '../src/pr-signals.js';

// --- Real `gh pr view --json` sample fixtures ---

const CLEAN_PR = {
  number: 42,
  additions: 150,
  deletions: 30,
  changedFiles: 8,
  comments: [
    { body: 'LGTM' },
  ],
  reviews: [
    { state: 'APPROVED', author: { login: 'reviewer1' } },
  ],
  reviewDecision: 'APPROVED',
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
  createdAt: '2026-02-20T10:00:00Z',
  mergedAt: '2026-02-20T11:30:00Z',
};

const PR_WITH_REVIEW_CYCLES = {
  number: 99,
  additions: 400,
  deletions: 120,
  changedFiles: 15,
  comments: [
    { body: 'Needs changes to the API' },
    { body: 'Updated per feedback' },
    { body: 'One more thing...' },
    { body: 'Fixed' },
    { body: 'LGTM now' },
  ],
  reviews: [
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer1' } },
    { state: 'CHANGES_REQUESTED', author: { login: 'reviewer2' } },
    { state: 'APPROVED', author: { login: 'reviewer1' } },
    { state: 'APPROVED', author: { login: 'reviewer2' } },
  ],
  reviewDecision: 'APPROVED',
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
  createdAt: '2026-02-18T09:00:00Z',
  mergedAt: '2026-02-20T14:00:00Z',
};

const PR_WITH_FAILED_CHECKS = {
  number: 55,
  additions: 80,
  deletions: 10,
  changedFiles: 3,
  comments: [],
  reviews: [
    { state: 'COMMENTED', author: { login: 'bot' } },
  ],
  reviewDecision: 'REVIEW_REQUIRED',
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'deploy', status: 'COMPLETED', conclusion: 'CANCELLED' },
  ],
  createdAt: '2026-02-21T08:00:00Z',
  mergedAt: null,
};

const UNMERGED_PR = {
  number: 77,
  additions: 200,
  deletions: 50,
  changedFiles: 6,
  comments: [
    { body: 'WIP' },
  ],
  reviews: [],
  reviewDecision: '',
  statusCheckRollup: [
    { name: 'build', status: 'IN_PROGRESS', conclusion: '' },
  ],
  createdAt: '2026-02-22T10:00:00Z',
  mergedAt: null,
};

const MINIMAL_PR = {
  number: 1,
};

describe('GH_PR_JSON_FIELDS', () => {
  it('contains expected fields', () => {
    expect(GH_PR_JSON_FIELDS).toContain('number');
    expect(GH_PR_JSON_FIELDS).toContain('reviews');
    expect(GH_PR_JSON_FIELDS).toContain('statusCheckRollup');
    expect(GH_PR_JSON_FIELDS).toContain('mergedAt');
  });
});

describe('buildGhCommand', () => {
  it('builds correct gh CLI command', () => {
    const cmd = buildGhCommand(42);
    expect(cmd).toContain('gh pr view 42');
    expect(cmd).toContain('--json');
    expect(cmd).toContain('number');
    expect(cmd).toContain('reviews');
    expect(cmd).toContain('statusCheckRollup');
  });

  it('includes all expected fields', () => {
    const cmd = buildGhCommand(1);
    for (const field of GH_PR_JSON_FIELDS) {
      expect(cmd).toContain(field);
    }
  });
});

describe('parsePRJson', () => {
  it('parses a clean PR', () => {
    const signal = parsePRJson(CLEAN_PR);
    expect(signal.platform).toBe('github');
    expect(signal.pr_number).toBe(42);
    expect(signal.review_cycles).toBe(1);
    expect(signal.change_request_count).toBe(0);
    expect(signal.ci_checks_passed).toBe(3);
    expect(signal.ci_checks_failed).toBe(0);
    expect(signal.file_count).toBe(8);
    expect(signal.additions).toBe(150);
    expect(signal.deletions).toBe(30);
    expect(signal.comment_count).toBe(1);
    expect(signal.review_decision).toBe('APPROVED');
  });

  it('counts review cycles and change requests', () => {
    const signal = parsePRJson(PR_WITH_REVIEW_CYCLES);
    expect(signal.review_cycles).toBe(4);
    expect(signal.change_request_count).toBe(2);
    expect(signal.comment_count).toBe(5);
    expect(signal.review_decision).toBe('APPROVED');
  });

  it('computes time to merge', () => {
    const signal = parsePRJson(CLEAN_PR);
    // 10:00 → 11:30 = 90 minutes
    expect(signal.time_to_merge_minutes).toBe(90);
  });

  it('computes multi-day time to merge', () => {
    const signal = parsePRJson(PR_WITH_REVIEW_CYCLES);
    // Feb 18 09:00 → Feb 20 14:00 = 53 hours = 3180 minutes
    expect(signal.time_to_merge_minutes).toBe(3180);
  });

  it('handles unmerged PR (null time_to_merge)', () => {
    const signal = parsePRJson(UNMERGED_PR);
    expect(signal.time_to_merge_minutes).toBeNull();
  });

  it('extracts CI check pass/fail counts', () => {
    const signal = parsePRJson(PR_WITH_FAILED_CHECKS);
    expect(signal.ci_checks_passed).toBe(1);
    expect(signal.ci_checks_failed).toBe(3); // FAILURE + FAILURE + CANCELLED
    expect(signal.review_decision).toBe('REVIEW_REQUIRED');
  });

  it('handles in-progress checks (not counted)', () => {
    const signal = parsePRJson(UNMERGED_PR);
    expect(signal.ci_checks_passed).toBe(0);
    expect(signal.ci_checks_failed).toBe(0);
  });

  it('handles minimal/empty JSON gracefully', () => {
    const signal = parsePRJson(MINIMAL_PR);
    expect(signal.platform).toBe('github');
    expect(signal.pr_number).toBe(1);
    expect(signal.review_cycles).toBe(0);
    expect(signal.change_request_count).toBe(0);
    expect(signal.time_to_merge_minutes).toBeNull();
    expect(signal.ci_checks_passed).toBe(0);
    expect(signal.ci_checks_failed).toBe(0);
    expect(signal.file_count).toBe(0);
    expect(signal.additions).toBe(0);
    expect(signal.deletions).toBe(0);
    expect(signal.comment_count).toBe(0);
    expect(signal.review_decision).toBe('NONE');
  });

  it('normalizes unknown review decision to NONE', () => {
    const signal = parsePRJson({ ...CLEAN_PR, reviewDecision: 'PENDING' });
    expect(signal.review_decision).toBe('NONE');
  });
});

describe('emptyPRSignal', () => {
  it('returns safe defaults', () => {
    const signal = emptyPRSignal();
    expect(signal.platform).toBe('unknown');
    expect(signal.pr_number).toBe(0);
    expect(signal.review_cycles).toBe(0);
    expect(signal.change_request_count).toBe(0);
    expect(signal.time_to_merge_minutes).toBeNull();
    expect(signal.ci_checks_passed).toBe(0);
    expect(signal.ci_checks_failed).toBe(0);
    expect(signal.review_decision).toBe('NONE');
  });

  it('accepts optional pr_number', () => {
    const signal = emptyPRSignal(123);
    expect(signal.pr_number).toBe(123);
  });
});
