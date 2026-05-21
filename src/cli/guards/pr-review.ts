import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { recommendReviews } from '../../core/review.js';
import type { ReviewRecommendation } from '../../core/index.js';
import { recordPrReviewPending } from '../pr-review-state.js';
import { isActiveSprintState, loadSprintState } from '../sprint-state.js';

/**
 * PR review guard: fires PostToolUse on Bash.
 *
 * Detects `gh pr create` output and reminds the agent to run the post-PR
 * review workflow.
 * As of S91-4 (#302) the suggestion includes recommended review types
 * computed from the PR's diff (file patterns) and current sprint metadata.
 */
export async function prReviewGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';
  const response = (input.tool_response?.stdout as string) ?? (input.tool_response?.result as string) ?? '';

  if (!command.includes('gh pr create')) return { metricReason: 'irrelevant-command' };

  // Substring fast-path used to gate the regex match, but `includes()` over
  // arbitrary text can never tightly bound a URL — CodeQL flags it as
  // js/incomplete-url-substring-sanitization. The regex below is the real
  // source of truth: it requires `https://github.com/` literally followed by
  // a path containing `/pull/<digits>`. If it matches, treat it as a real
  // PR URL; if not, the guard skips.
  const urlMatch = response.match(/(https:\/\/github\.com\/[^\s]+\/pull\/(\d+))/);
  if (!urlMatch) return { metricReason: 'no-match' };
  const prUrl = urlMatch[1];
  const prNumber = urlMatch[2];

  recordPendingReview(cwd, parseInt(prNumber, 10));

  const recs = computeRecommendations(cwd);
  const recLine = formatRecommendations(recs);

  return {
    metricReason: 'matched',
    context: [
      `SLOPE PR Review: A pull request was just created (${prUrl}).`,
      ...(recLine ? [`Recommended reviews based on diff: ${recLine}.`] : []),
      `Run \`slope pr review --pr=${prNumber}\` to generate the transport-independent review workflow.`,
      `After review, capture findings with \`slope review findings add\`, then \`slope review amend\` to apply them to the scorecard.`,
      'Tip: also run `slope pr finalize` to add Closes #N for any issues referenced in commits.',
    ].join(' '),
  };
}

function recordPendingReview(cwd: string, pr: number): void {
  try {
    const state = loadSprintState(cwd);
    let branch: string | undefined;
    try {
      branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || undefined;
    } catch { /* branch is metadata only */ }
    recordPrReviewPending(cwd, {
      pr,
      sprint: isActiveSprintState(state) ? state.sprint : undefined,
      branch,
    });
  } catch { /* review marker is best-effort; the reminder still fires */ }
}

/** Inspect the current branch's diff and call recommendReviews(). Best-effort
 *  — returns [] if git is unavailable or the diff can't be read. */
function computeRecommendations(cwd: string): ReviewRecommendation[] {
  try {
    const base = inferBaseRef(cwd) ?? 'origin/main';
    const filesRaw = execSync(`git diff ${base}...HEAD --name-only`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const filePatterns = filesRaw ? filesRaw.split('\n').filter(Boolean) : [];
    const ticketCount = inferTicketCount(cwd, base);
    return recommendReviews({
      ticketCount,
      slope: 1,
      filePatterns,
      hasNewInfra: filePatterns.some(p => /(\.sql|migration|schema|infra|terraform|k8s|deploy)/i.test(p)),
    });
  } catch {
    return [];
  }
}

function refExists(cwd: string, ref: string): boolean {
  try {
    execSync(`git rev-parse --verify ${ref}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function inferBaseRef(cwd: string): string | null {
  try {
    const remoteHead = execSync('git symbolic-ref --short refs/remotes/origin/HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // Verify the ref exists locally — symbolic-ref can return a name that
    // points at a branch the local repo doesn't track yet (no fetch).
    if (remoteHead && refExists(cwd, remoteHead)) return remoteHead;
  } catch { /* fall through */ }
  for (const r of ['origin/main', 'origin/master', 'main', 'master']) {
    if (refExists(cwd, r)) return r;
  }
  return null;
}

function inferTicketCount(cwd: string, base: string): number {
  try {
    const subjects = execSync(`git log ${base}..HEAD --format=%s`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!subjects) return 1;
    // Count distinct ticket keys (S{N}-{M}) referenced across commit subjects;
    // fall back to commit count if no ticket keys found.
    const keys = new Set<string>();
    const re = /\bS(\d+)-(\d+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(subjects)) !== null) {
      keys.add(`${m[1]}-${m[2]}`);
    }
    if (keys.size > 0) return keys.size;
    return Math.max(1, subjects.split('\n').length);
  } catch {
    return 1;
  }
}

function formatRecommendations(recs: ReviewRecommendation[]): string {
  if (recs.length === 0) return '';
  return recs
    .map(r => r.priority === 'required' ? `${r.review_type} (required)` : r.review_type)
    .join(', ');
}

// Exported for tests
export const _internals = { computeRecommendations, formatRecommendations, inferTicketCount };
