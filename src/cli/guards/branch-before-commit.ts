import { execSync } from 'node:child_process';
import { QUIET_STDIO } from '../../core/process.js';
import { findCommands } from './command-parse.js';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';

const DEFAULT_PROTECTED = ['main', 'master'];

/**
 * Extract commit message from a command string.
 * Handles inline -m "...", -m '...', and heredoc -m "$(cat <<'EOF'...EOF)"
 */
function extractCommitMessage(command: string): string | undefined {
  // Try heredoc pattern first: -m "$(cat <<'EOF'\n...\nEOF\n)"
  const heredocMatch = command.match(/-m\s+"?\$\(cat\s+<<'?EOF'?\s*\n([\s\S]*?)\nEOF\s*\)"/);
  if (heredocMatch) return heredocMatch[1].trim();

  // Inline -m "..." or -m '...'
  const inlineMatch = command.match(/-m\s+(?:"([^"]+)"|'([^']+)')/);
  return inlineMatch?.[1] ?? inlineMatch?.[2];
}

/**
 * Branch-before-commit guard: fires PreToolUse on Bash.
 * Blocks `git commit` on protected branches — create a feature branch first.
 */
export async function branchBeforeCommitGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire on an actual `git commit`. Parsing rather than matching the raw
  // text keeps `git commit-tree` out and, more importantly, keeps the phrase
  // out when it appears inside a quoted argument or heredoc body (#683).
  if (findCommands(command, ['git', 'commit']).length === 0) return {};

  // Check current branch
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
  } catch {
    // Not a git repo or detached HEAD — allow
    return {};
  }

  // Check against protected branches (configurable, default: main/master)
  const config = loadConfig(cwd);
  const protectedBranches = config.guidance?.protectedBranches ?? DEFAULT_PROTECTED;

  // HEAD means initial repo with no commits — allow
  if (!protectedBranches.includes(branch)) return {};

  // Check allowMainCommitPatterns — let allowlisted messages through
  const patterns = config.guidance?.allowMainCommitPatterns;
  if (patterns && patterns.length > 0) {
    const message = extractCommitMessage(command);
    if (message) {
      for (const pat of patterns) {
        if (new RegExp(pat).test(message)) return {};
      }
    }
  }

  return {
    decision: 'deny',
    blockReason: `BLOCKED: Committing directly on ${branch}. You MUST create a feature branch first:\n  git checkout -b feat/<ticket-or-description>\nThen commit on the new branch. Do NOT retry this commit on ${branch}.`,
    context: `⛔ STOP — Do not commit to ${branch}. Run: git checkout -b feat/<description> first.`,
  };
}
