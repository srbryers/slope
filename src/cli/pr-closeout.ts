import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectLatestSprint } from '../core/index.js';
import { loadConfig } from './config.js';
import { loadPrReviewState } from './pr-review-state.js';
import { isActiveSprintState, loadSprintState } from './sprint-state.js';

export interface PrCloseoutPolicy {
  commitWarnAt: number;
  fileWarnAt: number;
}

export interface BranchSize {
  base?: string;
  commits?: number;
  files?: number;
}

export interface PrMetadata {
  number: number;
  url?: string;
  state?: string;
  baseRefName?: string;
  headRefName?: string;
  headRefOid?: string;
  mergeStateStatus?: string;
  mergeable?: string;
  reviewDecision?: string;
  statusCheckRollup?: unknown[];
}

export type PrCheckStatus = 'unknown' | 'pending' | 'failing' | 'passing';
export type PrReviewThreadStatus = 'unknown' | 'pending' | 'settled';
export type PrReviewerBotStatus = 'unknown' | 'pending' | 'settled';
export type PrCloseoutSettlementStatus = 'missing' | 'pending' | 'settled';

export interface PrCloseoutStatus {
  sprint?: number;
  branch?: string;
  scorecardPath?: string;
  scorecardExists: boolean;
  sprintReviewPath?: string;
  sprintReviewExists: boolean;
  unpushedCommits?: number;
  pr: PrMetadata | null;
  prReview: 'missing' | 'pending' | 'reviewed';
  prChecks: PrCheckStatus;
  reviewerBot: PrReviewerBotStatus;
  reviewerBotReason?: string;
  prReviewThreads: PrReviewThreadStatus;
  unresolvedReviewThreads?: number;
  closeoutSettlement: PrCloseoutSettlementStatus;
  branchSize: BranchSize;
  branchSizeWarnings: string[];
  blockers: string[];
  warnings: string[];
}

export function closeoutPolicy(cwd: string): PrCloseoutPolicy {
  const guidance = loadConfig(cwd).guidance;
  return {
    commitWarnAt: positiveInt(guidance?.prCommitWarnAt, 50),
    fileWarnAt: positiveInt(guidance?.prFileWarnAt, 100),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function branchSizeWarnings(size: BranchSize, policy: PrCloseoutPolicy): string[] {
  const warnings: string[] = [];
  if (typeof size.commits === 'number' && size.commits > policy.commitWarnAt) {
    warnings.push(`Branch has ${size.commits} commits, above closeout warning threshold ${policy.commitWarnAt}.`);
  }
  if (typeof size.files === 'number' && size.files > policy.fileWarnAt) {
    warnings.push(`Branch changes ${size.files} files, above closeout warning threshold ${policy.fileWarnAt}.`);
  }
  return warnings;
}

export function buildPrCloseoutStatus(cwd: string, opts: { sprint?: number; pr?: number } = {}): PrCloseoutStatus {
  const config = loadConfig(cwd);
  const policy = closeoutPolicy(cwd);
  const sprint = opts.sprint ?? inferSprint(cwd);
  const branch = currentBranch(cwd);
  const pr = currentPr(opts.pr);
  const base = pr?.baseRefName ? `origin/${pr.baseRefName}` : inferBaseRef(cwd);
  const branchSize = collectBranchSize(cwd, base);
  const prReview = resolvePrReviewStatus(cwd, { pr: pr?.number, sprint, branch });
  const closeoutSettlement = resolvePrCloseoutSettlement(cwd, { pr: pr?.number, sprint, branch });
  const prChecks = resolvePrChecks(pr);
  const reviewerBot = resolveReviewerBotStatus(pr);
  const reviewThreads = resolvePrReviewThreads(pr);

  const scorecardPath = sprint
    ? join(cwd, config.scorecardDir, config.scorecardPattern.replaceAll('*', String(sprint)))
    : undefined;
  const sprintReviewPath = sprint
    ? join(cwd, config.scorecardDir, `sprint-${sprint}-review.md`)
    : undefined;

  const status: PrCloseoutStatus = {
    sprint,
    branch,
    scorecardPath,
    scorecardExists: scorecardPath ? existsSync(scorecardPath) : false,
    sprintReviewPath,
    sprintReviewExists: sprintReviewPath ? existsSync(sprintReviewPath) : false,
    unpushedCommits: countUnpushedCommits(cwd),
    pr,
    prReview,
    prChecks,
    reviewerBot: reviewerBot.status,
    reviewerBotReason: reviewerBot.reason,
    prReviewThreads: reviewThreads.status,
    unresolvedReviewThreads: reviewThreads.unresolved,
    closeoutSettlement,
    branchSize,
    branchSizeWarnings: branchSizeWarnings(branchSize, policy),
    blockers: [],
    warnings: [],
  };

  if (!status.sprint) status.warnings.push('No sprint could be inferred; pass --sprint=N for scorecard/review checks.');
  if (status.sprint && !status.scorecardExists) status.blockers.push(`Sprint S${status.sprint} scorecard is missing.`);
  if (status.sprint && !status.sprintReviewExists) status.blockers.push(`Sprint S${status.sprint} retrospective review markdown is missing.`);
  if (typeof status.unpushedCommits === 'number' && status.unpushedCommits > 0) {
    status.blockers.push(`Branch has ${status.unpushedCommits} unpushed commit${status.unpushedCommits === 1 ? '' : 's'}.`);
  }
  if (!status.pr) status.blockers.push('No open PR found for the current branch.');
  if (status.prReview !== 'reviewed') {
    status.blockers.push(status.prReview === 'pending'
      ? 'PR review is pending; run slope pr review.'
      : 'No PR implementation review record found; run slope pr review.');
  }
  if (status.pr) {
    if (status.prChecks === 'pending') status.blockers.push('PR checks are still pending; wait for GitHub checks to finish.');
    if (status.prChecks === 'failing') status.blockers.push('PR checks are failing; fix failing checks before closeout.');
    if (status.prChecks === 'unknown') status.warnings.push('Could not determine PR check status from GitHub.');
    if (status.reviewerBot === 'pending') {
      status.blockers.push(status.reviewerBotReason ?? 'Reviewer bot has not completed its PR review.');
    }
    if (status.reviewerBot === 'unknown') {
      status.blockers.push(status.reviewerBotReason ?? 'Could not determine reviewer bot status from GitHub comments.');
    }
    if (status.pr.reviewDecision === 'CHANGES_REQUESTED') status.blockers.push('PR has requested changes; address review feedback before closeout.');
    if (status.prReviewThreads === 'pending') {
      const count = status.unresolvedReviewThreads ?? 0;
      status.blockers.push(`${count} unresolved PR review thread${count === 1 ? '' : 's'} remain; address or resolve review feedback before closeout.`);
    }
    if (status.prReviewThreads === 'unknown') status.warnings.push('Could not determine unresolved PR review thread status from GitHub.');
  }
  status.warnings.push(...status.branchSizeWarnings);
  return status;
}

export function canSettlePrCloseout(status: PrCloseoutStatus): boolean {
  return Boolean(
    status.pr
      && status.prReview === 'reviewed'
      && status.prChecks === 'passing'
      && status.reviewerBot === 'settled'
      && status.prReviewThreads === 'settled'
      && status.pr.reviewDecision !== 'CHANGES_REQUESTED'
      && status.blockers.length === 0,
  );
}

export function formatPrCloseoutStatus(status: PrCloseoutStatus): string {
  const lines = [
    '',
    'PR closeout status',
    '══════════════════',
    `Sprint:          ${status.sprint ? `S${status.sprint}` : 'unknown'}`,
    `Branch:          ${status.branch ?? 'unknown'}`,
    `Scorecard:       ${status.scorecardExists ? 'ok' : 'missing'}${status.scorecardPath ? ` (${status.scorecardPath})` : ''}`,
    `Sprint review:   ${status.sprintReviewExists ? 'ok' : 'missing'}${status.sprintReviewPath ? ` (${status.sprintReviewPath})` : ''}`,
    `Push state:      ${formatPushState(status.unpushedCommits)}`,
    `PR:              ${status.pr ? `#${status.pr.number}${status.pr.state ? ` ${status.pr.state}` : ''}${status.pr.url ? ` ${status.pr.url}` : ''}` : 'missing'}`,
    `PR review:       ${status.prReview}`,
    `PR checks:       ${status.prChecks}`,
    `Reviewer bot:    ${formatReviewerBotStatus(status)}`,
    `Review threads:  ${formatReviewThreadStatus(status)}`,
    `Review decision: ${status.pr?.reviewDecision ?? 'unknown'}`,
    `Closeout:        ${status.closeoutSettlement}`,
    `Branch size:     ${formatBranchSize(status.branchSize)}`,
  ];

  if (status.blockers.length > 0) {
    lines.push('', 'Blockers:', ...status.blockers.map(item => `  - ${item}`));
  }
  if (status.warnings.length > 0) {
    lines.push('', 'Warnings:', ...status.warnings.map(item => `  - ${item}`));
  }
  lines.push('', status.blockers.length === 0 ? 'Ready for PR closeout.' : 'Not ready for PR closeout.');
  return lines.join('\n');
}

function formatPushState(unpushed: number | undefined): string {
  if (typeof unpushed !== 'number') return 'unknown';
  return unpushed === 0 ? 'ok' : `${unpushed} unpushed`;
}

function formatReviewThreadStatus(status: PrCloseoutStatus): string {
  if (status.prReviewThreads !== 'pending') return status.prReviewThreads;
  const count = status.unresolvedReviewThreads ?? 0;
  return `${status.prReviewThreads} (${count} unresolved)`;
}

function formatReviewerBotStatus(status: PrCloseoutStatus): string {
  if (status.reviewerBot !== 'pending' || !status.reviewerBotReason) return status.reviewerBot;
  return `${status.reviewerBot} (${status.reviewerBotReason})`;
}

function formatBranchSize(size: BranchSize): string {
  const commits = typeof size.commits === 'number' ? `${size.commits} commit${size.commits === 1 ? '' : 's'}` : 'unknown commits';
  const files = typeof size.files === 'number' ? `${size.files} file${size.files === 1 ? '' : 's'}` : 'unknown files';
  return `${commits}, ${files}${size.base ? ` vs ${size.base}` : ''}`;
}

function inferSprint(cwd: string): number | undefined {
  const state = loadSprintState(cwd);
  if (isActiveSprintState(state)) return state.sprint;
  const config = loadConfig(cwd);
  return config.currentSprint ?? (detectLatestSprint(config, cwd) || undefined);
}

function currentBranch(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function currentPr(prNumber?: number): PrMetadata | null {
  try {
    const args = [
      'pr',
      'view',
      ...(prNumber ? [String(prNumber)] : []),
      '--json',
      'number,url,state,baseRefName,headRefName,headRefOid,mergeStateStatus,mergeable,reviewDecision,statusCheckRollup',
    ];
    const raw = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = JSON.parse(raw) as PrMetadata;
    return typeof parsed.number === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function resolvePrChecks(pr: PrMetadata | null): PrCheckStatus {
  if (!pr) return 'unknown';
  const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : undefined;
  if (!rollup) return 'unknown';
  if (rollup.length === 0) return 'passing';

  let hasPending = false;
  let hasFailing = false;
  for (const item of rollup) {
    const check = item as {
      __typename?: string;
      status?: string;
      conclusion?: string;
      state?: string;
    };

    if (check.__typename === 'StatusContext') {
      if (check.state === 'PENDING') hasPending = true;
      else if (check.state && check.state !== 'SUCCESS') hasFailing = true;
      continue;
    }

    if (check.status && check.status !== 'COMPLETED') {
      hasPending = true;
      continue;
    }
    if (check.conclusion && !['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion)) {
      hasFailing = true;
    }
  }

  if (hasFailing) return 'failing';
  if (hasPending) return 'pending';
  return 'passing';
}

interface GitHubComment {
  body?: string;
  created_at?: string;
  updated_at?: string;
  user?: {
    login?: string;
  };
}

interface GitHubReview {
  body?: string;
  commit_id?: string;
  submitted_at?: string;
  user?: {
    login?: string;
  };
}

function resolveReviewerBotStatus(pr: PrMetadata | null): { status: PrReviewerBotStatus; reason?: string } {
  if (!pr?.url) return { status: 'unknown' };
  const repo = parseGitHubRepo(pr.url);
  if (!repo) return { status: 'unknown' };
  if (!hasCodeRabbitSignal(pr)) return { status: 'settled' };

  try {
    const commentsRaw = execFileSync('gh', [
      'api',
      '--method',
      'GET',
      `repos/${repo.owner}/${repo.repo}/issues/${pr.number}/comments`,
      '-F',
      'per_page=100',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const reviewsRaw = execFileSync('gh', [
      'api',
      '--method',
      'GET',
      `repos/${repo.owner}/${repo.repo}/pulls/${pr.number}/reviews`,
      '-F',
      'per_page=100',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const comments = JSON.parse(commentsRaw) as GitHubComment[];
    const reviews = JSON.parse(reviewsRaw) as GitHubReview[];
    if (!Array.isArray(comments) || !Array.isArray(reviews)) return { status: 'unknown' };

    const blockedAt = latestTimestamp(comments
      .filter(isBlockedCodeRabbitComment)
      .map(comment => comment.updated_at ?? comment.created_at));
    const processingAt = latestTimestamp(comments
      .filter(isProcessingCodeRabbitComment)
      .map(comment => comment.updated_at ?? comment.created_at));
    const reviewedAt = latestTimestamp(reviews
      .filter(review => isCurrentCodeRabbitReview(review, pr.headRefOid))
      .map(review => review.submitted_at));

    const latestNonSettledAt = Math.max(blockedAt ?? 0, processingAt ?? 0);
    if (reviewedAt && reviewedAt > latestNonSettledAt) return { status: 'settled' };
    if (!blockedAt && !processingAt && hasSuccessfulCodeRabbitStatus(pr)) return { status: 'settled' };

    if (processingAt && (!reviewedAt || processingAt >= reviewedAt)) return {
      status: 'pending',
      reason: 'CodeRabbit review is still in progress.',
    };

    if (blockedAt && (!reviewedAt || blockedAt >= reviewedAt)) return {
      status: 'pending',
      reason: 'CodeRabbit reported a review limit or credit block; retrigger reviewer bot review before closeout.',
    };

    return {
      status: 'unknown',
      reason: 'Could not confirm reviewer bot review for the current PR head.',
    };
  } catch {
    return { status: 'unknown' };
  }
}

function hasCodeRabbitSignal(pr: PrMetadata): boolean {
  const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  return rollup.some(item => {
    const check = item as { name?: string; context?: string };
    return isCodeRabbitLogin(check.name) || isCodeRabbitLogin(check.context);
  });
}

export function hasSuccessfulCodeRabbitStatus(pr: Pick<PrMetadata, 'statusCheckRollup'>): boolean {
  const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  return rollup.some(item => {
    const check = item as {
      __typename?: string;
      name?: string;
      context?: string;
      status?: string;
      conclusion?: string;
      state?: string;
    };
    if (!isCodeRabbitLogin(check.name) && !isCodeRabbitLogin(check.context)) return false;
    if (check.__typename === 'StatusContext') return check.state === 'SUCCESS';
    return check.status === 'COMPLETED' && ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion ?? '');
  });
}

export function isBlockedCodeRabbitComment(comment: GitHubComment): boolean {
  if (!isCodeRabbitLogin(comment.user?.login)) return false;
  const body = comment.body ?? '';
  return /review limit reached/i.test(body)
    || /couldn'?t start this review/i.test(body)
    || /run out of usage credits/i.test(body)
    || /more reviews will be available/i.test(body);
}

function isProcessingCodeRabbitComment(comment: GitHubComment): boolean {
  if (!isCodeRabbitLogin(comment.user?.login)) return false;
  const body = comment.body ?? '';
  return /review in progress by coderabbit\.ai/i.test(body)
    || /currently processing new changes/i.test(body);
}

function isCurrentCodeRabbitReview(review: GitHubReview, headRefOid: string | undefined): boolean {
  if (!isCodeRabbitLogin(review.user?.login)) return false;
  if (!headRefOid) return false;
  return review.commit_id === headRefOid;
}

function isCodeRabbitLogin(value: string | undefined): boolean {
  return Boolean(value && /coderabbit/i.test(value));
}

function latestTimestamp(values: Array<string | undefined>): number | undefined {
  const timestamps = values
    .map(value => value ? Date.parse(value) : Number.NaN)
    .filter(value => Number.isFinite(value));
  if (timestamps.length === 0) return undefined;
  return Math.max(...timestamps);
}

function resolvePrReviewThreads(pr: PrMetadata | null): { status: PrReviewThreadStatus; unresolved?: number } {
  if (!pr?.url) return { status: 'unknown' };
  const repo = parseGitHubRepo(pr.url);
  if (!repo) return { status: 'unknown' };

  try {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                isOutdated
              }
            }
          }
        }
      }
    `;
    const raw = execFileSync('gh', [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${repo.owner}`,
      '-F',
      `repo=${repo.repo}`,
      '-F',
      `number=${pr.number}`,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(raw) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: Array<{ isResolved?: boolean; isOutdated?: boolean }>;
            };
          };
        };
      };
    };
    const nodes = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!Array.isArray(nodes)) return { status: 'unknown' };
    const unresolved = nodes.filter(node => !node.isResolved && !node.isOutdated).length;
    return unresolved > 0
      ? { status: 'pending', unresolved }
      : { status: 'settled', unresolved: 0 };
  } catch {
    return { status: 'unknown' };
  }
}

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function countUnpushedCommits(cwd: string): number | undefined {
  try {
    execFileSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    const raw = execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return Number.parseInt(raw, 10);
  } catch {
    return undefined;
  }
}

function inferBaseRef(cwd: string): string | undefined {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
      return ref;
    } catch { /* try next */ }
  }
  return undefined;
}

function collectBranchSize(cwd: string, base: string | undefined): BranchSize {
  if (!base) return {};
  const size: BranchSize = { base };
  try {
    const raw = execFileSync('git', ['rev-list', '--count', `${base}..HEAD`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    size.commits = Number.parseInt(raw, 10);
  } catch { /* best-effort */ }
  try {
    const raw = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    size.files = raw ? raw.split('\n').filter(Boolean).length : 0;
  } catch { /* best-effort */ }
  return size;
}

function resolvePrReviewStatus(cwd: string, input: { pr?: number; sprint?: number; branch?: string }): 'missing' | 'pending' | 'reviewed' {
  const matching = matchingPrReviews(cwd, input);
  if (matching.some(review => review.status === 'reviewed')) return 'reviewed';
  if (matching.some(review => review.status === 'pending')) return 'pending';
  return 'missing';
}

function resolvePrCloseoutSettlement(cwd: string, input: { pr?: number; sprint?: number; branch?: string }): PrCloseoutSettlementStatus {
  const matching = matchingPrReviews(cwd, input);
  if (matching.some(review => review.closeout_status === 'settled')) return 'settled';
  if (matching.length > 0) return 'pending';
  return 'missing';
}

function matchingPrReviews(cwd: string, input: { pr?: number; sprint?: number; branch?: string }) {
  const reviews = loadPrReviewState(cwd).reviews;
  return reviews.filter(review =>
    (input.pr != null && review.pr === input.pr)
    || (input.sprint != null && review.sprint === input.sprint)
    || (input.branch != null && review.branch === input.branch),
  );
}
