import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PR_REVIEW_STATE_FILE = '.slope/pr-reviews.json';

export interface PrReviewRecord {
  pr: number;
  sprint?: number;
  branch?: string;
  status: 'pending' | 'reviewed';
  created_at: string;
  reviewed_at?: string;
  review_type?: 'architect' | 'code' | 'both';
}

export interface PrReviewState {
  reviews: PrReviewRecord[];
}

export function loadPrReviewState(cwd: string): PrReviewState {
  const filePath = join(cwd, PR_REVIEW_STATE_FILE);
  if (!existsSync(filePath)) return { reviews: [] };
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { reviews?: unknown };
    if (!Array.isArray(raw.reviews)) return { reviews: [] };
    return {
      reviews: raw.reviews.filter(isPrReviewRecord),
    };
  } catch {
    return { reviews: [] };
  }
}

function isPrReviewRecord(value: unknown): value is PrReviewRecord {
  const record = value as Partial<PrReviewRecord>;
  return Boolean(
    record
      && typeof record.pr === 'number'
      && (record.status === 'pending' || record.status === 'reviewed')
      && typeof record.created_at === 'string',
  );
}

function savePrReviewState(cwd: string, state: PrReviewState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  const filePath = join(cwd, PR_REVIEW_STATE_FILE);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmpPath, filePath);
}

export function recordPrReviewPending(cwd: string, input: { pr: number; sprint?: number; branch?: string }): void {
  const state = loadPrReviewState(cwd);
  const now = new Date().toISOString();
  const existing = state.reviews.find(review => review.pr === input.pr);

  if (existing) {
    existing.sprint = input.sprint ?? existing.sprint;
    existing.branch = input.branch ?? existing.branch;
    if (existing.status !== 'reviewed') existing.status = 'pending';
  } else {
    state.reviews.push({
      pr: input.pr,
      sprint: input.sprint,
      branch: input.branch,
      status: 'pending',
      created_at: now,
    });
  }

  savePrReviewState(cwd, state);
}

export function recordPrReviewComplete(
  cwd: string,
  input: { pr: number; sprint?: number; branch?: string; reviewType?: 'architect' | 'code' | 'both' },
): void {
  const state = loadPrReviewState(cwd);
  const now = new Date().toISOString();
  const existing = state.reviews.find(review => review.pr === input.pr);

  if (existing) {
    existing.sprint = input.sprint ?? existing.sprint;
    existing.branch = input.branch ?? existing.branch;
    existing.status = 'reviewed';
    existing.reviewed_at = now;
    existing.review_type = input.reviewType ?? existing.review_type;
  } else {
    state.reviews.push({
      pr: input.pr,
      sprint: input.sprint,
      branch: input.branch,
      status: 'reviewed',
      created_at: now,
      reviewed_at: now,
      review_type: input.reviewType,
    });
  }

  savePrReviewState(cwd, state);
}

export function pendingPrReviews(cwd: string, sprint?: number): PrReviewRecord[] {
  return loadPrReviewState(cwd).reviews
    .filter(review => review.status === 'pending')
    .filter(review => sprint == null || review.sprint == null || review.sprint === sprint)
    .sort((a, b) => b.pr - a.pr);
}
