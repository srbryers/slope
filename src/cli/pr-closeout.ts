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
}

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

export function buildPrCloseoutStatus(cwd: string, opts: { sprint?: number } = {}): PrCloseoutStatus {
  const config = loadConfig(cwd);
  const policy = closeoutPolicy(cwd);
  const sprint = opts.sprint ?? inferSprint(cwd);
  const branch = currentBranch(cwd);
  const pr = currentPr();
  const base = pr?.baseRefName ? `origin/${pr.baseRefName}` : inferBaseRef(cwd);
  const branchSize = collectBranchSize(cwd, base);
  const prReview = resolvePrReviewStatus(cwd, { pr: pr?.number, sprint, branch });

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
  status.warnings.push(...status.branchSizeWarnings);
  return status;
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

function currentPr(): PrMetadata | null {
  try {
    const raw = execFileSync('gh', ['pr', 'view', '--json', 'number,url,state,baseRefName,headRefName'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = JSON.parse(raw) as PrMetadata;
    return typeof parsed.number === 'number' ? parsed : null;
  } catch {
    return null;
  }
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
  const reviews = loadPrReviewState(cwd).reviews;
  const matching = reviews.filter(review =>
    (input.pr != null && review.pr === input.pr)
    || (input.sprint != null && review.sprint === input.sprint)
    || (input.branch != null && review.branch === input.branch),
  );
  if (matching.some(review => review.status === 'reviewed')) return 'reviewed';
  if (matching.some(review => review.status === 'pending')) return 'pending';
  return 'missing';
}
