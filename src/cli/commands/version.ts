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

  // Default: show current version
  const cwd = process.cwd();
  const version = getCurrentVersion(cwd);
  console.log(`@slope-dev/slope v${version}`);
}

async function versionBump(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const dryRun = args.includes('--dry-run');

  // 1. Sync to origin/main
  syncToMain(cwd);

  // 2. Determine version
  const currentVersion = getCurrentVersion(cwd);
  const targetVersion = args.find(a => /^\d+\.\d+\.\d+/.test(a)) ?? bumpMinor(currentVersion);

  console.log(`\nSLOPE Release: ${currentVersion} → ${targetVersion}`);

  if (dryRun) {
    console.log('  [dry-run] Would create branch, bump version, PR, and merge.');
    return;
  }

  // 3. Create branch and bump version
  const branch = `chore/bump-${targetVersion}`;
  run(`git checkout -b ${branch}`, cwd);
  run(`node scripts/version-bump.mjs ${targetVersion}`, cwd);

  // 4. Commit and push
  run('git add package.json', cwd);
  run(`git commit -m "chore: bump version to ${targetVersion}" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"`, cwd);
  run(`git push -u origin ${branch}`, cwd);

  // 5. Create PR and merge
  const prBody = `Version bump ${currentVersion} → ${targetVersion}`;
  const prUrl = run(
    `gh pr create --title "chore: bump version to ${targetVersion}" --body "${prBody}"`,
    cwd,
  ).trim();
  console.log(`  PR: ${prUrl}`);

  run('gh pr merge --squash', cwd);
  console.log('  Merged.');

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
 */
function syncToMain(cwd: string): void {
  run('git fetch origin main', cwd);

  const status = run('git status --porcelain', cwd).trim();
  if (status) {
    throw new Error(`Working directory is not clean:\n${status}\nCommit or stash changes before releasing.`);
  }

  run('git reset --hard origin/main', cwd);
}

function getCurrentVersion(cwd: string): string {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  return pkg.version;
}

function bumpMinor(version: string): string {
  const parts = version.split('.').map(Number);
  parts[1]++;
  parts[2] = 0;
  return parts.join('.');
}

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const error = err as { stderr?: string; message?: string };
    throw new Error(`Command failed: ${cmd}\n${error.stderr || error.message}`);
  }
}
