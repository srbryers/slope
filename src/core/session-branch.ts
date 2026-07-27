import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import type { SlopeSession } from './store.js';

export type SessionBranchSource = 'current' | 'at_start' | 'unknown';

export interface ObservedSlopeSession extends SlopeSession {
  branch_source: SessionBranchSource;
}

function canonicalExistingPath(path: string): string | undefined {
  if (!isAbsolute(path)) return undefined;
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function registeredWorktreePaths(cwd: string): Set<string> {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    const paths = output
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => canonicalExistingPath(line.slice('worktree '.length).trim()))
      .filter((path): path is string => Boolean(path));
    return new Set(paths);
  } catch {
    return new Set();
  }
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
  const worktrees = registeredWorktreePaths(defaultCwd);
  return sessions.map(session => {
    const storedWorktree = session.worktree_path
      ? canonicalExistingPath(session.worktree_path)
      : undefined;
    const target = session.worktree_path
      ? storedWorktree && worktrees.has(storedWorktree)
        ? storedWorktree
        : undefined
      : defaultCwd;
    const branch = target ? currentGitBranch(target) : undefined;
    if (branch) {
      return { ...session, branch, branch_source: 'current' };
    }
    return {
      ...session,
      branch_source: session.branch ? 'at_start' : 'unknown',
    };
  });
}

export function formatObservedSessionBranch(session: ObservedSlopeSession): string {
  if (session.branch_source === 'current') {
    return `Branch: ${session.branch ?? '-'}`;
  }
  if (session.branch_source === 'at_start') {
    return `Branch at start: ${session.branch}`;
  }
  return 'Branch: unknown';
}
