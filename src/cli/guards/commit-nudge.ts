import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { headIsOnMain } from './git-utils.js';
import { dedupGuardContext } from '../session-state.js';

/**
 * Commit nudge guard: fires PostToolUse on Edit|Write.
 * Nudges to commit/push after prolonged editing.
 */
export async function commitNudgeGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig();
  const commitInterval = config.guidance?.commitInterval ?? 15;
  const pushInterval = config.guidance?.pushInterval ?? 30;

  const nudges: string[] = [];

  // Check time since last commit
  try {
    const lastCommitTime = execSync('git log -1 --format=%ct 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    if (lastCommitTime) {
      const minutesSinceCommit = (Date.now() / 1000 - parseInt(lastCommitTime, 10)) / 60;

      // Check for uncommitted changes (excluding gitignored files)
      const status = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
      let hasChanges = status.length > 0;
      if (hasChanges) {
        const paths = status.split('\n').filter(Boolean).map(l => l.slice(3));
        try {
          const ignored = execSync(`git check-ignore ${paths.map(p => `'${p}'`).join(' ')} 2>/dev/null`, { cwd, encoding: 'utf8' }).trim();
          const ignoredSet = new Set(ignored.split('\n').filter(Boolean));
          hasChanges = paths.some(p => !ignoredSet.has(p));
        } catch { /* check-ignore exits 1 when no files are ignored — all files are real changes */ }
      }

      if (hasChanges && minutesSinceCommit >= commitInterval) {
        nudges.push(`~${Math.round(minutesSinceCommit)} minutes since last commit — consider committing current progress.`);
      }
    }
  } catch { /* not a git repo or git not available */ }

  // Check time since last push (skip if HEAD is at origin/main — tracking branch may be stale)
  if (!headIsOnMain(cwd)) {
    try {
      const unpushed = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
      if (unpushed) {
        const lines = unpushed.split('\n').filter(Boolean);
        if (lines.length > 0) {
          // Get age of oldest unpushed commit
          const oldestUnpushedTime = execSync('git log @{u}..HEAD --format=%ct --reverse 2>/dev/null', { cwd, encoding: 'utf8' }).trim().split('\n')[0];
          if (oldestUnpushedTime) {
            const minutesSincePush = (Date.now() / 1000 - parseInt(oldestUnpushedTime, 10)) / 60;
            if (minutesSincePush >= pushInterval) {
              nudges.push(`${lines.length} unpushed commit${lines.length === 1 ? '' : 's'} (~${Math.round(minutesSincePush)} min) — consider pushing.`);
            }
          }
        }
      }
    } catch { /* no upstream or git not available */ }
  }

  if (nudges.length === 0) return {};

  const ctx = `SLOPE commit discipline:\n${nudges.map(n => `  ${n}`).join('\n')}`;
  const dedup = dedupGuardContext(cwd, input.session_id, 'commit-nudge', ctx);
  return { context: dedup ?? ctx };
}
