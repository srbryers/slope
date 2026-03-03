import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './logger.js';

const BRANCH_PREFIX = 'slope-loop';

export interface WorktreeInfo {
  path: string;
  branch: string;
  created: boolean;
}

/**
 * Create (or reuse) a git worktree for a sprint.
 * Runs pnpm install + build in the new worktree.
 */
export function createWorktree(
  sprintId: string,
  mainRepo: string,
  log: Logger,
): WorktreeInfo {
  const branch = `${BRANCH_PREFIX}/${sprintId}`;
  const worktreePath = join(mainRepo, `.slope-loop-worktree-${sprintId}`);

  // Prune stale worktree refs
  try {
    execSync('git worktree prune', { cwd: mainRepo, stdio: 'pipe' });
  } catch { /* ok */ }

  if (existsSync(worktreePath)) {
    log.info(`Reusing existing worktree: ${worktreePath}`);
    return { path: worktreePath, branch, created: false };
  }

  try {
    execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch], {
      cwd: mainRepo,
      stdio: 'pipe',
    });
  } catch (err) {
    throw new Error(`Failed to create worktree: ${(err as Error).message}`);
  }

  log.info(`Created worktree: ${worktreePath} (branch: ${branch})`);

  // Install deps and build in the new worktree
  log.info('Installing dependencies in worktree...');
  try {
    execSync('pnpm install --frozen-lockfile', { cwd: worktreePath, stdio: 'pipe', timeout: 120_000 });
  } catch {
    log.warn('pnpm install failed in worktree — continuing anyway');
  }

  log.info('Building in worktree...');
  try {
    execSync('pnpm build', { cwd: worktreePath, stdio: 'pipe', timeout: 120_000 });
  } catch {
    log.warn('pnpm build failed in worktree — continuing anyway');
  }

  return { path: worktreePath, branch, created: true };
}

/**
 * Refresh the semantic index in a worktree if stale.
 */
export function refreshIndex(worktreePath: string, log: Logger): void {
  try {
    const currentSha = execSync('git rev-parse HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();
    let indexSha = '';
    try {
      const statusJson = execSync('pnpm slope index --status --json', {
        cwd: worktreePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(statusJson);
      indexSha = parsed.lastSha ?? '';
    } catch { /* no index yet */ }

    if (currentSha !== indexSha) {
      log.info('Updating semantic index...');
      execSync('pnpm slope index', { cwd: worktreePath, stdio: 'pipe', timeout: 120_000 });
    }
  } catch {
    log.warn('Semantic index refresh failed — using stale index');
  }
}

/**
 * Enrich backlog if not already enriched.
 */
export function enrichBacklog(backlogPath: string, worktreePath: string, log: Logger): void {
  log.info('Enriching backlog with file context...');
  try {
    execSync(`pnpm slope enrich "${backlogPath}"`, {
      cwd: worktreePath,
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch {
    log.warn('Backlog enrichment failed — continuing without enrichment');
  }
}

/**
 * Remove a worktree and optionally its branch.
 */
export function removeWorktree(
  worktreePath: string,
  branch: string,
  mainRepo: string,
  log: Logger,
): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { cwd: mainRepo, stdio: 'pipe' });
    log.info(`Removed worktree: ${worktreePath}`);
  } catch {
    log.warn(`Failed to remove worktree: ${worktreePath}`);
  }

  // Safe branch delete (-d, not -D) — refuses if unmerged
  try {
    execSync(`git branch -d "${branch}"`, { cwd: mainRepo, stdio: 'pipe' });
    log.info(`Deleted branch: ${branch}`);
  } catch {
    log.info(`Branch ${branch} has unmerged changes — keeping`);
  }
}

/** Get the current HEAD SHA */
export function getHeadSha(cwd: string): string {
  return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
}

/** Count commits between two SHAs */
export function countCommits(fromSha: string, toSha: string, cwd: string): number {
  try {
    const count = execSync(`git rev-list --count ${fromSha}..${toSha}`, { cwd, encoding: 'utf8' }).trim();
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

/** Push branch to origin */
export function pushBranch(branch: string, cwd: string, log: Logger): boolean {
  try {
    execSync(`git push -u origin "${branch}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    log.warn(`git push failed for branch ${branch}`);
    return false;
  }
}
