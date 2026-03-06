import { execSync } from 'node:child_process';

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
