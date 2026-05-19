import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLatestSprint, loadConfig, normalizeScorecard, recommendReviews } from '../../core/index.js';
import type { ReviewRecommendation } from '../../core/index.js';
import { reviewRunCommand } from './review-run.js';
import { recordPrReviewComplete } from '../pr-review-state.js';

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

interface PrReviewOptions {
  pr?: number;
  sprint?: number;
  type?: 'architect' | 'code' | 'both';
  json?: boolean;
}

interface PrReviewPlan {
  pr: number;
  sprint?: number;
  ticketCount: number;
  slope: number;
  changedFiles: string[];
  hasNewInfra: boolean;
  recommendations: ReviewRecommendation[];
  reviewType: 'architect' | 'code' | 'both';
}

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
  slope pr issues [--pr=N]                 Print extracted issue refs from the branch's
                                           commit messages.

Defaults:
  --pr   Resolved from current branch via \`gh pr view --json number\`.
`);
}

function parseFlags(args: string[]): FinalizeOptions {
  const opts: FinalizeOptions = {};
  for (const a of args) {
    if (a.startsWith('--pr=')) opts.pr = parseInt(a.slice('--pr='.length), 10);
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

function parseReviewFlags(args: string[]): PrReviewOptions {
  const opts: PrReviewOptions = {};
  for (const a of args) {
    if (a.startsWith('--pr=')) opts.pr = parseInt(a.slice('--pr='.length), 10);
    else if (a.startsWith('--sprint=')) opts.sprint = parseInt(a.slice('--sprint='.length), 10);
    else if (a.startsWith('--type=')) {
      const type = a.slice('--type='.length);
      if (type === 'architect' || type === 'code' || type === 'both') opts.type = type;
    } else if (a === '--json') {
      opts.json = true;
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
    return config.currentSprint ?? (detectLatestSprint(config, process.cwd()) || undefined);
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

function changedFilesForPr(pr: number): string[] {
  try {
    const raw = gh(`pr diff ${pr} --name-only`);
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch {
    return [];
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

export async function planPrReview(opts: PrReviewOptions): Promise<PrReviewPlan | null> {
  const pr = resolvePrNumber(opts);
  if (!pr) return null;

  const sprint = inferSprintNumber(opts.sprint);
  const { ticketCount, slope } = loadSprintReviewSignals(sprint);
  const changedFiles = changedFilesForPr(pr);
  const hasNewInfra = changedFiles.some(p => /(\.sql|migration|schema|infra|terraform|k8s|deploy)/i.test(p));
  const recommendations = recommendReviews({
    ticketCount,
    slope,
    filePatterns: changedFiles,
    hasNewInfra,
  });

  return {
    pr,
    sprint,
    ticketCount,
    slope,
    changedFiles,
    hasNewInfra,
    recommendations,
    reviewType: opts.type ?? defaultReviewType(recommendations),
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
  const tryRange = branch ? `origin/${base}..origin/${branch}` : `origin/${base}..HEAD`;
  let commitText = git(`log ${tryRange} --format=%B`);
  if (!commitText) {
    commitText = git(`log origin/${base}..HEAD --format=%B`);
  }

  const fromCommits = extractIssueRefs(commitText);
  const fromTitle = extractIssueRefs(meta.title ?? '');
  const fromBody = extractIssueRefs(body);

  const referenced = [...new Set([...fromCommits, ...fromTitle, ...fromBody])].sort((a, b) => a - b);
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
  const opts = parseReviewFlags(args);
  const plan = await planPrReview(opts);

  if (!plan) {
    console.error('\nCould not resolve PR — pass --pr=N or run from a branch with an open PR.\n');
    process.exit(1);
  }

  const reviewArgs = [`--pr=${plan.pr}`, `--type=${plan.reviewType}`];
  if (plan.sprint) reviewArgs.push(`--sprint=${plan.sprint}`);
  if (opts.json) {
    reviewArgs.push('--json');
    await reviewRunCommand(reviewArgs);
    recordPrReviewComplete(process.cwd(), {
      pr: plan.pr,
      sprint: plan.sprint,
      branch: currentBranch(),
      reviewType: plan.reviewType,
    });
    return;
  }

  console.log(`\nPR #${plan.pr} review workflow${plan.sprint ? ` for Sprint ${plan.sprint}` : ''}`);
  console.log(`Files changed: ${plan.changedFiles.length}`);
  console.log(`Signals: ${plan.ticketCount} ticket${plan.ticketCount !== 1 ? 's' : ''}, slope ${plan.slope}${plan.hasNewInfra ? ', infrastructure/schema paths' : ''}`);
  console.log('\nRecommended reviews:\n');
  console.log('  Type           Priority      Reason');
  console.log(formatReviewRecommendations(plan.recommendations));
  console.log('\nReview prompts:\n');

  await reviewRunCommand(reviewArgs);
  recordPrReviewComplete(process.cwd(), {
    pr: plan.pr,
    sprint: plan.sprint,
    branch: currentBranch(),
    reviewType: plan.reviewType,
  });
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
