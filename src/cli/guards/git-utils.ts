import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { resolveRepoStateCwd, resolveRepoStatePath, samePath } from '../../core/index.js';

/**
 * Check if HEAD is at or behind origin/main.
 * Returns true when all local commits are already on main —
 * meaning @{u}..HEAD comparisons would give false positives
 * (e.g., after squash-merge + reset to main).
 */
export function headIsOnMain(cwd: string): boolean {
  try {
    execSync('git merge-base --is-ancestor HEAD origin/main', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

// --- Session baseline: snapshot git status at session start ---

const BASELINES_DIR = '.slope/baselines';

export interface GitStatusEntry {
  status: string;
  path: string;
}

export function parseGitStatusPorcelain(output: string): GitStatusEntry[] {
  const content = output.trimEnd();
  if (!content) return [];
  return content
    .split('\n')
    .filter(Boolean)
    .map(line => ({
      status: line.slice(0, 2),
      path: line.slice(3),
    }));
}

function baselinePath(sessionId: string, cwd: string): string {
  const stateCwd = resolveRepoStateCwd(cwd);
  const worktreeRoot = gitTopLevel(cwd);
  const suffix = resolve(worktreeRoot) === resolve(stateCwd)
    ? ''
    : `-${createHash('sha256').update(worktreeRoot).digest('hex').slice(0, 12)}`;
  return resolveRepoStatePath(cwd, `${BASELINES_DIR}/${sessionId}${suffix}.txt`);
}

function gitTopLevel(cwd: string): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || cwd;
  } catch {
    return cwd;
  }
}

/**
 * Record git status baseline for a session. Only writes on first call per session.
 * Returns true if a new baseline was created, false if one already existed.
 */
export function recordBaseline(sessionId: string, cwd: string): boolean {
  if (!sessionId) return false;
  const path = baselinePath(sessionId, cwd);
  if (existsSync(path)) return false;

  try {
    const status = execSync('git status --porcelain=v1', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, status);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the set of files that were dirty at session start.
 * Returns a Set of file paths (from git status --porcelain output).
 */
export function loadBaseline(sessionId: string, cwd: string): Set<string> {
  if (!sessionId) return new Set();
  const path = baselinePath(sessionId, cwd);
  if (!existsSync(path)) return new Set();

  try {
    return new Set(parseGitStatusPorcelain(readFileSync(path, 'utf8')).map(entry => entry.path));
  } catch {
    return new Set();
  }
}

/**
 * Clean up the baseline file for a session.
 */
export function removeBaseline(sessionId: string, cwd: string): void {
  const path = baselinePath(sessionId, cwd);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* best-effort cleanup */ }
}

// --- Worktree detection ---

export interface ActiveWorktree {
  path: string;
  branch: string;
  /** Unpushed commit count (0 if clean) */
  unpushed: number;
}

/**
 * Detect active agent worktrees with unpushed work.
 * Parses `git worktree list --porcelain` for non-bare worktrees.
 */
export function getActiveWorktrees(cwd: string): ActiveWorktree[] {
  try {
    const raw = execSync('git worktree list --porcelain', { cwd, encoding: 'utf8', timeout: 5000 });
    const worktrees: ActiveWorktree[] = [];
    let currentPath = '';
    let currentBranch = '';

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ')) {
        currentBranch = line.slice('branch '.length).replace('refs/heads/', '').trim();
      } else if (line === '' && currentPath && currentBranch) {
        // Skip the main worktree (same as cwd).
        //
        // Compared through a canonical form, not as raw strings. `git worktree
        // list --porcelain` reports forward slashes on every platform, so on
        // Windows this never matched the native `cwd` and the primary checkout
        // was reported as an agent worktree. next-action then raised
        // `worktrees-active` against the directory the operator was standing
        // in, listing their own unpushed commits as someone else's (#712).
        if (!samePath(currentPath, cwd)) {
          // Check for unpushed commits
          let unpushed = 0;
          try {
            const log = execSync(`git -C "${currentPath}" log --oneline @{u}..HEAD`, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            unpushed = log ? log.split('\n').length : 0;
          } catch { /* no upstream or other error — count as 0 */ }

          worktrees.push({ path: currentPath, branch: currentBranch, unpushed });
        }
        currentPath = '';
        currentBranch = '';
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}
