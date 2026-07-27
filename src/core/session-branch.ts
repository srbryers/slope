import { execFileSync } from 'node:child_process';
import type { SlopeSession } from './store.js';

export type SessionBranchSource = 'current' | 'at_start' | 'unknown';

export interface ObservedSlopeSession extends SlopeSession {
  branch_source: SessionBranchSource;
}

/** Read the currently checked-out branch without treating detached HEAD as a branch. */
export function currentGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve session branches live for status presentation.
 *
 * Sessions without a worktree path belong to the caller-provided checkout.
 * When that checkout cannot be inspected, the stored branch is explicitly
 * labeled as the value captured at session start.
 */
export function observeSessionBranches(
  sessions: SlopeSession[],
  defaultCwd: string,
): ObservedSlopeSession[] {
  return sessions.map(session => {
    const branch = currentGitBranch(session.worktree_path ?? defaultCwd);
    if (branch) {
      return { ...session, branch, branch_source: 'current' };
    }
    return {
      ...session,
      branch_source: session.branch ? 'at_start' : 'unknown',
    };
  });
}
