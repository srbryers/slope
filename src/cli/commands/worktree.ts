// slope worktree cleanup — Clean up stale git worktrees
// Usage: slope worktree cleanup [--path=<path>] [--all] [--dry-run]

import { execSync } from 'node:child_process';

interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

function parseArgs(args: string[]): {
  subcommand: string | null;
  targetPath: string | null;
  all: boolean;
  dryRun: boolean;
} {
  let subcommand: string | null = null;
  let targetPath: string | null = null;
  let all = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--all') {
      all = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--path=')) {
      targetPath = arg.slice('--path='.length);
    } else if (!arg.startsWith('-')) {
      subcommand = arg;
    }
  }

  return { subcommand, targetPath, all, dryRun };
}

/** Parse `git worktree list --porcelain` output */
function listWorktrees(cwd: string): WorktreeInfo[] {
  let output: string;
  try {
    output = execSync('git worktree list --porcelain', { cwd, encoding: 'utf8' });
  } catch {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current as WorktreeInfo);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      // refs/heads/feat/foo → feat/foo
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path) worktrees.push(current as WorktreeInfo);
      current = {};
    }
  }
  if (current.path) worktrees.push(current as WorktreeInfo);

  return worktrees;
}

/** Check if we're currently inside a worktree */
function isInsideWorktree(cwd: string): boolean {
  try {
    const commonDir = execSync('git rev-parse --git-common-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    const gitDir = execSync('git rev-parse --git-dir 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    return gitDir !== commonDir && gitDir !== '.git';
  } catch {
    return false;
  }
}

/** Check if gh CLI is available */
function hasGhCli(): boolean {
  try {
    execSync('gh --version', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Check if a branch's PR is merged */
function isPrMerged(branch: string): boolean {
  try {
    const result = execSync(
      `gh pr list --head "${branch}" --state merged --json url --limit 1`,
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const prs = JSON.parse(result);
    return Array.isArray(prs) && prs.length > 0;
  } catch {
    return false;
  }
}

function cleanupWorktree(wt: WorktreeInfo, dryRun: boolean, ghAvailable: boolean): boolean {
  const branch = wt.branch || '';

  if (ghAvailable && branch) {
    const merged = isPrMerged(branch);
    if (!merged) {
      console.log(`  Skip: ${wt.path} (branch "${branch}" — PR not merged)`);
      return false;
    }
  }

  if (dryRun) {
    console.log(`  [dry-run] Would remove worktree: ${wt.path}`);
    if (branch) {
      console.log(`  [dry-run] Would delete branch: ${branch}`);
      console.log(`  [dry-run] Would delete remote branch: origin/${branch}`);
    }
    return true;
  }

  // Remove worktree
  try {
    execSync(`git worktree remove "${wt.path}" --force`, { encoding: 'utf8', stdio: 'pipe' });
    console.log(`  Removed worktree: ${wt.path}`);
  } catch (err) {
    console.error(`  Error removing worktree ${wt.path}: ${(err as Error).message}`);
    return false;
  }

  // Delete local branch
  if (branch) {
    try {
      execSync(`git branch -d "${branch}"`, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`  Deleted branch: ${branch}`);
    } catch { /* branch already deleted or not fully merged — ignore */ }

    // Delete remote branch
    try {
      execSync(`git push origin --delete "${branch}"`, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`  Deleted remote branch: origin/${branch}`);
    } catch { /* remote branch already gone — ignore */ }
  }

  return true;
}

async function cleanupCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();

  // Safety: block if running from inside a worktree
  if (isInsideWorktree(cwd)) {
    console.error('Error: Cannot run worktree cleanup from inside a worktree.');
    console.error('Call ExitWorktree first to return to the main repo, then retry.');
    process.exit(1);
  }

  const allWorktrees = listWorktrees(cwd);
  if (allWorktrees.length === 0) {
    console.log('No worktrees found.');
    return;
  }

  // First entry is the main worktree — skip it
  const mainPath = allWorktrees[0]?.path;
  const secondaryWorktrees = allWorktrees.filter(wt => wt.path !== mainPath);

  if (secondaryWorktrees.length === 0) {
    console.log('No secondary worktrees to clean up.');
    return;
  }

  // Determine targets
  let targets: WorktreeInfo[];
  if (flags.targetPath) {
    const found = secondaryWorktrees.find(wt => wt.path === flags.targetPath || wt.path.endsWith(flags.targetPath!));
    if (!found) {
      console.error(`Worktree not found: ${flags.targetPath}`);
      console.error('Available worktrees:');
      for (const wt of secondaryWorktrees) {
        console.error(`  ${wt.path} [${wt.branch || 'detached'}]`);
      }
      process.exit(1);
    }
    targets = [found];
  } else if (flags.all) {
    targets = secondaryWorktrees;
  } else {
    console.error('Error: Specify --path=<path> or --all');
    console.error('Available worktrees:');
    for (const wt of secondaryWorktrees) {
      console.error(`  ${wt.path} [${wt.branch || 'detached'}]`);
    }
    process.exit(1);
  }

  const ghAvailable = hasGhCli();
  if (!ghAvailable) {
    console.log('Note: gh CLI not found — skipping PR merge checks');
  }

  let cleaned = 0;
  for (const wt of targets) {
    if (cleanupWorktree(wt, flags.dryRun, ghAvailable)) {
      cleaned++;
    }
  }

  if (flags.dryRun) {
    console.log(`\n${cleaned} worktree(s) would be cleaned.`);
  } else {
    console.log(`\nCleaned ${cleaned} worktree(s).`);
  }
}

export async function worktreeCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === 'cleanup') {
    return cleanupCommand(args.slice(1));
  }

  if (args.includes('--help') || args.includes('-h') || !sub) {
    console.log(`
slope worktree — Manage git worktrees

Usage:
  slope worktree cleanup [--path=<path>] [--all] [--dry-run]

Options:
  --path=<path>  Target a specific worktree
  --all          Clean up all secondary worktrees
  --dry-run      Preview what would happen without making changes

For each worktree, cleanup will:
  1. Check if the branch's PR is merged (requires gh CLI)
  2. Remove the worktree (git worktree remove)
  3. Delete the local branch (git branch -d)
  4. Delete the remote branch (git push origin --delete)
`);
    return;
  }

  console.error(`Unknown subcommand: ${sub}. Run slope worktree --help for usage.`);
  process.exit(1);
}
