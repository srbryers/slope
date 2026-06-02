import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPrReviewState,
  pendingPrCloseouts,
  pendingPrReviews,
  recordPrCloseoutSettled,
  recordPrReviewComplete,
  recordPrReviewPending,
} from '../../src/cli/pr-review-state.js';

describe('pr review state', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'slope-pr-review-state-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('records pending PR reviews and marks them reviewed', () => {
    recordPrReviewPending(cwd, { pr: 42, sprint: 100, branch: 'fix/test' });

    expect(pendingPrReviews(cwd, 100).map(review => review.pr)).toEqual([42]);

    recordPrReviewComplete(cwd, { pr: 42, sprint: 100, reviewType: 'both' });
    const state = loadPrReviewState(cwd);

    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0].status).toBe('reviewed');
    expect(state.reviews[0].closeout_status).toBe('pending');
    expect(state.reviews[0].reviewed_at).toBeDefined();
    expect(pendingPrReviews(cwd, 100)).toEqual([]);
    expect(pendingPrCloseouts(cwd, 100).map(review => review.pr)).toEqual([42]);
  });

  it('marks closeout settlement separately from review completion', () => {
    recordPrReviewPending(cwd, { pr: 42, sprint: 100, branch: 'fix/test' });
    recordPrReviewComplete(cwd, { pr: 42, sprint: 100, reviewType: 'both' });
    recordPrCloseoutSettled(cwd, { pr: 42, sprint: 100, branch: 'fix/test' });

    const state = loadPrReviewState(cwd);
    expect(state.reviews[0].status).toBe('reviewed');
    expect(state.reviews[0].closeout_status).toBe('settled');
    expect(state.reviews[0].closeout_settled_at).toBeDefined();
    expect(pendingPrCloseouts(cwd, 100)).toEqual([]);
  });

  it('does not treat legacy reviewed records without closeout status as pending closeouts', () => {
    mkdirSync(join(cwd, '.slope'), { recursive: true });
    writeFileSync(join(cwd, '.slope', 'pr-reviews.json'), JSON.stringify({
      reviews: [{
        pr: 41,
        sprint: 100,
        status: 'reviewed',
        created_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
      }],
    }));

    expect(pendingPrCloseouts(cwd, 100)).toEqual([]);
  });

  it('does not downgrade an already reviewed PR back to pending', () => {
    recordPrReviewComplete(cwd, { pr: 42, sprint: 100, reviewType: 'both' });
    recordPrReviewPending(cwd, { pr: 42, sprint: 100, branch: 'fix/test' });

    expect(loadPrReviewState(cwd).reviews[0].status).toBe('reviewed');
  });
});
