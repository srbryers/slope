import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * Stop check guard: fires on Stop.
 * Checks for uncommitted/unpushed work before session end.
 */
export async function stopCheckGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const issues: string[] = [];

  // Check for uncommitted changes
  try {
    const status = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    if (status.length > 0) {
      const lines = status.split('\n').filter(Boolean);
      issues.push(`${lines.length} uncommitted change${lines.length === 1 ? '' : 's'}`);
    }
  } catch { /* not a git repo */ }

  // Check for unpushed commits
  try {
    const unpushed = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    if (unpushed) {
      const lines = unpushed.split('\n').filter(Boolean);
      if (lines.length > 0) {
        issues.push(`${lines.length} unpushed commit${lines.length === 1 ? '' : 's'}`);
      }
    }
  } catch { /* no upstream */ }

  if (issues.length === 0) return {};

  return {
    blockReason: `SLOPE: ${issues.join(' and ')} detected. Commit and push before stopping to preserve your recovery point.`,
  };
}
