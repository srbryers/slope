import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';

/**
 * Branch-before-commit guard: fires PreToolUse on Bash.
 * Blocks `git commit` on main/master — create a feature branch first.
 */
export async function branchBeforeCommitGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire on git commit (word-boundary: avoid git commit-tree etc.)
  if (!/git\s+commit(\s|$)/.test(command)) return {};

  // Check current branch
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
  } catch {
    // Not a git repo or detached HEAD — allow
    return {};
  }

  // Only block on main/master (HEAD means initial repo with no commits)
  if (branch !== 'main' && branch !== 'master') return {};

  // Check allowMainCommitPatterns — let allowlisted messages through
  const config = loadConfig();
  const patterns = config.guidance?.allowMainCommitPatterns;
  if (patterns && patterns.length > 0) {
    // Extract commit message from -m "..." or -m '...'
    const msgMatch = command.match(/-m\s+(?:"([^"]+)"|'([^']+)')/);
    const message = msgMatch?.[1] ?? msgMatch?.[2];
    if (message) {
      for (const pat of patterns) {
        if (new RegExp(pat).test(message)) return {};
      }
    }
  }

  return {
    decision: 'deny',
    blockReason: `Committing directly on ${branch} is blocked. Create a feature branch first:\n  git checkout -b feat/<ticket-or-description>\nThen commit on the new branch.`,
  };
}
