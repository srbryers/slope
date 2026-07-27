import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLatestSprint, loadConfig, normalizeScorecard, parseSprintNumber, recommendReviews, sprintIdToNumber } from '../../core/index.js';
import type { ReviewRecommendation } from '../../core/index.js';
import { reviewRunCommand } from './review-run.js';
import {
  collectReviewDiff,
  DEFAULT_REVIEW_DIFF_BYTES,
  formatReviewDiffError,
  MAX_REVIEW_DIFF_BYTES,
  ReviewDiffError,
  type ReviewDiffResult,
  type ReviewDiffScope,
} from '../review-diff.js';
import { recordPrCloseoutSettled, recordPrReviewPromptsGenerated } from '../pr-review-state.js';
import { branchSizeWarnings, buildPrCloseoutStatus, canSettlePrCloseout, closeoutPolicy, formatPrCloseoutStatus } from '../pr-closeout.js';

/**
 * `slope pr ...` — agent-friendly PR helpers.
 *
 * Subcommands:
 *   slope pr finalize [--pr=N] [--dry-run]   Auto-add `Closes #N` lines to PR
 *                                            body for any issue refs in commit
 *                                            messages that GitHub's auto-close
 *                                            parser would otherwise miss (#321).
 *   slope pr review [--pr=N] [--sprint=N]    Run the post-PR review workflow
 *                                            for any PR creation transport.
 *   slope pr status [--pr=N] [--sprint=N]    Check sprint + PR closeout readiness.
 *   slope pr issues [--pr=N]                 Print extracted issue refs (helper).
 *
 * Background: commits like `fix: ... (GH #297, #299)` or `… closes #314` mix
 * close-able patterns with non-canonical wording. Without one of GitHub's
 * magic keywords (`Close[s|d]`, `Fix[es|ed]`, `Resolve[s|d]`) on its own line
 * adjacent to the issue number, the issue stays open even after merge — the
 * scenario surfaced in PR #317.
 */

interface FinalizeOptions {
  pr?: number;
  dryRun?: boolean;
}

export interface PrReviewOptions {
  pr?: number;
  sprint?: number;
  type?: 'architect' | 'code' | 'both';
  json?: boolean;
  paths?: string[];
  excludePaths?: string[];
  maxDiffBytes?: number;
}

export interface PrReviewPlan {
  pr: number;
  sprint?: number;
  ticketCount: number;
  slope: number;
  changedFiles: string[];
  totalChangedFiles: number;
  hasNewInfra: boolean;
  recommendations: ReviewRecommendation[];
  reviewType: 'architect' | 'code' | 'both';
  branchSizeWarnings: string[];
  reviewDiff: ReviewDiffResult;
}

export type PrReviewDiffCollector = typeof collectReviewDiff;

export async function prCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === '--help' || sub === '-h' || sub === undefined) {
    printHelp();
    return;
  }

  if (sub === 'finalize') {
    await finalizeSubcommand(args.slice(1));
    return;
  }

  if (sub === 'review') {
    await reviewSubcommand(args.slice(1));
    return;
  }

  if (sub === 'status') {
    await statusSubcommand(args.slice(1));
    return;
  }

  if (sub === 'issues') {
    await issuesSubcommand(args.slice(1));
    return;
  }

  console.error(`\nUnknown pr subcommand: ${sub}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`
slope pr — Pull request helpers

Usage:
  slope pr finalize [--pr=N] [--dry-run]   Inject Closes #N for issues referenced in commit
                                           messages but missing from PR body (#321).
  slope pr review [--pr=N] [--sprint=N]    Run review recommendation + prompt generation
                                           after PR creation, regardless of whether the
                                           PR was created by gh, MCP, or another API.
  slope pr status [--pr=N] [--sprint=N]    Check scorecard, sprint review, push state,
                                           PR existence, PR review, checks, review
                                           threads, and branch size.
  slope pr issues [--pr=N]                 Print extracted issue refs from the branch's
                                           commit messages.

Defaults:
  --pr   Resolved from current branch via \`gh pr view --json number\`.

State:
  Prompt generation records PR review as pending. Complete review rounds before PR closeout.
`);
}

function printReviewHelp(): void {
  console.log(`
slope pr review — Generate post-PR review prompts

Usage:
  slope pr review [--pr=N] [--sprint=N] [--type=architect|code|both]
                  [--path=GLOB]... [--exclude-path=GLOB]...
                  [--max-diff-bytes=N] [--json]

Options:
  --help, -h                       Show this help without resolving PR state
  --pr=N                           Review a specific pull request
  --sprint=N                       Use a specific sprint for review context
  --type=architect|code|both       Select review prompt type (default: both)
  --path=GLOB                      Include matching changed paths (repeatable)
  --exclude-path=GLOB              Exclude matching changed paths (repeatable)
  --max-diff-bytes=N               Bound patch bytes included across review prompts
  --json                           Emit machine-readable review prompts

Defaults:
  --pr   Resolved from current branch via \`gh pr view --json number\`.
`);
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function parseFlags(args: string[]): FinalizeOptions {
  const opts: FinalizeOptions = {};
  for (const a of args) {
    if (a.startsWith('--pr=')) opts.pr = parseInt(a.slice('--pr='.length), 10);
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

export function parsePrReviewFlags(args: string[]): PrReviewOptions {
  const opts: PrReviewOptions = { paths: [], excludePaths: [] };
  for (const a of args) {
    if (a.startsWith('--pr=')) {
      const value = Number(a.slice('--pr='.length));
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('--pr must be a positive integer.');
      opts.pr = value;
    } else if (a.startsWith('--sprint=')) {
      const value = parseSprintNumber(a.slice('--sprint='.length));
      if (value == null || value <= 0) throw new Error('--sprint must be a positive sprint number.');
      opts.sprint = value;
    } else if (a.startsWith('--type=')) {
      const type = a.slice('--type='.length);
      if (type !== 'architect' && type !== 'code' && type !== 'both') {
        throw new Error('--type must be architect, code, or both.');
      }
      opts.type = type;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a.startsWith('--path=')) {
      const value = a.slice('--path='.length).trim();
      if (!value) throw new Error('--path requires a non-empty glob.');
      opts.paths?.push(value);
    } else if (a.startsWith('--exclude-path=')) {
      const value = a.slice('--exclude-path='.length).trim();
      if (!value) throw new Error('--exclude-path requires a non-empty glob.');
      opts.excludePaths?.push(value);
    } else if (a.startsWith('--max-diff-bytes=')) {
      const value = Number(a.slice('--max-diff-bytes='.length));
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('--max-diff-bytes must be a positive integer.');
      if (value > MAX_REVIEW_DIFF_BYTES) {
        throw new Error(`--max-diff-bytes cannot exceed ${MAX_REVIEW_DIFF_BYTES}.`);
      }
      opts.maxDiffBytes = value;
    } else {
      throw new Error(`Unknown pr review option: ${a}`);
    }
  }
  return opts;
}

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function currentBranch(): string | undefined {
  const branch = git('branch --show-current');
  return branch || undefined;
}

function inferSprintNumber(explicit?: number): number | undefined {
  if (explicit && !isNaN(explicit)) return explicit;
  try {
    const config = loadConfig();
    const latest = detectLatestSprint(config, process.cwd());
    return config.currentSprint ?? sprintIdToNumber(latest) ?? undefined;
  } catch {
    return undefined;
  }
}

function loadSprintReviewSignals(sprint?: number): { ticketCount: number; slope: number } {
  if (!sprint) return { ticketCount: 1, slope: 1 };
  try {
    const config = loadConfig();
    const scorecardPath = join(process.cwd(), config.scorecardDir, `sprint-${sprint}.json`);
    if (!existsSync(scorecardPath)) return { ticketCount: 1, slope: 1 };
    const card = normalizeScorecard(JSON.parse(readFileSync(scorecardPath, 'utf8')));
    return {
      ticketCount: card.shots?.length ?? 1,
      slope: card.slope ?? 1,
    };
  } catch {
    return { ticketCount: 1, slope: 1 };
  }
}

export function defaultReviewType(_recommendations: ReviewRecommendation[]): 'architect' | 'code' | 'both' {
  // Keep the transport-independent command aligned with `slope review run`,
  // whose default is both. Recommendations are printed for prioritization,
  // but the baseline code review remains useful for AI-authored diffs.
  return 'both';
}

export function formatReviewRecommendations(recommendations: ReviewRecommendation[]): string {
  if (recommendations.length === 0) return '  (none)';
  return recommendations
    .map((rec) => {
      const type = rec.review_type.padEnd(14);
      const priority = rec.priority.padEnd(13);
      return `  ${type} ${priority} ${rec.reason}`;
    })
    .join('\n');
}

export async function planPrReview(
  opts: PrReviewOptions,
  collect: PrReviewDiffCollector = collectReviewDiff,
): Promise<PrReviewPlan> {
  const scope: ReviewDiffScope = {
    include: opts.paths ?? [],
    exclude: opts.excludePaths ?? [],
    maxDiffBytes: opts.maxDiffBytes ?? DEFAULT_REVIEW_DIFF_BYTES,
  };
  let reviewDiff: ReviewDiffResult;
  try {
    reviewDiff = await collect(process.cwd(), opts.pr, scope);
  } catch (error) {
    if (error instanceof ReviewDiffError) throw new Error(formatReviewDiffError(error));
    throw error;
  }

  const sprint = inferSprintNumber(opts.sprint);
  const { ticketCount, slope } = loadSprintReviewSignals(sprint);
  const changedFiles = reviewDiff.files.map(file => file.filename);
  const hasNewInfra = changedFiles.some(p => /(\.sql|migration|schema|infra|terraform|k8s|deploy)/i.test(p));
  const policy = closeoutPolicy(process.cwd());
  const recommendations = recommendReviews({
    ticketCount,
    slope,
    filePatterns: changedFiles,
    hasNewInfra,
  });

  return {
    pr: reviewDiff.prNum,
    sprint,
    ticketCount,
    slope,
    changedFiles,
    totalChangedFiles: reviewDiff.allFiles.length,
    hasNewInfra,
    recommendations,
    reviewType: opts.type ?? defaultReviewType(recommendations),
    branchSizeWarnings: branchSizeWarnings({ files: reviewDiff.allFiles.length }, policy),
    reviewDiff,
  };
}

/** Wrapper around `gh` CLI invocations. Throws a contextual error when gh
 *  is missing or auth fails so callers can surface a clear message instead
 *  of the raw spawn ENOENT / 401 stderr. */
function gh(cmd: string): string {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const msg = (err as { stderr?: Buffer | string; message?: string }).stderr?.toString().trim()
      ?? (err as Error).message
      ?? 'unknown gh error';
    if (/command not found|ENOENT/i.test(msg)) {
      throw new Error('gh CLI is not installed. Install from https://cli.github.com/');
    }
    if (/authentication required|gh auth login|HTTP 401/i.test(msg)) {
      throw new Error('gh CLI is not authenticated. Run `gh auth login` first.');
    }
    throw new Error(`gh ${cmd}: ${msg}`);
  }
}

/**
 * Resolve the PR number — explicit flag wins, otherwise ask gh which PR is
 * associated with the current branch.
 */
function resolvePrNumber(opts: FinalizeOptions): number | null {
  if (opts.pr && !isNaN(opts.pr)) return opts.pr;
  try {
    const out = gh('pr view --json number');
    const parsed = JSON.parse(out) as { number?: number };
    return parsed.number ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract all issue numbers referenced anywhere in `text`. Matches `#NNN`
 * or `(GH #NNN)` or `gh-NNN` regardless of surrounding wording. Returns
 * unique sorted ascending integers.
 */
/**
 * Conventional-commit types that assert the change *fixes* something. A commit
 * that documents, plans or triages an issue references it without resolving it.
 */
const FIX_INTENT_COMMIT_TYPES = /^(?:feat|fix|perf|refactor)(?:\([^)]*\))?!?:/i;

/** Record separator used to split `git log --format=%x1eBODY`. */
export const COMMIT_RECORD_SEPARATOR = '\x1e';

/**
 * Extract issue refs only from commits that claim to fix something.
 *
 * `slope pr finalize` previously swept every `#N` out of the concatenated commit
 * text. On PR #622 that included a roadmap-triage commit which merely *planned*
 * sprints for six issues, so merging would have auto-closed all six with no fix
 * shipped (GH #623). Intent lives in the conventional-commit type, so classify
 * per commit and ignore docs/chore/test/style entirely.
 */
export function extractFixIntentIssueRefs(commitText: string): number[] {
  const found = new Set<number>();
  for (const record of commitText.split(COMMIT_RECORD_SEPARATOR)) {
    const commit = record.trim();
    if (!commit) continue;
    const subject = commit.split(/\r?\n/, 1)[0]?.trim() ?? '';
    // "Merge pull request #613 from ..." carries a *PR* number, not an issue, and
    // a revert un-fixes whatever it names. Neither should close anything.
    if (/^(?:merge|revert)\b/i.test(subject)) continue;
    // Untyped subjects (plain squash subjects like "Fix thing (#123)") stay
    // eligible; only an explicit non-fix type disqualifies a commit.
    if (/^[a-z]+(?:\([^)]*\))?!?:/i.test(subject) && !FIX_INTENT_COMMIT_TYPES.test(subject)) continue;
    for (const ref of extractIssueRefs(commit)) found.add(ref);
  }
  return [...found].sort((a, b) => a - b);
}

export function extractIssueRefs(text: string): number[] {
  const found = new Set<number>();
  // Lookbehind avoids in-word matches like `abc#1234` (commit-SHA-style refs).
  const re = /(?<![A-Za-z0-9])#(\d{1,6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Identify issues that GitHub will already auto-close from a PR body —
 * that is, ones already on a `Close[s|d]/Fix[es|ed]/Resolve[s|d] #N` form.
 * Returns them as a Set so callers can subtract.
 */
export function existingAutoCloseRefs(prBody: string): Set<number> {
  const found = new Set<number>();
  // Match the canonical magic keywords (case-insensitive) followed by #N.
  // Multiple targets per keyword: "Closes #1, #2, #3"
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[^.\n]*?#(\d{1,6})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prBody)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 0) found.add(n);
  }
  return found;
}

interface FinalizeResult {
  pr: number;
  branch: string;
  found: number[];
  alreadyClosed: number[];
  toAdd: number[];
  newBodyAppendix: string | null;
  applied: boolean;
}

/**
 * Compute the finalize plan without applying it. Pure-ish (only reads
 * git/gh state). Test-friendly.
 */
export async function planPrFinalize(opts: FinalizeOptions): Promise<FinalizeResult | null> {
  const pr = resolvePrNumber(opts);
  if (!pr) return null;

  let metaJson: string;
  try {
    metaJson = gh(`pr view ${pr} --json baseRefName,headRefName,body,title`);
  } catch {
    return null;
  }
  const meta = JSON.parse(metaJson) as {
    baseRefName?: string;
    headRefName?: string;
    body?: string;
    title?: string;
  };

  const base = meta.baseRefName ?? 'main';
  const branch = meta.headRefName ?? '';
  const body = meta.body ?? '';

  // Pull commit messages from the branch (commits not yet on base).
  // Try origin/<branch>..origin/<base> first; fall back to origin/<base>..HEAD
  // when the branch doesn't have a remote (or the remote ref is stale). The
  // previous version embedded a `||` shell fallback inside the git() arg
  // string which obscured the failure mode.
  // %x1e delimits commits so intent can be judged per commit rather than across
  // the concatenated text (GH #623).
  const tryRange = branch ? `origin/${base}..origin/${branch}` : `origin/${base}..HEAD`;
  let commitText = git(`log ${tryRange} --format=%x1e%B`);
  if (!commitText) {
    commitText = git(`log origin/${base}..HEAD --format=%x1e%B`);
  }

  const fromCommits = extractFixIntentIssueRefs(commitText);
  const fromTitle = extractIssueRefs(meta.title ?? '');

  // The PR body is deliberately not swept: a bare "#N" there is a reference, not
  // a declaration that this PR fixes it. Explicit Closes/Fixes lines already in
  // the body are picked up by existingAutoCloseRefs and excluded below.
  const referenced = [...new Set([...fromCommits, ...fromTitle])].sort((a, b) => a - b);
  const alreadyClosed = existingAutoCloseRefs(body);
  const toAdd = referenced.filter(n => !alreadyClosed.has(n));

  const appendix = toAdd.length > 0
    ? `\n\n` + toAdd.map(n => `Closes #${n}.`).join('\n') + '\n'
    : null;

  return {
    pr,
    branch,
    found: referenced,
    alreadyClosed: [...alreadyClosed].sort((a, b) => a - b),
    toAdd,
    newBodyAppendix: appendix,
    applied: false,
  };
}

async function finalizeSubcommand(args: string[]): Promise<void> {
  const opts = parseFlags(args);
  const plan = await planPrFinalize(opts);

  if (!plan) {
    console.error('\nCould not resolve PR — pass --pr=N or run from a branch with an open PR.\n');
    process.exit(1);
  }

  console.log(`\nPR #${plan.pr} (${plan.branch || 'current branch'}):`);
  console.log(`  Issues referenced:    ${plan.found.length === 0 ? '(none)' : plan.found.map(n => `#${n}`).join(', ')}`);
  console.log(`  Already auto-closes:  ${plan.alreadyClosed.length === 0 ? '(none)' : plan.alreadyClosed.map(n => `#${n}`).join(', ')}`);
  console.log(`  Will add Closes for:  ${plan.toAdd.length === 0 ? '(none)' : plan.toAdd.map(n => `#${n}`).join(', ')}`);

  if (plan.toAdd.length === 0) {
    console.log('\n  Nothing to update — PR already references all matching issues with auto-close keywords.\n');
    return;
  }

  if (opts.dryRun) {
    console.log('\n  [dry-run] Appendix that would be added:\n');
    console.log(plan.newBodyAppendix);
    return;
  }

  // Apply: edit PR body via gh
  const currentBody = gh(`pr view ${plan.pr} --json body --jq .body`);
  const newBody = currentBody + (plan.newBodyAppendix ?? '');
  // gh expects the body via --body — pass through stdin to avoid shell quoting hazards
  execSync(`gh pr edit ${plan.pr} --body-file -`, { input: newBody, encoding: 'utf8' });
  console.log(`\n  Updated PR #${plan.pr} body with ${plan.toAdd.length} Closes line(s).\n`);
}

async function reviewSubcommand(args: string[]): Promise<void> {
  // Help must be read-only. Agents probe subcommand syntax with --help, so do
  // not infer PRs, read diffs, or record review state on help flags. (GH #405)
  if (hasHelpFlag(args)) {
    printReviewHelp();
    return;
  }

  const opts = parsePrReviewFlags(args);
  const plan = await planPrReview(opts);

  if (!plan) {
    console.error('\nCould not resolve PR — pass --pr=N or run from a branch with an open PR.\n');
    process.exit(1);
  }

  const reviewArgs = [`--pr=${plan.pr}`, `--type=${plan.reviewType}`];
  if (plan.sprint) reviewArgs.push(`--sprint=${plan.sprint}`);
  for (const path of opts.paths ?? []) reviewArgs.push(`--path=${path}`);
  for (const path of opts.excludePaths ?? []) reviewArgs.push(`--exclude-path=${path}`);
  if (opts.maxDiffBytes != null) reviewArgs.push(`--max-diff-bytes=${opts.maxDiffBytes}`);
  if (opts.json) {
    reviewArgs.push('--json');
    await reviewRunCommand(reviewArgs, plan.reviewDiff);
    recordPrReviewPromptsGenerated(process.cwd(), {
      pr: plan.pr,
      sprint: plan.sprint,
      branch: currentBranch(),
      reviewType: plan.reviewType,
    });
    return;
  }

  console.log(`\nPR #${plan.pr} review workflow${plan.sprint ? ` for Sprint ${plan.sprint}` : ''}`);
  console.log(`Files selected: ${plan.changedFiles.length}/${plan.totalChangedFiles}`);
  console.log(`Signals: ${plan.ticketCount} ticket${plan.ticketCount !== 1 ? 's' : ''}, slope ${plan.slope}${plan.hasNewInfra ? ', infrastructure/schema paths' : ''}`);
  if (plan.branchSizeWarnings.length > 0) {
    console.log('\nBranch size warnings:\n');
    for (const warning of plan.branchSizeWarnings) console.log(`  - ${warning}`);
  }
  console.log('\nRecommended reviews:\n');
  console.log('  Type           Priority      Reason');
  console.log(formatReviewRecommendations(plan.recommendations));
  console.log('\nReview prompts:\n');

  await reviewRunCommand(reviewArgs, plan.reviewDiff);
  recordPrReviewPromptsGenerated(process.cwd(), {
    pr: plan.pr,
    sprint: plan.sprint,
    branch: currentBranch(),
    reviewType: plan.reviewType,
  });
}

async function statusSubcommand(args: string[]): Promise<void> {
  const opts = parsePrReviewFlags(args);
  const status = buildPrCloseoutStatus(process.cwd(), { pr: opts.pr, sprint: opts.sprint });
  console.log(formatPrCloseoutStatus(status));
  if (canSettlePrCloseout(status) && status.closeoutSettlement !== 'settled' && status.pr) {
    recordPrCloseoutSettled(process.cwd(), {
      pr: status.pr.number,
      sprint: status.sprint,
      branch: status.branch,
    });
    console.log('\nPR closeout settlement recorded.');
  }
  if (status.blockers.length > 0) process.exitCode = 1;
}

async function issuesSubcommand(args: string[]): Promise<void> {
  const opts = parseFlags(args);
  const plan = await planPrFinalize(opts);
  if (!plan) {
    console.error('Could not resolve PR — pass --pr=N or run from a branch with an open PR.');
    process.exit(1);
  }
  if (plan.found.length === 0) {
    console.log('No issue refs found in commit messages or PR body.');
    return;
  }
  for (const n of plan.found) {
    const auto = plan.alreadyClosed.includes(n);
    console.log(`#${n}\t${auto ? 'auto-closes' : 'open'}`);
  }
}
