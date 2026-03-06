import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { headIsOnMain } from './git-utils.js';

/**
 * Push nudge guard: fires PostToolUse on Bash.
 * Nudges to push after git commit commands when unpushed count or time is high.
 */
export async function pushNudgeGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire after git commit commands
  if (!command.includes('git commit')) return {};

  const config = loadConfig();
  const guidance = config.guidance ?? {};
  const pushCommitThreshold = guidance.pushCommitThreshold ?? 5;
  const pushInterval = guidance.pushInterval ?? 30;

  const nudges: string[] = [];

  // Check if on main/master — always nudge (should push or switch branch)
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    if (branch === 'main' || branch === 'master') {
      nudges.push(`Committing directly on ${branch} — consider pushing or switching to a feature branch.`);
    }
  } catch { /* not a git repo */ }

  // Check unpushed commit count (skip if HEAD is at origin/main — tracking branch may be stale)
  if (!headIsOnMain(cwd)) {
    try {
      const unpushed = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
      if (unpushed) {
        const count = unpushed.split('\n').filter(Boolean).length;
        if (count >= pushCommitThreshold) {
          nudges.push(`${count} unpushed commits — push to preserve your recovery point.`);
        }
      }
    } catch { /* no upstream */ }

    // Check time since oldest unpushed commit
    try {
      const oldest = execSync('git log @{u}..HEAD --format=%ct --reverse 2>/dev/null', { cwd, encoding: 'utf8' }).trim().split('\n')[0];
      if (oldest) {
        const minutesSince = (Date.now() / 1000 - parseInt(oldest, 10)) / 60;
        if (minutesSince >= pushInterval) {
          nudges.push(`~${Math.round(minutesSince)} minutes since oldest unpushed commit — push now.`);
        }
      }
    } catch { /* no upstream */ }
  }

  if (nudges.length === 0) return {};

  return {
    context: `SLOPE push discipline:\n${nudges.map(n => `  ${n}`).join('\n')}`,
  };
}
