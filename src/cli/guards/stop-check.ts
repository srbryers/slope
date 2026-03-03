import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Detect the effective git working directory for this session.
 * If the session is running inside a worktree, use that worktree's root.
 * Otherwise fall back to the provided cwd.
 */
function resolveGitDir(cwd: string): string {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    if (toplevel) return toplevel;
  } catch { /* not a git repo */ }
  return cwd;
}

/**
 * Check if another session has dirty state in the main checkout.
 * Returns true if cwd is the main repo and other worktrees exist,
 * meaning dirty files may belong to another session.
 */
function hasOtherWorktrees(cwd: string): boolean {
  try {
    const output = execSync('git worktree list --porcelain 2>/dev/null', { cwd, encoding: 'utf8' });
    const worktrees = output.split('\n\n').filter(Boolean);
    return worktrees.length > 1;
  } catch { return false; }
}

/**
 * Stop check guard: fires on Stop.
 * Checks for uncommitted/unpushed work before session end.
 *
 * Modified/staged/deleted files → block (real uncommitted work).
 * Untracked-only files → warn via context (may be orphaned/intentional).
 * Unpushed commits → block (recovery point not preserved).
 *
 * Worktree-aware: if running inside a worktree, checks that worktree's
 * status. If running in the main checkout while other worktrees exist,
 * downgrades blocks to warnings (dirty state may belong to another session).
 */
export async function stopCheckGuard(_input: HookInput, cwd: string): Promise<GuardResult> {
  // Resolve the actual git root — may differ from cwd if inside a worktree
  const gitDir = resolveGitDir(cwd);

  // If the autonomous loop is running, dirty state belongs to it — warn instead of blocking
  let loopRunning = false;
  try {
    const psOut = execSync("pgrep -f 'bash.*slope-loop/(run|continuous|parallel)\\.sh'", { cwd: gitDir, encoding: 'utf8' }).trim();
    loopRunning = psOut.length > 0;
  } catch { /* no matching process */ }

  // Check if other worktrees exist — dirty state in main checkout may belong to another session
  const otherWorktreesExist = hasOtherWorktrees(gitDir);

  const blockingIssues: string[] = [];
  const warningIssues: string[] = [];

  // Check for uncommitted changes (excluding gitignored files)
  try {
    const status = execSync('git status --porcelain 2>/dev/null', { cwd: gitDir, encoding: 'utf8' }).trim();
    if (status.length > 0) {
      const lines = status.split('\n').filter(Boolean);

      // Separate untracked (??) from modified/staged/deleted
      const untrackedPaths: string[] = [];
      const modifiedPaths: string[] = [];
      for (const line of lines) {
        const statusCode = line.slice(0, 2);
        const path = line.slice(3);
        if (statusCode === '??') {
          untrackedPaths.push(path);
        } else {
          modifiedPaths.push(path);
        }
      }

      // Filter out gitignored files from both lists
      const allPaths = [...modifiedPaths, ...untrackedPaths];
      const ignoredSet = new Set<string>();
      if (allPaths.length > 0) {
        try {
          const ignored = execSync(`git check-ignore ${allPaths.map(p => `'${p}'`).join(' ')} 2>/dev/null`, { cwd: gitDir, encoding: 'utf8' }).trim();
          for (const p of ignored.split('\n').filter(Boolean)) {
            ignoredSet.add(p);
          }
        } catch { /* check-ignore exits 1 when no files are ignored — all files are real changes */ }
      }

      const filteredModified = modifiedPaths.filter(p => !ignoredSet.has(p));
      const filteredUntracked = untrackedPaths.filter(p => !ignoredSet.has(p));

      if (filteredModified.length > 0) {
        blockingIssues.push(`${filteredModified.length} uncommitted change${filteredModified.length === 1 ? '' : 's'}`);
      }
      if (filteredUntracked.length > 0) {
        warningIssues.push(`${filteredUntracked.length} untracked file${filteredUntracked.length === 1 ? '' : 's'}`);
      }
    }
  } catch { /* not a git repo */ }

  // Check for unpushed commits
  try {
    const unpushed = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd: gitDir, encoding: 'utf8' }).trim();
    if (unpushed) {
      const lines = unpushed.split('\n').filter(Boolean);
      if (lines.length > 0) {
        blockingIssues.push(`${lines.length} unpushed commit${lines.length === 1 ? '' : 's'}`);
      }
    }
  } catch { /* no upstream */ }

  // Blocking issues take priority — but downgrade to warning if changes belong to another context
  if (blockingIssues.length > 0) {
    const allIssues = [...blockingIssues, ...warningIssues];
    if (loopRunning) {
      return {
        context: `SLOPE: ${allIssues.join(' and ')} detected, but autonomous loop is running — changes belong to the loop.`,
      };
    }
    if (otherWorktreesExist) {
      return {
        context: `SLOPE: ${allIssues.join(' and ')} detected, but other worktrees exist — changes may belong to another session.`,
      };
    }
    return {
      blockReason: `SLOPE: ${allIssues.join(' and ')} detected. Commit and push before stopping to preserve your recovery point.`,
    };
  }

  // Untracked-only: warn but don't block
  if (warningIssues.length > 0) {
    return {
      context: `SLOPE: ${warningIssues.join(' and ')} detected. Consider committing or cleaning up untracked files.`,
    };
  }

  return {};
}
