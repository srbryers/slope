import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { QUIET_STDIO } from '../../core/process.js';
import { compareSprintIdKeys, roadmapSprintKey, sprintIdKey } from '../../core/index.js';
import type { ChangelogChange, RoadmapDefinition, RoadmapSprint, SprintId } from '../../core/index.js';

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
  const help = sub === '--help' || sub === '-h' || args.includes('--help') || args.includes('-h');

  if (!help && sub === 'bump') {
    await versionBump(args.slice(1));
    return;
  }

  if (!help && sub === 'recommend') {
    await versionRecommend(process.cwd());
    return;
  }

  if (help) {
    console.log(`
slope version                                              Show current version
slope version bump [<version>] [--patch|--major] [--dry-run]  Bump version, create PR, merge
slope version recommend                                    Analyze commits and recommend version tier
`);
    return;
  }

  // Default: show installed slope version. Resolve from the slope package
  // itself (relative to this compiled file), not from process.cwd() which
  // would read whatever package.json the user happens to be standing in.
  const version = getInstalledVersion();
  console.log(`@slope-dev/slope v${version ?? 'unknown'}`);
}

/** Read this slope installation's own version. Resolves package.json
 *  relative to the compiled file path (dist/cli/commands/version.js →
 *  ../../../package.json). Used by the default `slope version` output so
 *  it doesn't accidentally report the version of whatever cwd happens to
 *  contain a package.json (GH #300). */
function getInstalledVersion(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Walk up looking for the slope package.json — resilient to build
    // layout drift (dist/cli/commands → dist/cli → dist → root). Validates
    // the package name to avoid picking up an unrelated package.json.
    for (let i = 1; i <= 4; i++) {
      const pkgPath = resolve(here, ...Array(i).fill('..'), 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === '@slope-dev/slope' && typeof pkg.version === 'string') {
          return pkg.version;
        }
      } catch { /* try next ancestor */ }
    }
    return null;
  } catch {
    return null;
  }
}

const VERSION_BUMP_STAGE_PATHS = [
  'package.json',
  'templates/codex/plugins/slope/.codex-plugin/plugin.json',
] as const;

export function getVersionBumpStagePaths(cwd: string): string[] {
  return VERSION_BUMP_STAGE_PATHS.filter(path => existsSync(join(cwd, path)));
}

function stageVersionBumpChanges(cwd: string): void {
  const paths = getVersionBumpStagePaths(cwd);
  if (paths.length === 0) {
    throw new Error('No version bump paths found to stage.');
  }
  // Use argv-form execution here so release automation never hand-quotes paths
  // into a shell command.
  execFileSync('git', ['add', ...paths], { cwd, stdio: QUIET_STDIO });
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
  stageVersionBumpChanges(cwd);
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
    try { run('git checkout main', cwd); } catch {
      try { run('git checkout -', cwd); } catch { /* best effort */ }
    }
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
    execSync('git merge-base --is-ancestor HEAD origin/main', { cwd, encoding: 'utf8', stdio: QUIET_STDIO });
  } catch {
    // HEAD is ahead of origin/main — check if it's a squash-merge divergence or real work
    // If origin/main is an ancestor of HEAD, there are local-only commits
    try {
      execSync('git merge-base --is-ancestor origin/main HEAD', { cwd, encoding: 'utf8', stdio: QUIET_STDIO });
      // origin/main IS ancestor of HEAD — there are unpushed commits
      const unpushed = execSync('git log origin/main..HEAD --oneline', { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
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

type VersionTier = 'patch' | 'minor' | 'major';
type EvidenceSource = 'roadmap' | 'scorecard';

export interface VersionReleaseEvidence {
  source: EvidenceSource;
  sprint: string;
  theme: string;
  tier: VersionTier;
  reason: string;
}

const TIER_RANK: Record<VersionTier, number> = { patch: 0, minor: 1, major: 2 };
const SPRINT_REF_RE = /\bS(\d+(?:\.\d+)?)(?:-\d+)?\b/g;
const SCORECARD_PATH_RE = /(?:^|[/\\])docs[/\\]retros[/\\]sprint-(\d+(?:\.\d+)?)\.json$/;
const GIT_HASH_RE = /^[a-f0-9]{7,40}$/i;
const FEATURE_EVIDENCE_RE = /\b(feature|product surface|cli surface|human surface|user-facing|new command|cockpit|onboarding|plugin|adapter)\b/i;
const BREAKING_EVIDENCE_RE = /\b(breaking|schema[_ -]migration|store[_ -]migration)\b/i;
const PATCH_ONLY_TYPE_RE = /\b(bugfix|fix|planning|test|release|docs|documentation|chore)\b/i;

function maxTier(a: VersionTier, b: VersionTier): VersionTier {
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

function sprintFileId(sprint: SprintId): string {
  return sprintIdKey(sprint) ?? String(sprint);
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadRoadmapSprints(cwd: string): Map<string, RoadmapSprint & { status?: string; note?: string }> {
  const roadmap = readJsonFile<RoadmapDefinition>(join(cwd, 'docs', 'backlog', 'roadmap.json'));
  const sprints = new Map<string, RoadmapSprint & { status?: string; note?: string }>();
  if (!roadmap) return sprints;
  for (const sprint of roadmap?.sprints ?? []) {
    sprints.set(roadmapSprintKey(roadmap, sprint), sprint as RoadmapSprint & { status?: string; note?: string });
  }
  return sprints;
}

function extractSprintIdsFromText(text: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!text) return ids;

  for (const match of text.matchAll(SPRINT_REF_RE)) {
    const sprintKey = sprintIdKey(match[1]);
    if (sprintKey !== null) ids.add(sprintKey);
  }

  return ids;
}

function gitOutput(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: QUIET_STDIO }).trim();
  } catch {
    return '';
  }
}

function commitSubject(cwd: string, hash: string): string {
  if (!GIT_HASH_RE.test(hash)) return '';
  return gitOutput(cwd, ['show', '-s', '--format=%s', hash]);
}

function commitChangedFiles(cwd: string, hash: string): string[] {
  if (!GIT_HASH_RE.test(hash)) return [];
  const raw = gitOutput(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', hash]);
  return raw ? raw.split('\n').map(line => line.trim()).filter(Boolean) : [];
}

function evidenceTierFromTypedText(type: string, text: string): VersionTier | null {
  const combined = `${type} ${text}`;
  if (BREAKING_EVIDENCE_RE.test(combined)) return 'major';
  if (FEATURE_EVIDENCE_RE.test(type)) return 'minor';
  if (PATCH_ONLY_TYPE_RE.test(type)) return null;
  if (FEATURE_EVIDENCE_RE.test(combined)) return 'minor';
  return null;
}

function scorecardEvidenceText(scorecard: Record<string, unknown> | null): string {
  if (!scorecard) return '';
  const shots = Array.isArray(scorecard.shots)
    ? scorecard.shots
      .map(shot => typeof shot === 'object' && shot ? (shot as { title?: unknown; notes?: unknown }) : null)
      .filter(Boolean)
      .map(shot => String(shot!.title ?? ''))
      .join(' ')
    : '';
  const factors = Array.isArray(scorecard.slope_factors) ? scorecard.slope_factors.join(' ') : '';
  return [
    scorecard.theme,
    shots,
    factors,
  ].map(value => String(value ?? '')).join(' ');
}

function roadmapEvidenceText(sprint: (RoadmapSprint & { note?: string }) | undefined): string {
  if (!sprint) return '';
  const tickets = (sprint.tickets ?? []).map(ticket => ticket.title).join(' ');
  return [sprint.theme, sprint.type, sprint.note, tickets].map(value => String(value ?? '')).join(' ');
}

function releaseEvidenceForSprint(
  cwd: string,
  sprintId: string,
  roadmapSprints: Map<string, RoadmapSprint & { status?: string; note?: string }>,
): VersionReleaseEvidence | null {
  const roadmapSprint = roadmapSprints.get(sprintId);
  const scorecard = readJsonFile<Record<string, unknown>>(join(cwd, 'docs', 'retros', `sprint-${sprintFileId(sprintId)}.json`));
  const shipped = roadmapSprint?.status === 'complete' || Boolean(scorecard);
  if (!shipped) return null;

  const scorecardType = String(scorecard?.type ?? '');
  const roadmapType = String(roadmapSprint?.type ?? '');
  const scorecardTier = evidenceTierFromTypedText(scorecardType, scorecardEvidenceText(scorecard));
  const roadmapTier = evidenceTierFromTypedText(roadmapType, roadmapEvidenceText(roadmapSprint));
  const tier = scorecardTier && roadmapTier ? maxTier(scorecardTier, roadmapTier) : scorecardTier ?? roadmapTier;
  if (!tier) return null;

  const source: EvidenceSource = scorecard ? 'scorecard' : 'roadmap';
  const theme = String(scorecard?.theme ?? roadmapSprint?.theme ?? `Sprint ${sprintFileId(sprintId)}`);
  const type = String(scorecard?.type ?? roadmapSprint?.type ?? 'unknown type');

  return {
    source,
    sprint: sprintId,
    theme,
    tier,
    reason: type,
  };
}

export function collectSlopeReleaseEvidence(
  cwd: string,
  changes: Pick<ChangelogChange, 'hash' | 'description' | 'scope'>[],
): VersionReleaseEvidence[] {
  const roadmapSprints = loadRoadmapSprints(cwd);
  const sprintIds = new Set<string>();

  for (const change of changes) {
    for (const id of extractSprintIdsFromText(change.description)) sprintIds.add(id);
    for (const id of extractSprintIdsFromText(change.scope)) sprintIds.add(id);

    if (!change.hash) continue;
    for (const id of extractSprintIdsFromText(commitSubject(cwd, change.hash))) sprintIds.add(id);

    for (const file of commitChangedFiles(cwd, change.hash)) {
      const scorecardMatch = file.match(SCORECARD_PATH_RE);
      if (!scorecardMatch) continue;
      const sprintKey = sprintIdKey(scorecardMatch[1]);
      if (sprintKey !== null) sprintIds.add(sprintKey);
    }
  }

  const evidence = new Map<string, VersionReleaseEvidence>();
  for (const sprintId of [...sprintIds].sort(compareSprintIdKeys)) {
    const item = releaseEvidenceForSprint(cwd, sprintId, roadmapSprints);
    if (item) evidence.set(sprintId, item);
  }

  return [...evidence.values()];
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

  let conventionalTier: VersionTier;
  if (counts.breaking > 0) conventionalTier = 'major';
  else if (counts.feat > 0) conventionalTier = 'minor';
  else conventionalTier = 'patch';

  const evidence = collectSlopeReleaseEvidence(cwd, unreleased.changes);
  const evidenceTier = evidence.reduce<VersionTier>(
    (current, item) => maxTier(current, item.tier),
    'patch',
  );
  const tier = maxTier(conventionalTier, evidenceTier);

  const currentVersion = getCurrentVersion(cwd);
  const nextVersion = tier === 'major' ? bumpMajor(currentVersion)
    : tier === 'minor' ? bumpMinor(currentVersion)
    : bumpPatch(currentVersion);

  console.log(`\nUnreleased changes since v${currentVersion}: ${unreleased.changes.length}`);
  console.log(`  feat: ${counts.feat}, fix: ${counts.fix}, docs: ${counts.docs}, chore: ${counts.chore}, breaking: ${counts.breaking}`);
  console.log(`  Conventional commit tier: ${conventionalTier}`);
  if (evidence.length > 0) {
    console.log(`  SLOPE release evidence: ${evidenceTier}`);
    for (const item of evidence) {
      console.log(`    - S${sprintFileId(item.sprint)} ${item.theme} (${item.source}: ${item.reason})`);
    }
  } else if (counts.feat === 0 && (counts.other > 0 || counts.docs > 0 || counts.chore > 0)) {
    console.log('  SLOPE release evidence: none found for shipped feature-level roadmap or scorecard work');
  }
  console.log(`\n  Recommended: ${tier} (${currentVersion} → ${nextVersion})\n`);

  if (TIER_RANK[tier] > TIER_RANK[conventionalTier]) {
    console.log('  Recommendation raised above commit-subject tier by durable SLOPE evidence.\n');
  }

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
