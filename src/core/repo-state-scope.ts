import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Resolve the primary checkout for the repository containing `cwd`.
 *
 * Linked worktrees have a private git dir under the primary checkout's shared
 * `.git/worktrees` directory. The parent of the common `.git` directory is the
 * checkout that owns repository-wide ignored state.
 */
export function resolvePrimaryCheckout(cwd: string): string | null {
  const commonDir = safeGit(cwd, ['rev-parse', '--git-common-dir']);
  if (!commonDir) return null;

  const absolute = isAbsolute(commonDir) ? resolve(commonDir) : resolve(cwd, commonDir);
  if (basename(absolute) !== '.git') return null;

  const primary = dirname(absolute);
  return existsSync(primary) ? primary : null;
}

/**
 * Resolve the checkout that owns ignored SLOPE repository state.
 *
 * A linked worktree only adopts the primary checkout when that checkout is
 * already SLOPE-enabled. Non-git directories and repositories without a
 * primary `.slope/config.json` retain the caller's cwd, preserving init and
 * isolated test behavior.
 */
export function resolveRepoStateCwd(cwd: string = process.cwd()): string {
  const local = resolve(cwd);
  const gitTopLevel = safeGit(local, ['rev-parse', '--show-toplevel']);
  const nearestProject = findNearestSlopeProject(local, gitTopLevel);
  const primary = resolvePrimaryCheckout(local);

  if (
    nearestProject &&
    (!gitTopLevel || !samePath(nearestProject, gitTopLevel) || !primary || samePath(primary, gitTopLevel))
  ) {
    return nearestProject;
  }

  if (
    existsSync(join(local, '.slope')) &&
    (!gitTopLevel || !samePath(local, gitTopLevel))
  ) {
    return local;
  }

  if (!primary || !existsSync(join(primary, '.slope', 'config.json'))) return local;
  return primary;
}

/** Resolve a repository-state path relative to the checkout that owns it. */
export function resolveRepoStatePath(
  cwd: string,
  statePath: string,
): string {
  if (isAbsolute(statePath)) return resolve(statePath);
  return resolve(resolveRepoStateCwd(cwd), statePath);
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function samePath(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function findNearestSlopeProject(start: string, gitTopLevel: string | null): string | null {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, '.slope', 'config.json'))) return dir;
    if (gitTopLevel && samePath(dir, gitTopLevel)) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
