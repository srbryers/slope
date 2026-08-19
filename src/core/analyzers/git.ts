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
const IMPLEMENTATION_COMMIT_TYPES = new Set(['feat', 'fix', 'refactor', 'perf', 'test']);
const PLANNING_REFERENCE_SCOPES = new Set(['roadmap', 'plan', 'planning']);
const PLANNING_REFERENCE_RE = /\b(plan|planned|planning|reslot|scope|scoping|spike|triage|lane)\b/i;

interface ConventionalCommitSubject {
  type: string;
  scope?: string;
  description: string;
}

function isCommitType(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    if (!isLower && !isUpper) return false;
  }
  return true;
}

function parseConventionalCommitSubject(line: string): ConventionalCommitSubject | null {
  const colon = line.indexOf(':');
  if (colon <= 0) return null;

  const rawHeader = line.slice(0, colon);
  const header = rawHeader.endsWith('!') ? rawHeader.slice(0, -1) : rawHeader;
  const description = line.slice(colon + 1).trimStart();
  const scopeStart = header.indexOf('(');
  if (scopeStart === -1) {
    if (!isCommitType(header)) return null;
    return {
      type: header.toLowerCase(),
      description,
    };
  }

  if (!header.endsWith(')')) return null;
  const type = header.slice(0, scopeStart);
  const scope = header.slice(scopeStart + 1, -1);
  if (!isCommitType(type) || scope.length === 0 || scope.includes(')')) return null;

  return {
    type: type.toLowerCase(),
    scope: scope.toLowerCase(),
    description,
  };
}

function isPlanningOnlyBareReference(subject: ConventionalCommitSubject): boolean {
  return subject.scope != null
    && PLANNING_REFERENCE_SCOPES.has(subject.scope)
    && PLANNING_REFERENCE_RE.test(subject.description);
}

function hasImplementationCommitType(line: string): boolean {
  const subject = parseConventionalCommitSubject(line);
  if (!subject) return false;
  return IMPLEMENTATION_COMMIT_TYPES.has(subject.type) && !isPlanningOnlyBareReference(subject);
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
  const re = /\bS(\d+)(?:-(\d+))?(?![\d.])/g;
  for (const line of commitSubjects) {
    const hasImplementationSignal = hasImplementationCommitType(line);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (isSprintRangeEndpoint(line, m.index, re.lastIndex)) continue;
      const ticketSuffix = m[2] == null ? null : parseInt(m[2], 10);
      if (ticketSuffix === 0) continue;
      // SLOPE ticket keys are small ordinal suffixes (S149-1, S149-2).
      // Large suffixes are usually GitHub/product issue keys, e.g. S147-533,
      // and should not imply that roadmap sprint S147 shipped.
      if (ticketSuffix != null && ticketSuffix > MAX_SHIPPED_TICKET_SUFFIX) continue;
      if (ticketSuffix == null && !hasImplementationSignal) continue;
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
    // Modular roadmap sources: a project that authors through
    // docs/roadmap/**.yaml gets the same treatment as one still editing the
    // single generated projection, so a roadmap-only commit never reads as a
    // sprint shipping (#686).
    || /^docs\/roadmap\/.+\.ya?ml$/i.test(normalized)
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

/** Where the trunk ref used for shipped-commit detection came from. */
export type TrunkRefSource = 'explicit' | 'upstream' | 'remote-head' | 'local' | 'head';

export interface TrunkResolution {
  /** The ref to scan, or null when no candidate resolved. */
  ref: string | null;
  source: TrunkRefSource;
  /** The local trunk branch, when one exists. */
  localRef: string | null;
  /** Commits the local trunk is behind the resolved remote ref. */
  behind: number;
}

const LOCAL_TRUNK_CANDIDATES = ['main', 'master'];

/** True when `ref` exists in this repository. */
function refExists(ref: string, cwd: string): boolean {
  if (!SAFE_REF_RE.test(ref)) return false;
  return git(`rev-parse --verify --quiet ${ref}`, cwd) !== '';
}

/** Resolve the trunk ref to scan for shipped commits.
 *
 *  Prefers the remote-tracking ref over the local branch. A git worktree never
 *  fast-forwards its local `main`, so scanning the local ref reports every
 *  recently-merged sprint as unshipped — and worktrees are the recommended way
 *  to run parallel sprints here, so the check was always-on-and-wrong in
 *  exactly the workflow SLOPE encourages (#687).
 *
 *  Order: the local trunk's configured upstream, then the remote's recorded
 *  default branch, then the local branch, then `HEAD`.
 */
export function resolveTrunkRef(cwd: string, explicit?: string): TrunkResolution {
  if (explicit) {
    return { ref: explicit, source: 'explicit', localRef: null, behind: 0 };
  }

  const localRef = LOCAL_TRUNK_CANDIDATES.find(ref => refExists(ref, cwd)) ?? null;

  // 1. The local trunk's configured upstream (`origin/main` for most repos).
  let remoteRef: string | null = null;
  if (localRef) {
    const upstream = git(`rev-parse --abbrev-ref --symbolic-full-name ${localRef}@{upstream}`, cwd);
    if (upstream && refExists(upstream, cwd)) remoteRef = upstream;
  }

  // 2. The remote's default branch, for a trunk with no upstream configured.
  if (!remoteRef) {
    const head = git('symbolic-ref --short refs/remotes/origin/HEAD', cwd);
    if (head && refExists(head, cwd)) remoteRef = head;
  }

  if (remoteRef) {
    // Divergence is itself the condition that makes the check meaningless,
    // so report it rather than silently scanning the newer ref.
    let behind = 0;
    if (localRef) {
      const count = git(`rev-list --count ${localRef}..${remoteRef}`, cwd);
      behind = Number.parseInt(count, 10) || 0;
    }
    return {
      ref: remoteRef,
      source: remoteRef.endsWith('/HEAD') ? 'remote-head' : 'upstream',
      localRef,
      behind,
    };
  }

  if (localRef) return { ref: localRef, source: 'local', localRef, behind: 0 };
  return { ref: refExists('HEAD', cwd) ? 'HEAD' : null, source: 'head', localRef: null, behind: 0 };
}

/** Detect sprint IDs with shipped commits on the trunk.
 *  Resolves the trunk via `resolveTrunkRef`, preferring the remote-tracking
 *  ref so a stale local branch in a worktree does not hide merged work (#687).
 *  Returns an empty set on any git failure so callers can run validation
 *  without a working repo. Refs are validated against SAFE_REF_RE before being
 *  interpolated into the shell command — refs containing whitespace,
 *  semicolons, backticks, etc. short-circuit to an empty set rather than risk
 *  a shell injection.
 */
export function findShippedSprintsOnMain(cwd: string, ref?: string): Set<number> {
  const isGit = git('rev-parse --is-inside-work-tree', cwd);
  if (isGit !== 'true') return new Set();

  // An explicit ref is honoured alone — never widened to the defaults, so an
  // unsafe ref short-circuits to an empty set instead of silently scanning
  // some other branch.
  if (ref) return scanRefs([ref], cwd);

  const resolved = resolveTrunkRef(cwd);
  // Keep the historical fallbacks after the resolved ref: a repo with neither
  // a remote nor a local trunk still scans HEAD rather than reporting nothing.
  const candidates = [resolved.ref, 'main', 'master', 'HEAD'].filter((r): r is string => r != null);
  return scanRefs(candidates, cwd);
}

/** Scan the first usable ref for sprint references. */
function scanRefs(candidates: string[], cwd: string): Set<number> {
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
