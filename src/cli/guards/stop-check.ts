import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Stop check guard: fires on Stop.
 * Checks for uncommitted/unpushed work before session end.
 *
 * Modified/staged/deleted files → block (real uncommitted work).
 * Untracked-only files → warn via context (may be orphaned/intentional).
 * Unpushed commits → block (recovery point not preserved).
 */
export async function stopCheckGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const blockingIssues: string[] = [];
  const warningIssues: string[] = [];

  // Check for uncommitted changes (excluding gitignored files)
  try {
    const status = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
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
          const ignored = execSync(`git check-ignore ${allPaths.map(p => `'${p}'`).join(' ')} 2>/dev/null`, { cwd, encoding: 'utf8' }).trim();
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
    const unpushed = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    if (unpushed) {
      const lines = unpushed.split('\n').filter(Boolean);
      if (lines.length > 0) {
        blockingIssues.push(`${lines.length} unpushed commit${lines.length === 1 ? '' : 's'}`);
      }
    }
  } catch { /* no upstream */ }

  // Blocking issues take priority
  if (blockingIssues.length > 0) {
    const allIssues = [...blockingIssues, ...warningIssues];
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
