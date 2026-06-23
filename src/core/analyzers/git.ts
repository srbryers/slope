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

const MAX_SHIPPED_TICKET_SUFFIX = 99;

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
  const re = /\bS(\d+)(?:-(\d+))?(?![\d.])/g;
  for (const line of commitSubjects) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (isSprintRangeEndpoint(line, m.index, re.lastIndex)) continue;
      const ticketSuffix = m[2] == null ? null : parseInt(m[2], 10);
      if (ticketSuffix === 0) continue;
      // SLOPE ticket keys are small ordinal suffixes (S149-1, S149-2).
      // Large suffixes are usually GitHub/product issue keys, e.g. S147-533,
      // and should not imply that roadmap sprint S147 shipped.
      if (ticketSuffix != null && ticketSuffix > MAX_SHIPPED_TICKET_SUFFIX) continue;
      result.add(parseInt(m[1], 10));
    }
  }
  return result;
}

/** Extract sprint IDs from shipped sprint artifact paths in git log output.
 *  This catches normal GitHub squash merges whose subject is PR-oriented
 *  (`Fix thing (#123)`) while the commit itself adds `docs/retros/sprint-N.json`
 *  or an inserted sprint artifact such as `docs/retros/sprint-143.5.json`.
 */
export function extractSprintArtifactReferences(logLines: string[]): Set<number> {
  const result = new Set<number>();
  const re = /^docs\/retros\/sprint-(\d+(?:\.\d+)?)(?:\.json|-review\.md)$/i;
  for (const line of logLines) {
    const m = line.trim().match(re);
    if (m) result.add(parseFloat(m[1]));
  }
  return result;
}

interface GitSprintCommit {
  subject: string;
  files: string[];
}

function parseSprintLog(raw: string): GitSprintCommit[] {
  return raw
    .split('\x1e')
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const [subject = '', ...files] = block
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
      return { subject, files };
    });
}

function isSlopeMetadataPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return normalized === 'docs/backlog/roadmap.json'
    || /^docs\/retros\/sprint-\d+(?:\.\d+)?(?:\.json|-review\.md)$/i.test(normalized)
    || /^\.slope\/retros\/post-merge\/sprint-\d+(?:\.\d+)?(?:-pr-\d+)?\.json$/i.test(normalized);
}

function isSlopeMetadataOnlyCommit(files: string[]): boolean {
  return files.length > 0 && files.every(isSlopeMetadataPath);
}

function extractShippedSprintReferences(commits: GitSprintCommit[]): Set<number> {
  const result = new Set<number>();

  for (const commit of commits) {
    const artifactRefs = extractSprintArtifactReferences(commit.files);
    const subjectRefs = isSlopeMetadataOnlyCommit(commit.files)
      ? new Set<number>()
      : extractSprintReferences([commit.subject]);

    for (const ref of unionSets(artifactRefs, subjectRefs)) {
      result.add(ref);
    }
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
    const log = git(`log ${r} --format=%x1e%s --name-only -n 1000`, cwd);
    if (log) return extractShippedSprintReferences(parseSprintLog(log));
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
