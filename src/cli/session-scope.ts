import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  resolvePrimaryCheckout as resolvePrimaryCheckoutCore,
  resolveRepoStateCwd,
} from '../core/index.js';

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
  return resolveRepoStateCwd(cwd);
}

/**
 * Resolve the primary checkout of the repository containing `cwd`.
 *
 * `git rev-parse --git-common-dir` yields the shared `.git` directory: `.git`
 * in the primary checkout, and a path to the primary's `.git` when run inside a
 * linked worktree. The primary checkout is that directory's parent.
 */
export function resolvePrimaryCheckout(cwd: string): string | null {
  return resolvePrimaryCheckoutCore(cwd);
}

/**
 * List every checkout of the repository containing `cwd` — the primary checkout
 * and all linked worktrees — with `cwd` itself always included.
 *
 * Sprint lifecycle state is stored per checkout (`.slope/sprint-state.json`), so
 * a closeout that only touches `cwd` leaves every sibling worktree reporting a
 * stale sprint and contradictory next actions (GH #624).
 */
export function listRepoWorktrees(cwd: string): string[] {
  const roots = new Set<string>([resolve(cwd)]);

  const raw = safeGit(cwd, ['worktree', 'list', '--porcelain']);
  for (const line of (raw ?? '').split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const path = line.slice('worktree '.length).trim();
    if (path) roots.add(resolve(path));
  }

  return [...roots];
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
