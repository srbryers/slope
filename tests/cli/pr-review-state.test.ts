import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPrReviewState,
  pendingPrReviews,
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
    expect(state.reviews[0].reviewed_at).toBeDefined();
    expect(pendingPrReviews(cwd, 100)).toEqual([]);
  });

  it('does not downgrade an already reviewed PR back to pending', () => {
    recordPrReviewComplete(cwd, { pr: 42, sprint: 100, reviewType: 'both' });
    recordPrReviewPending(cwd, { pr: 42, sprint: 100, branch: 'fix/test' });

    expect(loadPrReviewState(cwd).reviews[0].status).toBe('reviewed');
  });
});
