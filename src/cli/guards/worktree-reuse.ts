import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';

const SAFE_WORKTREE_DIR = '.slope/worktrees';
const CLAUDE_PROTECTED_WORKTREE_DIR = '.claude/worktrees';

/**
 * Worktree-reuse guard: fires PreToolUse on EnterWorktree.
 * When the requested worktree name already exists, injects context
 * guiding the agent to reuse it (with sync commands) instead of
 * letting EnterWorktree fail on duplicate creation.
 */
export async function worktreeReuseGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const name = input.tool_input?.name as string | undefined;
  if (!name) return {};

  // Check if a worktree with this name already exists
  const projectDir = resolveProjectDir(cwd);
  const safeWorktreePath = join(projectDir, SAFE_WORKTREE_DIR, name);
  const existing = findExistingWorktree(projectDir, name);

  if (!existing) return {};

  // Worktree exists — check its state
  const { path: worktreePath, isClaudeProtected } = existing;
  let branch = 'unknown';
  let behind = 0;
  let baseBranch = 'main';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();
    // Detect base branch
    for (const candidate of ['main', 'master']) {
      try {
        execSync(`git rev-parse --verify origin/${candidate}`, { cwd: worktreePath, encoding: 'utf8', stdio: 'pipe' });
        baseBranch = candidate;
        break;
      } catch { /* try next */ }
    }
    // Check how far behind
    try {
      execSync('git fetch origin --quiet', { cwd: worktreePath, encoding: 'utf8', timeout: 10000 });
      const count = execSync(
        `git rev-list HEAD..origin/${baseBranch} --count`,
        { cwd: worktreePath, encoding: 'utf8' },
      ).trim();
      behind = parseInt(count, 10) || 0;
    } catch { /* fetch failed — offline, skip sync info */ }
  } catch { /* not a valid git dir — let EnterWorktree handle the error */ }

  const syncHint = behind > 0
    ? `\n\nThe worktree is ${behind} commit(s) behind origin/${baseBranch}. To sync:\n  cd "${worktreePath}" && git rebase origin/${baseBranch}`
    : '';

  if (isClaudeProtected) {
    const branchArg = branch === 'unknown' ? '<branch>' : branch;
    return {
      decision: 'deny',
      blockReason: [
        `SLOPE: Worktree "${name}" already exists under Claude Code's protected config tree: ${worktreePath} (branch: ${branch}).`,
        '',
        `Claude Code treats paths under .claude/ as self-configuration edits, so ordinary source edits there can prompt on every Edit/Write.`,
        '',
        `Prefer SLOPE worktrees outside .claude/:`,
        `  slope worktree start --branch=${branchArg} --path="${join(SAFE_WORKTREE_DIR, name)}" --role=secondary --ide=claude-code`,
        '',
        `To relocate the existing worktree:`,
        `  mkdir -p "${join(projectDir, SAFE_WORKTREE_DIR)}" && git worktree move "${worktreePath}" "${safeWorktreePath}"`,
        syncHint,
      ].join('\n'),
    };
  }

  return {
    decision: 'deny',
    blockReason: [
      `SLOPE: Worktree "${name}" already exists at ${worktreePath} (branch: ${branch}).`,
      '',
      `To reuse it, use Bash to change directory:`,
      `  cd "${worktreePath}"`,
      syncHint,
      '',
      `To create a fresh worktree, use a different name or remove the existing one:`,
      `  git worktree remove "${worktreePath}"`,
    ].join('\n'),
  };
}

function findExistingWorktree(projectDir: string, name: string): { path: string; isClaudeProtected: boolean } | null {
  const candidates = [
    { path: join(projectDir, SAFE_WORKTREE_DIR, name), isClaudeProtected: false },
    { path: join(projectDir, CLAUDE_PROTECTED_WORKTREE_DIR, name), isClaudeProtected: true },
  ];
  return candidates.find(candidate => existsSync(candidate.path)) ?? null;
}

/** Resolve the project root (handles being inside a worktree) */
function resolveProjectDir(cwd: string): string {
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { cwd, encoding: 'utf8' }).trim();
    if (commonDir === '.git') return cwd;
    // In a worktree — commonDir is like ../../.git, resolve to project root
    const gitDir = join(cwd, commonDir);
    // gitDir is the .git dir of the main repo — parent is the project root
    return join(gitDir, '..');
  } catch {
    return cwd;
  }
}

/** List existing persistent worktrees with status info */
export function listWorktrees(cwd: string): Array<{ name: string; path: string; branch: string; behind: number }> {
  const projectDir = resolveProjectDir(cwd);
  const worktreeDirs = [
    join(projectDir, SAFE_WORKTREE_DIR),
    join(projectDir, CLAUDE_PROTECTED_WORKTREE_DIR),
  ].filter(path => existsSync(path));

  const entries = worktreeDirs.flatMap(worktreeDir =>
    readdirSync(worktreeDir)
      .filter(name => statSync(join(worktreeDir, name)).isDirectory())
      .map(name => ({ name, fullPath: join(worktreeDir, name) })),
  );

  return entries.map(({ name, fullPath }) => {
    let branch = 'unknown';
    let behind = 0;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: fullPath, encoding: 'utf8' }).trim();
      const count = execSync('git rev-list HEAD..origin/main --count 2>/dev/null', { cwd: fullPath, encoding: 'utf8' }).trim();
      behind = parseInt(count, 10) || 0;
    } catch { /* not a valid git worktree */ }
    return { name, path: fullPath, branch, behind };
  });
}
