import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if HEAD is at or behind origin/main.
 * Returns true when all local commits are already on main —
 * meaning @{u}..HEAD comparisons would give false positives
 * (e.g., after squash-merge + reset to main).
 */
export function headIsOnMain(cwd: string): boolean {
  try {
    execSync('git merge-base --is-ancestor HEAD origin/main 2>/dev/null', { cwd, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

// --- Session baseline: snapshot git status at session start ---

const BASELINES_DIR = '.slope/baselines';

function baselinePath(sessionId: string, cwd: string): string {
  return join(cwd, BASELINES_DIR, `${sessionId}.txt`);
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
    const status = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    const dir = join(cwd, BASELINES_DIR);
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
            const log = execSync(`git -C "${currentPath}" log --oneline @{u}..HEAD 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim();
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
