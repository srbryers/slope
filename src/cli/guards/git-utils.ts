import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { resolveRepoStateCwd, resolveRepoStatePath } from '../../core/index.js';

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
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
    const content = readFileSync(path, 'utf8').trim();
    if (!content) return new Set();
    return new Set(content.split('\n').filter(Boolean).map(line => line.slice(3)));
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
        // Skip the main worktree (same as cwd)
        if (currentPath !== cwd) {
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
