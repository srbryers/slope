import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { worktreeCommand } from '../../../src/cli/commands/worktree.js';
import { resolveStore } from '../../../src/cli/store.js';

let cwd: string;
let originalCwd: string;
let symlinkAlias: string | null;

function setupRepo(): void {
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'retros'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    commonIssuesPath: '.slope/common-issues.json',
    roadmapPath: 'docs/backlog/roadmap.json',
    metaphor: 'golf',
  }, null, 2));
  writeFileSync(join(cwd, '.slope', 'common-issues.json'), JSON.stringify({ recurring_patterns: [] }, null, 2));
  writeFileSync(join(cwd, 'docs', 'backlog', 'roadmap.json'), JSON.stringify({ name: 'Test', phases: [], sprints: [] }));
  writeFileSync(join(cwd, '.gitignore'), '.slope/\n');
  writeFileSync(join(cwd, 'README.md'), '# test repo\n');
  execSync('git init', { cwd, stdio: 'ignore' });
  execSync('git config user.email test@example.com', { cwd, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd, stdio: 'ignore' });
  execSync('git add .gitignore README.md docs/backlog/roadmap.json', { cwd, stdio: 'ignore' });
  execSync('git commit -m init', { cwd, stdio: 'ignore' });
}

/**
 * Whether this process may create symlinks.
 *
 * Windows refuses with EPERM unless Developer Mode is on or the process is
 * elevated. Probing the capability keeps the test running wherever symlinks
 * work, instead of skipping every Windows machine (#712).
 */
function canCreateSymlinks(): boolean {
  const probe = join(tmpdir(), `slope-symlink-probe-${process.pid}-${Date.now()}`);
  try {
    symlinkSync(tmpdir(), probe);
    return true;
  } catch {
    return false;
  } finally {
    // In the finally, so a successful create followed by a failed remove does
    // not leave the probe behind in tmpdir.
    try { rmSync(probe, { force: true }); } catch { /* nothing to clean up */ }
  }
}

describe('slope worktree start', () => {
  beforeEach(() => {
    cwd = join(tmpdir(), `slope-worktree-start-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    setupRepo();
    originalCwd = process.cwd();
    symlinkAlias = null;
    process.chdir(cwd);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    if (symlinkAlias) rmSync(symlinkAlias, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('creates a persistent worktree with shared state, session, and optional claim', async () => {
    await worktreeCommand([
      'start',
      '--branch=codex/worktree-start-test',
      '--base=HEAD',
      '--role=secondary',
      '--ide=codex',
      '--target=423',
      '--sprint=109',
    ]);

    const worktreePath = join(cwd, '.slope', 'worktrees', 'codex-worktree-start-test');
    expect(existsSync(worktreePath)).toBe(true);

    expect(existsSync(join(worktreePath, '.slope'))).toBe(false);

    const store = await resolveStore(cwd);
    try {
      const sessions = await store.getActiveSessions();
      const session = sessions.find(s => s.branch === 'codex/worktree-start-test');
      expect(session).toBeDefined();
      expect(session!.role).toBe('secondary');
      expect(session!.ide).toBe('codex');
      expect(realpathSync(session!.worktree_path!)).toBe(realpathSync(worktreePath));

      const claims = await store.getActiveClaims(109);
      const claim = claims.find(c => c.target === '423');
      expect(claim).toBeDefined();
      expect(claim!.session_id).toBe(session!.session_id);
    } finally {
      store.close();
    }
  });

  it('preserves canonical sprint identity for an optional claim', async () => {
    await worktreeCommand([
      'start',
      '--branch=codex/worktree-canonical-sprint',
      '--base=HEAD',
      '--target=458.10-1',
      '--sprint=458.10',
    ]);

    const store = await resolveStore(cwd);
    try {
      expect((await store.getActiveClaims('458.10')).map(claim => claim.sprint_number))
        .toEqual(['458.10']);
      expect(await store.getActiveClaims('458.1')).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('passes worktree paths as process arguments instead of shell fragments', async () => {
    const markerPath = join(cwd, 'shell-injection-marker');
    const worktreePath = join(cwd, '.slope', 'worktrees', 'safe-$(touch shell-injection-marker)');

    await worktreeCommand([
      'start',
      '--branch=codex/worktree-shell-safe',
      '--base=HEAD',
      `--path=${worktreePath}`,
      '--role=secondary',
      '--ide=codex',
    ]);

    expect(existsSync(markerPath)).toBe(false);
    expect(existsSync(worktreePath)).toBe(true);
  });

  it('warns when an explicit worktree path is inside the repository', async () => {
    await worktreeCommand([
      'start',
      '--branch=codex/in-repo-warning',
      '--base=HEAD',
      '--path=worktrees/in-repo-warning',
      '--dry-run',
    ]);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('parent test or format globs'));
  });

  // Creating a symlink on Windows needs Developer Mode or elevation, and
  // fails with EPERM otherwise. Gated on the capability rather than the
  // platform, so it runs wherever symlinks are actually permitted (#712).
  it.skipIf(!canCreateSymlinks())('warns when a symlinked worktree path resolves inside the repository', async () => {
    const inRepoRoot = join(cwd, 'worktrees');
    mkdirSync(inRepoRoot, { recursive: true });
    symlinkAlias = `${cwd}-alias`;
    symlinkSync(inRepoRoot, symlinkAlias);

    await worktreeCommand([
      'start',
      '--branch=codex/symlink-in-repo-warning',
      '--base=HEAD',
      `--path=${join(symlinkAlias, 'child')}`,
      '--dry-run',
    ]);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('parent test or format globs'));
  });

  it('does not warn for managed or sibling worktree paths', async () => {
    await worktreeCommand([
      'start',
      '--branch=codex/managed-no-warning',
      '--base=HEAD',
      '--dry-run',
    ]);
    await worktreeCommand([
      'start',
      '--branch=codex/sibling-no-warning',
      '--base=HEAD',
      `--path=${cwd}-sibling`,
      '--dry-run',
    ]);

    expect(console.warn).not.toHaveBeenCalled();
  });
});
