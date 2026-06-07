// SLOPE — Git History Analyzer: commits, contributors, cadence, branches, releases
import { execSync } from 'node:child_process';
import type { GitProfile } from './types.js';

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function isSprintRangeEndpoint(line: string, matchStart: number, matchEnd: number): boolean {
  const before = line.slice(0, matchStart);
  const after = line.slice(matchEnd);
  return /S\d+\s*[-\u2013\u2014]\s*$/.test(before) || /^\s*[-\u2013\u2014]\s*S\d+\b/.test(after);
}

/** Extract shipped sprint IDs referenced in commit subjects.
 *  Matches `S\d+` not followed by another digit or a dot — so `S75.5` does
 *  NOT count as a reference to S75, and `S70+S71` correctly yields {70, 71}.
 *  Ticket zero (`S101-0`) is reserved for sprint scoping/planning commits and
 *  does not mean implementation for that sprint has shipped. Sprint ranges
 *  (`S64-S80`, `S85–S90`) are roadmap references, not shipped commits.
 *  Pure function — separated from git I/O for testability.
 */
export function extractSprintReferences(commitSubjects: string[]): Set<number> {
  const result = new Set<number>();
  const re = /\bS(\d+)(?!(?:[\d.]|-0\b))/g;
  for (const line of commitSubjects) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (isSprintRangeEndpoint(line, m.index, re.lastIndex)) continue;
      result.add(parseInt(m[1], 10));
    }
  }
  return result;
}

/** Extract sprint IDs from shipped sprint artifact paths in git log output.
 *  This catches normal GitHub squash merges whose subject is PR-oriented
 *  (`Fix thing (#123)`) while the commit itself adds `docs/retros/sprint-N.json`.
 */
export function extractSprintArtifactReferences(logLines: string[]): Set<number> {
  const result = new Set<number>();
  const re = /^docs\/retros\/sprint-(\d+)(?:\.json|-review\.md)$/i;
  for (const line of logLines) {
    const m = line.trim().match(re);
    if (m) result.add(parseInt(m[1], 10));
  }
  return result;
}

function unionSets<T>(...sets: Set<T>[]): Set<T> {
  const result = new Set<T>();
  for (const set of sets) {
    for (const value of set) result.add(value);
  }
  return result;
}

/**
 * Allowed characters in git refs (branch / tag / abbreviated SHA). Permissive
 * enough for the names users actually pick (alphanumerics, slash, dot, dash,
 * underscore, plus) — strict enough to forbid shell metacharacters that would
 * make this function a shell-injection sink (CodeQL js/shell-command-...).
 */
const SAFE_REF_RE = /^[A-Za-z0-9/_.+-]+$/;

/** Detect sprint IDs with shipped commits on the given ref (default: main).
 *  Falls back to `master` then `HEAD` if main is unavailable. Returns an empty
 *  set on any git failure so callers can run validation without a working repo.
 *  Refs are validated against SAFE_REF_RE before being interpolated into the
 *  shell command — refs containing whitespace, semicolons, backticks, etc.
 *  short-circuit to an empty set rather than risk a shell injection.
 */
export function findShippedSprintsOnMain(cwd: string, ref?: string): Set<number> {
  const isGit = git('rev-parse --is-inside-work-tree', cwd);
  if (isGit !== 'true') return new Set();

  const candidates = ref ? [ref] : ['main', 'master', 'HEAD'];
  for (const r of candidates) {
    if (!SAFE_REF_RE.test(r)) continue; // skip unsafe refs silently
    // Cap at 1000 commits — plenty for sprint references (a project would
    // need to ship hundreds of sprints to exhaust this) and avoids slowing
    // session-end Stop hooks on deep-history repos.
    const subjects = git(`log ${r} --format=%s -n 1000`, cwd);
    const files = git(`log ${r} --name-only --format= -n 1000`, cwd);
    if (subjects || files) {
      return unionSets(
        extractSprintReferences(subjects ? subjects.split('\n') : []),
        extractSprintArtifactReferences(files ? files.split('\n') : []),
      );
    }
  }
  return new Set();
}

function parseContributors(output: string): Array<{ name: string; email: string; commits: number }> {
  if (!output) return [];
  const contributors: Array<{ name: string; email: string; commits: number }> = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^\s*(\d+)\s+(.+?)\s+<([^>]+)>$/);
    if (match) {
      contributors.push({
        commits: parseInt(match[1], 10),
        name: match[2].trim(),
        email: match[3].trim(),
      });
    }
  }
  return contributors.sort((a, b) => b.commits - a.commits);
}

function inferCadence(commitsPerWeek: number): GitProfile['inferredCadence'] {
  if (commitsPerWeek >= 5) return 'daily';
  if (commitsPerWeek >= 2) return 'weekly';
  if (commitsPerWeek >= 0.5) return 'biweekly';
  if (commitsPerWeek >= 0.2) return 'monthly';
  return 'sporadic';
}

export async function analyzeGit(cwd: string): Promise<GitProfile> {
  // Check if we're in a git repo
  const isGit = git('rev-parse --is-inside-work-tree', cwd);
  if (isGit !== 'true') {
    return {
      totalCommits: 0,
      commitsLast90d: 0,
      commitsPerWeek: 0,
      contributors: [],
      activeBranches: [],
      inferredCadence: 'sporadic',
    };
  }

  // Total commits
  const totalStr = git('rev-list --count HEAD', cwd);
  const totalCommits = parseInt(totalStr, 10) || 0;

  // Commits in last 90 days
  const recentStr = git('log --oneline --since="90 days ago"', cwd);
  const commitsLast90d = recentStr ? recentStr.split('\n').length : 0;

  // Commits per week (90 days ≈ 12.86 weeks)
  const commitsPerWeek = commitsLast90d > 0 ? Math.round((commitsLast90d / 12.86) * 100) / 100 : 0;

  // Contributors (last 90 days)
  const shortlog = git('shortlog -sne --since="90 days ago" HEAD', cwd);
  const contributors = parseContributors(shortlog);

  // Active branches
  const branchOutput = git('branch -r --no-merged', cwd);
  const activeBranches = branchOutput
    ? branchOutput.split('\n')
        .map(b => b.trim())
        .filter(b => b && !b.includes('HEAD') && !b.includes('->'))
        .map(b => b.replace(/^origin\//, ''))
    : [];

  // Last release tag
  let lastRelease: GitProfile['lastRelease'];
  const tag = git('describe --tags --abbrev=0', cwd);
  if (tag) {
    const tagDate = git(`log -1 --format=%aI ${tag}`, cwd);
    lastRelease = { tag, date: tagDate || new Date().toISOString() };
  }

  const inferredCadence = inferCadence(commitsPerWeek);

  return {
    totalCommits,
    commitsLast90d,
    commitsPerWeek,
    contributors,
    activeBranches,
    lastRelease,
    inferredCadence,
  };
}
