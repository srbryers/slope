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
 * `resolveRepoSourceCwd` returns the git value when there is no nearer SLOPE
 * project, and the session heartbeat stores it as `worktree_path`, so records
 * were persisted in two spellings. Every comparison of those goes through
 * `samePath`, which resolves both, so reconciliation was not broken; what this
 * fixes is the inconsistency itself, and the display and raw-equality paths
 * that read the stored string directly (#712).
 *
 * Resolved against `cwd`, not the process working directory, because git
 * returns a relative path for some queries: `--git-common-dir` gives `.git` in
 * a primary checkout. This is not the only place git paths enter the codebase,
 * so a raw `!==` elsewhere is still a bug waiting to happen; `samePath` is the
 * comparison to reach for.
 */
function nativeGitPath(cwd: string, args: string[]): string | null {
  const output = safeGit(cwd, args);
  return output === null ? null : resolve(cwd, output);
}

/**
 * Whether two paths name the same location.
 *
 * Resolves through the filesystem so a symlink, a `..` segment, or git's
 * forward-slash spelling all compare equal to the native form. Falls back to
 * lexical resolution when either path does not exist.
 *
 * Exported because comparing these as raw strings is a recurring Windows bug:
 * git reports forward slashes everywhere, so any `a !== b` against a Node path
 * is always true there (#712).
 */
export function samePath(left: string, right: string): boolean {
  try {
    return canonicalPath(left) === canonicalPath(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

/**
 * The filesystem's own name for a path.
 *
 * `realpathSync.native` rather than `realpathSync`, because the JavaScript
 * implementation resolves symlinks and junctions but leaves a Windows 8.3
 * short name alone. `C:\Users\RUNNER~1\...` and `C:\Users\runneradmin\...` are
 * the same directory, and only the native binding says so. That difference is
 * reachable in the product: `os.tmpdir()` returns the short form on some
 * Windows configurations, including the GitHub runner, while git and
 * `--show-toplevel` return the long one (#712).
 *
 * Falls back to the JavaScript implementation if the native binding is
 * unavailable, which is still better than a raw string comparison.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return realpathSync(path);
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
