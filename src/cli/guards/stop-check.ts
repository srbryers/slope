import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { headIsOnMain, loadBaseline, removeBaseline } from './git-utils.js';
import { resolveStore } from '../store.js';
import { resetWorktreeCheckState } from './worktree-check.js';

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
 * Check if the session is in the main checkout (not a worktree).
 * In the main checkout, --git-common-dir returns '.git' (relative).
 * In a worktree, it returns an absolute path to the main repo's .git.
 */
function isMainCheckout(cwd: string): boolean {
  try {
    const commonDir = execSync('git rev-parse --git-common-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    return commonDir === '.git';
  } catch { return true; }
}

/**
 * Check if other worktrees exist beyond the main checkout.
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
 * downgrades uncommitted-change blocks to warnings (dirty state may belong
 * to another session). Unpushed commits always block — they're branch-specific.
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

  // Only downgrade dirty-state blocks when we're in the main checkout and other worktrees exist.
  // Worktree sessions own their own dirty state — no downgrade for them.
  const inMainCheckout = isMainCheckout(gitDir);
  const otherWorktreesExist = inMainCheckout && hasOtherWorktrees(gitDir);

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

      // Separate session changes from pre-existing dirty files using baseline
      const baseline = loadBaseline(_input.session_id, cwd);
      const sessionModified = filteredModified.filter(p => !baseline.has(p));
      const sessionUntracked = filteredUntracked.filter(p => !baseline.has(p));
      const preExistingCount = (filteredModified.length - sessionModified.length) +
        (filteredUntracked.length - sessionUntracked.length);

      if (sessionModified.length > 0) {
        warningIssues.push(`${sessionModified.length} uncommitted change${sessionModified.length === 1 ? '' : 's'}`);
      }
      // Untracked files are informational only — don't block session end
      // (agents frequently create temp files, .slope state files, etc.)
      if (preExistingCount > 0) {
        warningIssues.push(`${preExistingCount} pre-existing dirty file${preExistingCount === 1 ? '' : 's'} (not from this session)`);
      }
    }
  } catch { /* not a git repo */ }

  // Check for unpushed commits
  // Use origin/<branch> explicitly + --first-parent to avoid counting merge ancestors
  // in worktrees (#255: git log @{u}..HEAD traverses merged branch history)
  if (!headIsOnMain(gitDir)) {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: gitDir, encoding: 'utf8' }).trim();
      const remoteRef = `origin/${branch}`;
      // Verify remote ref exists before comparing
      const hasRemote = (() => { try { execSync(`git rev-parse --verify ${remoteRef} 2>/dev/null`, { cwd: gitDir, encoding: 'utf8' }); return true; } catch { return false; } })();
      if (hasRemote) {
        const unpushed = execSync(`git rev-list ${remoteRef}..HEAD --first-parent --count 2>/dev/null`, { cwd: gitDir, encoding: 'utf8' }).trim();
        const count = parseInt(unpushed, 10) || 0;
        if (count > 0) {
          blockingIssues.push(`${count} unpushed commit${count === 1 ? '' : 's'}`);
        }
      }
    } catch { /* no upstream */ }
  }

  // Blocking issues take priority — but downgrade to warning if changes belong to another context
  if (blockingIssues.length > 0) {
    const allIssues = [...blockingIssues, ...warningIssues];
    if (loopRunning) {
      return {
        context: `SLOPE: ${allIssues.join(' and ')} detected, but autonomous loop is running — changes belong to the loop.`,
      };
    }
    if (otherWorktreesExist) {
      // Unpushed commits are branch-specific — always block. Only downgrade uncommitted changes.
      const unpushedBlocks = blockingIssues.filter(i => i.includes('unpushed'));
      const uncommittedBlocks = blockingIssues.filter(i => !i.includes('unpushed'));
      if (unpushedBlocks.length > 0) {
        return {
          blockReason: `SLOPE: ${unpushedBlocks.join(' and ')} detected. Push before stopping to preserve your recovery point.` +
            (uncommittedBlocks.length > 0 ? ` (${uncommittedBlocks.join(' and ')} may belong to another session)` : ''),
        };
      }
      // All blocking issues are uncommitted changes — downgrade to warning
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
    removeBaseline(_input.session_id, cwd);
    return {
      context: `SLOPE: ${warningIssues.join(' and ')} detected. Consider committing before stopping.`,
    };
  }

  // Clean session — remove baseline
  removeBaseline(_input.session_id, cwd);

  // Clean up session from store and sentinel file
  if (_input.session_id) {
    try {
      const store = await resolveStore(cwd);
      try {
        await store.removeSession(_input.session_id);
      } finally {
        try { store.close(); } catch { /* ignore */ }
      }
    } catch { /* store unavailable — session will expire via TTL */ }

    resetWorktreeCheckState(_input.session_id);
  }

  return {};
}
