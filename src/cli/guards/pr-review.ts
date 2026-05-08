import { execSync } from 'node:child_process';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { recommendReviews } from '../../core/review.js';
import type { ReviewRecommendation } from '../../core/index.js';

/**
 * PR review guard: fires PostToolUse on Bash.
 *
 * Detects `gh pr create` output and prompts for review workflow choice.
 * As of S91-4 (#302) the suggestion includes recommended review types
 * computed from the PR's diff (file patterns) and current sprint metadata.
 */
export async function prReviewGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';
  const response = (input.tool_response?.stdout as string) ?? (input.tool_response?.result as string) ?? '';

  if (!command.includes('gh pr create')) return {};
  if (!response.includes('github.com/') || !response.includes('/pull/')) return {};

  const urlMatch = response.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/);
  const prUrl = urlMatch ? urlMatch[1] : 'the PR';

  const recs = computeRecommendations(cwd);
  const recLine = formatRecommendations(recs);

  const suggestion: Suggestion = {
    id: 'pr-review',
    title: 'PR Review',
    context: [
      `A pull request was just created (${prUrl}).`,
      ...(recLine ? [`Recommended reviews based on diff: ${recLine}`] : []),
      `After the review, capture findings with \`slope review findings add\`, then \`slope review amend\` to apply to scorecard.`,
      'Tip: also run `slope pr finalize` to add Closes #N for any issues referenced in commits.',
    ].join(' '),
    options: [
      { id: 'code', label: 'Code Review', description: 'Detailed line-by-line code review of the diff' },
      { id: 'architect', label: 'Architect Review', description: 'High-level architecture and design review' },
      { id: 'both', label: 'Both', description: 'Run code review followed by architect review' },
      { id: 'manual', label: 'Manual Review', description: 'User will review manually, no automated review' },
      { id: 'skip', label: 'Skip / Merge Now', description: 'No review needed, proceed to merge' },
    ],
    requiresDecision: true,
    priority: 'high',
  };

  return { suggestion };
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
