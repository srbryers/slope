import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * slope version bump [<version>] [--dry-run]
 *
 * Automates the version bump + PR + merge workflow:
 * 1. Sync to origin/main (handles post-squash-merge divergence)
 * 2. Determine next version (minor bump if not specified)
 * 3. Run version-bump script
 * 4. Create branch, commit, push, PR, merge
 * 5. Clean up branch and sync
 */
export async function versionCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === 'bump') {
    await versionBump(args.slice(1));
    return;
  }

  if (sub === 'recommend') {
    await versionRecommend(process.cwd());
    return;
  }

  if (sub === '--help' || sub === '-h') {
    console.log(`
slope version                                              Show current version
slope version bump [<version>] [--patch|--major] [--dry-run]  Bump version, create PR, merge
slope version recommend                                    Analyze commits and recommend version tier
`);
    return;
  }

  // Default: show current version
  const cwd = process.cwd();
  const version = getCurrentVersion(cwd);
  console.log(`@slope-dev/slope v${version ?? 'unknown'}`);
}

async function versionBump(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const dryRun = args.includes('--dry-run');

  // Preflight: check gh CLI is available and authenticated
  try {
    run('gh auth status', cwd);
  } catch {
    throw new Error('gh CLI is not installed or not authenticated. Run `gh auth login` first.');
  }

  // 1. Sync to origin/main
  syncToMain(cwd);

  // 2. Determine version (anchored regex prevents shell injection)
  // Priority: explicit version arg > --major > --patch > default (minor)
  const currentVersion = getCurrentVersion(cwd);
  const explicitVersion = args.find(a => /^\d+\.\d+\.\d+$/.test(a));
  const patchFlag = args.includes('--patch');
  const majorFlag = args.includes('--major');

  let targetVersion: string;
  if (explicitVersion) {
    targetVersion = explicitVersion;
  } else if (majorFlag) {
    targetVersion = bumpMajor(currentVersion);
  } else if (patchFlag) {
    targetVersion = bumpPatch(currentVersion);
  } else {
    targetVersion = bumpMinor(currentVersion);
  }

  console.log(`\nSLOPE Release: ${currentVersion} → ${targetVersion}`);

  if (dryRun) {
    console.log('  [dry-run] Would create branch, bump version, PR, and merge.');
    return;
  }

  // 3. Create branch and bump version
  const branch = `chore/bump-${targetVersion}`;
  run(`git checkout -b ${branch}`, cwd);
  run(`node scripts/version-bump.mjs ${targetVersion}`, cwd);

  // 4. Commit and push (stage all changes from version-bump, not just root package.json)
  run('git add package.json', cwd);
  run(`git commit -m "chore: bump version to ${targetVersion}" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"`, cwd);
  run(`git push -u origin ${branch}`, cwd);

  // 5. Create PR and merge (with rollback on failure)
  let prCreated = false;
  try {
    const prUrl = run(
      `gh pr create --title "chore: bump version to ${targetVersion}" --body "Version bump ${currentVersion} to ${targetVersion}"`,
      cwd,
    ).trim();
    prCreated = true;
    console.log(`  PR: ${prUrl}`);

    run('gh pr merge --squash', cwd);
    console.log('  Merged.');
  } catch (err) {
    // Clean up on failure — switch back to main so user isn't stranded
    console.error(`\n  Release failed: ${(err as Error).message}`);
    try { run('git checkout main 2>/dev/null || git checkout -', cwd); } catch { /* best effort */ }
    console.error(`\n  Recovery steps:`);
    console.error(`    git checkout main`);
    if (prCreated) {
      console.error(`    gh pr close ${branch}`);
    }
    console.error(`    git branch -D ${branch}`);
    console.error(`    git push origin --delete ${branch}`);
    throw err;
  }

  // 6. Clean up — sync back to main
  syncToMain(cwd);
  try { run(`git branch -D ${branch}`, cwd); } catch { /* already gone */ }
  try { run(`git push origin --delete ${branch}`, cwd); } catch { /* already deleted */ }

  console.log(`\n  Released v${targetVersion}`);
}

/**
 * Sync current HEAD to origin/main.
 * Handles the post-squash-merge divergence that causes rebase conflicts:
 * after a PR is squash-merged, the worktree branch has stale pre-squash
 * commits. A rebase would create conflicts. Reset is correct.
 *
 * Safety: only resets if HEAD is at or behind origin/main (ancestor check).
 * If HEAD has local-only commits ahead of main, aborts to prevent data loss.
 */
function syncToMain(cwd: string): void {
  run('git fetch origin main', cwd);

  const status = run('git status --porcelain', cwd).trim();
  if (status) {
    throw new Error(`Working directory is not clean:\n${status}\nCommit or stash changes before releasing.`);
  }

  // Check if HEAD has local-only commits that aren't on origin/main
  // merge-base --is-ancestor HEAD origin/main → exits 0 if HEAD is at or behind main
  try {
    execSync('git merge-base --is-ancestor HEAD origin/main 2>/dev/null', { cwd, encoding: 'utf8' });
  } catch {
    // HEAD is ahead of origin/main — check if it's a squash-merge divergence or real work
    // If origin/main is an ancestor of HEAD, there are local-only commits
    try {
      execSync('git merge-base --is-ancestor origin/main HEAD 2>/dev/null', { cwd, encoding: 'utf8' });
      // origin/main IS ancestor of HEAD — there are unpushed commits
      const unpushed = execSync('git log origin/main..HEAD --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
      throw new Error(
        `Cannot sync to main — ${unpushed.split('\n').length} unpushed commit(s) would be lost:\n${unpushed}\n` +
        'Push or stash these commits first, or use `git reset --hard origin/main` manually if they are stale.'
      );
    } catch (innerErr) {
      // If the inner merge-base also failed, branches have diverged (squash-merge case)
      // In this case, reset is safe — the squashed content is already on main
      if ((innerErr as Error).message?.includes('Cannot sync')) throw innerErr;
      // Diverged branches — safe to reset (squash-merge artifact)
    }
  }

  run('git reset --hard origin/main', cwd);
}

function getCurrentVersion(cwd: string): string {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  return pkg.version;
}

function bumpPatch(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2]++;
  return parts.join('.');
}

function bumpMinor(version: string): string {
  const parts = version.split('.').map(Number);
  parts[1]++;
  parts[2] = 0;
  return parts.join('.');
}

function bumpMajor(version: string): string {
  const parts = version.split('.').map(Number);
  parts[0]++;
  parts[1] = 0;
  parts[2] = 0;
  return parts.join('.');
}

async function versionRecommend(cwd: string): Promise<void> {
  const { parseChangelog } = await import('./docs.js');

  const changelog = parseChangelog(cwd);

  const unreleased = changelog.entries.find(e => e.version === 'Unreleased');
  if (!unreleased || unreleased.changes.length === 0) {
    console.log('No unreleased changes since last tag.');
    return;
  }

  const counts = { feat: 0, fix: 0, docs: 0, chore: 0, other: 0, breaking: 0 };
  for (const c of unreleased.changes) {
    if (c.breaking) counts.breaking++;
    const key = c.type as string;
    if (key in counts) counts[key as keyof typeof counts]++;
    else counts.other++;
  }

  let tier: string;
  if (counts.breaking > 0) tier = 'major';
  else if (counts.feat > 0) tier = 'minor';
  else tier = 'patch';

  const currentVersion = getCurrentVersion(cwd);
  const nextVersion = tier === 'major' ? bumpMajor(currentVersion)
    : tier === 'minor' ? bumpMinor(currentVersion)
    : bumpPatch(currentVersion);

  console.log(`\nUnreleased changes since v${currentVersion}: ${unreleased.changes.length}`);
  console.log(`  feat: ${counts.feat}, fix: ${counts.fix}, docs: ${counts.docs}, chore: ${counts.chore}, breaking: ${counts.breaking}`);
  console.log(`\n  Recommended: ${tier} (${currentVersion} → ${nextVersion})\n`);

  if (counts.feat > 0) {
    console.log('  Includes new features — check release-policy.md for slope-web content review guidance.\n');
  }
}

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const error = err as { stderr?: string; message?: string };
    throw new Error(`Command failed: ${cmd}\n${error.stderr || error.message}`);
  }
}
