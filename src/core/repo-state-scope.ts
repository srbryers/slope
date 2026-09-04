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
 * Resolve the project root that owns tracked artifacts.
 *
 * An explicitly configured nested SLOPE project keeps its own tracked files.
 * Otherwise, first-time initialization belongs to the current Git checkout.
 */
export function resolveRepoSourceCwd(cwd: string = process.cwd()): string {
  const local = resolve(cwd);
  const gitTopLevel = nativeGitPath(local, ['rev-parse', '--show-toplevel']);
  return findNearestSlopeProject(local, gitTopLevel) ?? gitTopLevel ?? local;
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
  const gitTopLevel = nativeGitPath(local, ['rev-parse', '--show-toplevel']);
  const nearestProject = findNearestSlopeProject(local, gitTopLevel);
  const primary = resolvePrimaryCheckout(local);
  const primaryIsSlopeProject = primary
    ? existsSync(join(primary, '.slope', 'config.json'))
    : false;

  if (
    nearestProject &&
    (
      !gitTopLevel ||
      !samePath(nearestProject, gitTopLevel) ||
      !primary ||
      samePath(primary, gitTopLevel) ||
      !primaryIsSlopeProject
    )
  ) {
    return nearestProject;
  }

  if (
    existsSync(join(local, '.slope')) &&
    (!gitTopLevel || !samePath(local, gitTopLevel))
  ) {
    return local;
  }

  if (!primary || !primaryIsSlopeProject) return gitTopLevel ?? local;
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

/**
 * A path from git, in this platform's own separator style.
 *
 * git reports paths with forward slashes on every platform, so on Windows
 * `rev-parse --show-toplevel` returns `C:/Users/...` while everything derived
 * from `resolve` or `mkdtempSync` uses backslashes. Both name the same
 * directory and neither equals the other as a string.
 *
 * That leaked out of this module. `resolveRepoSourceCwd` returns the git value
 * when there is no nearer SLOPE project, and the session heartbeat stores it
 * as `worktree_path`. A record written from the git branch then failed every
 * comparison against one written from a Node path, so worktree reconciliation
 * could not match a session to its own checkout (#712).
 *
 * Normalising here rather than at each call site, because the mixing is what
 * causes the bug and this is the one place the git values enter.
 */
function nativeGitPath(cwd: string, args: string[]): string | null {
  const output = safeGit(cwd, args);
  return output === null ? null : resolve(output);
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
