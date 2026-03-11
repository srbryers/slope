import { execSync } from 'node:child_process';
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

  // Check against protected branches (configurable, default: main/master)
  const config = loadConfig();
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
    blockReason: `Committing directly on ${branch} is blocked. Create a feature branch first:\n  git checkout -b feat/<ticket-or-description>\nThen commit on the new branch.`,
  };
}
