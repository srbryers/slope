import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { worktreeCommand } from '../../../src/cli/commands/worktree.js';
import { resolveStore } from '../../../src/cli/store.js';

let cwd: string;
let originalCwd: string;

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

describe('slope worktree start', () => {
  beforeEach(() => {
    cwd = join(tmpdir(), `slope-worktree-start-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    setupRepo();
    originalCwd = process.cwd();
    process.chdir(cwd);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('creates a persistent worktree, linked config, session, and optional claim', async () => {
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

    const linkedConfig = JSON.parse(readFileSync(join(worktreePath, '.slope', 'config.json'), 'utf8'));
    expect(resolve(worktreePath, linkedConfig.store_path)).toBe(join(cwd, '.slope', 'slope.db'));
    expect(resolve(worktreePath, linkedConfig.commonIssuesPath)).toBe(join(cwd, '.slope', 'common-issues.json'));

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
});
