import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Resolve the working directory whose store owns *session* coordination state.
 *
 * Session records exist to coordinate concurrent agents across a repository, so
 * they must live in one store per repository — not one per worktree. Secondary
 * worktrees check out the committed `.slope/config.json`, so resolving the store
 * from the local cwd gives every worktree its own empty database. That split is
 * the root of GH #630 / #631: `worktree-check` reads the primary checkout's
 * store (via the hook payload cwd) while `slope session list|prune|end` reads the
 * worktree's own, so the guard's printed remediation can never clear the
 * sessions the guard is blocking on.
 *
 * Returns the primary checkout when it owns SLOPE state, otherwise `cwd`
 * unchanged (single-checkout repos, non-git directories, and repos whose
 * primary checkout has no `.slope/config.json`).
 */
export function resolveSessionStoreCwd(cwd: string): string {
  const primary = resolvePrimaryCheckout(cwd);
  if (!primary) return cwd;
  if (!existsSync(join(primary, '.slope', 'config.json'))) return cwd;
  return primary;
}

/**
 * Resolve the primary checkout of the repository containing `cwd`.
 *
 * `git rev-parse --git-common-dir` yields the shared `.git` directory: `.git`
 * in the primary checkout, and a path to the primary's `.git` when run inside a
 * linked worktree. The primary checkout is that directory's parent.
 */
export function resolvePrimaryCheckout(cwd: string): string | null {
  const commonDir = safeGit(cwd, ['rev-parse', '--git-common-dir']);
  if (!commonDir) return null;

  const absolute = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
  if (basename(absolute) !== '.git') return null;

  const root = dirname(absolute);
  return existsSync(root) ? root : null;
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
