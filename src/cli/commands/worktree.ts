// slope worktree — Manage persistent git worktrees
// Usage:
//   slope worktree start --branch=<name> [--base=<ref>] [--path=<path>] [--role=secondary] [--ide=<id>] [--target=<claim>]
//   slope worktree status [--base=<ref>] [--touches=<paths>]
//   slope worktree cleanup [--path=<path>] [--all] [--dry-run]

import { execFileSync, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checkConflicts } from '../../core/index.js';
import { QUIET_STDIO } from '../../core/process.js';
import { STALE_SESSION_THRESHOLD_MS } from '../../core/constants.js';
import type { ClaimScope, SprintClaim } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { resolveStore } from '../store.js';
import { collectSiblingWorktreeReality, formatWorktreeRealitySection, parseTouchedPaths } from '../pre-sprint-reality.js';

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

function parseFlagArgs(args: string[]): { flags: Record<string, string>; booleans: Set<string> } {
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();
  for (const arg of args) {
    const match = arg.match(/^--([\w-]+)(?:=(.+))?$/);
    if (!match) continue;
    if (match[2] === undefined) {
      booleans.add(match[1]);
    } else {
      flags[match[1]] = match[2];
    }
  }
  return { flags, booleans };
}

function formatShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function branchSlug(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
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
    const commonDir = execSync('git rev-parse --git-common-dir', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
    const gitDir = execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
    return gitDir !== commonDir && gitDir !== '.git';
  } catch {
    return false;
  }
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function findProjectRoot(cwd: string): string {
  try {
    return gitOutput(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    return cwd;
  }
}

function resolveDefaultBase(projectRoot: string): string {
  try {
    const head = gitOutput(projectRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    if (head) return head.replace('refs/remotes/', '');
  } catch { /* try fallbacks */ }
  for (const ref of ['origin/main', 'main', 'HEAD']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], { cwd: projectRoot, stdio: 'ignore' });
      return ref;
    } catch { /* try next */ }
  }
  return 'HEAD';
}

function isWithinPath(parent: string, target: string): boolean {
  const rel = relative(resolve(parent), resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function warnForInRepoWorktree(projectRoot: string, worktreePath: string): void {
  const managedRoot = join(projectRoot, '.slope', 'worktrees');
  if (!isWithinPath(projectRoot, worktreePath) || isWithinPath(managedRoot, worktreePath)) return;

  console.warn(
    'Warning: Worktree path is inside the repository and may be discovered by parent test or format globs. ' +
    'Prefer a sibling path or the managed .slope/worktrees directory.',
  );
}

async function startCommand(args: string[]): Promise<void> {
  const { flags, booleans } = parseFlagArgs(args);
  const cwd = process.cwd();
  const projectRoot = findProjectRoot(cwd);

  if (isInsideWorktree(cwd)) {
    console.error('Error: Already inside a secondary worktree. Start new worktrees from the primary checkout.');
    process.exit(1);
  }

  const branch = flags.branch;
  if (!branch) {
    console.error('Error: --branch=<name> is required');
    process.exit(1);
  }

  const base = flags.base ?? resolveDefaultBase(projectRoot);
  const worktreePath = resolve(projectRoot, flags.path ?? join('.slope', 'worktrees', branchSlug(branch)));
  warnForInRepoWorktree(projectRoot, worktreePath);
  if (existsSync(worktreePath)) {
    console.error(`Error: Worktree path already exists: ${worktreePath}`);
    process.exit(1);
  }

  const dryRun = booleans.has('dry-run');
  if (dryRun) {
    console.log(`[dry-run] git worktree add ${formatShellArg(worktreePath)} -b ${formatShellArg(branch)} ${formatShellArg(base)}`);
    console.log(`[dry-run] register session role=${flags.role ?? 'secondary'} ide=${flags.ide ?? process.env.SLOPE_IDE ?? 'unknown'} branch=${branch}`);
    if (flags.target) console.log(`[dry-run] claim ${flags.target} (${flags.scope ?? 'ticket'})`);
    return;
  }

  mkdirSync(dirname(worktreePath), { recursive: true });
  execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch, base], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  const store = await resolveStore(projectRoot);
  try {
    await store.cleanStaleSessions(STALE_SESSION_THRESHOLD_MS);
    const sessionId = flags['session-id'] || randomUUID();
    const role = (flags.role ?? 'secondary') as 'primary' | 'secondary' | 'observer';
    const ide = flags.ide ?? process.env.SLOPE_IDE ?? 'unknown';
    const session = await store.registerSession({
      session_id: sessionId,
      role,
      ide,
      branch,
      worktree_path: worktreePath,
    });

    let claim: SprintClaim | null = null;
    if (flags.target) {
      const config = loadConfig(projectRoot);
      const sprintNumber = flags.sprint ? parseInt(flags.sprint, 10) : inferSprintContext(projectRoot, config).sprint;
      const scope = (flags.scope ?? 'ticket') as ClaimScope;
      const player = flags.player || process.env.USER || 'unknown';
      const pendingClaim: SprintClaim = {
        id: '__pending__',
        sprint_number: sprintNumber,
        player,
        target: flags.target,
        scope,
        claimed_at: new Date().toISOString(),
        session_id: session.session_id,
        ...(flags.notes ? { notes: flags.notes } : {}),
      };
      const conflicts = checkConflicts([...(await store.list(sprintNumber)), pendingClaim]);
      const overlaps = conflicts.filter(c => c.severity === 'overlap');
      if (overlaps.length > 0 && !booleans.has('force')) {
        console.error(`\nClaim blocked — overlap conflict(s) detected:`);
        for (const c of overlaps) console.error(`  [!!] ${c.reason}`);
        console.error(`\nWorktree and session were created. Re-run claim with --force if this overlap is intentional.`);
      } else {
        claim = await store.claim({
          sprint_number: sprintNumber,
          player,
          target: flags.target,
          scope,
          session_id: session.session_id,
          ...(flags.notes ? { notes: flags.notes } : {}),
        });
      }
    }

    console.log(`\nWorktree started:`);
    console.log(`  Path:    ${worktreePath}`);
    console.log(`  Branch:  ${branch}`);
    console.log(`  Base:    ${base}`);
    console.log(`  Session: ${session.session_id} [${session.role}] ${session.ide}`);
    console.log(`  State:   shared from primary checkout`);
    if (claim) console.log(`  Claim:   ${claim.target} (${claim.scope}) sprint ${claim.sprint_number}`);
    console.log(`\nNext:`);
    console.log(`  cd ${formatShellArg(worktreePath)}`);
    console.log('');
  } finally {
    store.close();
  }
}

/** Check if gh CLI is available */
function hasGhCli(): boolean {
  try {
    execFileSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Check if a branch's PR is merged */
function isPrMerged(branch: string): boolean {
  try {
    const result = execFileSync(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'url', '--limit', '1'],
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
    execFileSync('git', ['worktree', 'remove', wt.path, '--force'], { encoding: 'utf8', stdio: 'pipe' });
    console.log(`  Removed worktree: ${wt.path}`);
  } catch (err) {
    console.error(`  Error removing worktree ${wt.path}: ${(err as Error).message}`);
    return false;
  }

  // Delete local branch
  if (branch) {
    try {
      execFileSync('git', ['branch', '-d', branch], { encoding: 'utf8', stdio: 'pipe' });
      console.log(`  Deleted branch: ${branch}`);
    } catch { /* branch already deleted or not fully merged — ignore */ }

    // Delete remote branch
    try {
      execFileSync('git', ['push', 'origin', '--delete', branch], { encoding: 'utf8', stdio: 'pipe' });
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

function statusCommand(args: string[]): void {
  const { flags } = parseFlagArgs(args);
  const cwd = process.cwd();
  const touchedPaths = parseTouchedPaths(flags.touches);
  const worktrees = collectSiblingWorktreeReality(cwd, flags.base);
  const lines = formatWorktreeRealitySection(worktrees, touchedPaths);

  if (lines.length === 0) {
    console.log('No sibling worktrees found.');
    return;
  }

  console.log(lines.join('\n'));
}

export async function worktreeCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const help = args.includes('--help') || args.includes('-h');

  if (!help && sub === 'start') {
    return startCommand(args.slice(1));
  }

  if (!help && sub === 'cleanup') {
    return cleanupCommand(args.slice(1));
  }

  if (!help && (sub === 'status' || sub === 'list')) {
    statusCommand(args.slice(1));
    return;
  }

  if (help || !sub) {
    console.log(`
slope worktree — Manage git worktrees

Usage:
  slope worktree start --branch=<name> [--base=<ref>] [--path=<path>] [--role=secondary] [--ide=<id>] [--target=<claim>]
  slope worktree status [--base=<ref>] [--touches=<paths>]
  slope worktree cleanup [--path=<path>] [--all] [--dry-run]

Options:
  start:
    --branch=<name>      New branch name for the worktree
    --base=<ref>         Base ref (default: origin default branch, main, or HEAD)
    --path=<path>        Worktree path (default: .slope/worktrees/<branch>, outside Claude Code's protected .claude/ tree)
    --role=<role>        Session role: primary, secondary, observer (default: secondary)
    --ide=<id>           IDE/harness id (default: SLOPE_IDE or unknown)
    --target=<claim>     Optional ticket or area claim to register
    --scope=<scope>      Claim scope: ticket or area (default: ticket)
    --sprint=<number>    Sprint number for optional claim
    --dry-run            Preview worktree/session/claim actions

  cleanup:
  --path=<path>  Target a specific worktree
  --all          Clean up all secondary worktrees
  --dry-run      Preview what would happen without making changes

  status:
    --base=<ref>       Base ref for ahead/behind and changed-file detection (default: origin/main, main, master, HEAD)
    --touches=<paths>  Comma-separated paths to check for direct overlap

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
