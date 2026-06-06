import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function runSlopeMap(cwd: string, args: string[] = [], options: { encoding?: BufferEncoding } = {}) {
  return execFileSync(process.execPath, [SLOPE_BIN, 'map', ...args], {
    cwd,
    encoding: options.encoding,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runSlopeCommand(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [SLOPE_BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function writeCurrentCodebaseMap(cwd: string): void {
  const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  writeFileSync(join(cwd, 'CODEBASE.md'), [
    '---',
    `generated_at: "${new Date().toISOString()}"`,
    `git_sha: "${head}"`,
    'sprint: 0',
    'source_files: 0',
    'test_files: 0',
    'flows: 0',
    '---',
    '# Current map',
    '',
  ].join('\n'));
}

function setupNonSlopeRepo(packageJson: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-map-'));
  mkdirSync(join(dir, '.slope'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'retros'), { recursive: true });
  writeFileSync(join(dir, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson));
  // Minimal git so `git rev-parse HEAD` doesn't error
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git commit -q --allow-empty -m initial', { cwd: dir });
  return dir;
}

describe('slope map in a non-SLOPE repo (#351)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('uses the project\'s name+description, not SLOPE\'s', () => {
    const cwd = setupNonSlopeRepo({
      name: '@cooper/web',
      description: 'Cooper validation app — Next.js + tRPC',
    });
    try {
      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(md).toContain('# @cooper/web Codebase Map');
      expect(md).toContain('Cooper validation app — Next.js + tRPC');
      expect(md).not.toContain('# SLOPE Codebase Map');
      expect(md).not.toContain('Sprint Lifecycle & Operational Performance Engine');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('omits SLOPE-internal sections (CLI commands, guards, MCP tools, API surface)', () => {
    const cwd = setupNonSlopeRepo({ name: '@cooper/web' });
    try {
      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(md).not.toContain('## CLI Commands');
      expect(md).not.toContain('## Guard Definitions');
      expect(md).not.toContain('## MCP Tools');
      expect(md).not.toContain('## API Surface');
      // Should still include config-driven sections useful to any project
      expect(md).toContain('## Package Inventory');
      expect(md).toContain('## User Flows');
      expect(md).toContain('## Test Inventory');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('inventories monorepo workspace packages (packages/, apps/)', () => {
    const cwd = setupNonSlopeRepo({ name: '@cooper/web' });
    try {
      // Cooper-shaped workspace layout
      mkdirSync(join(cwd, 'packages', 'core'), { recursive: true });
      writeFileSync(join(cwd, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@cooper/core', description: 'Domain model + types' }));
      writeFileSync(join(cwd, 'packages', 'core', 'index.ts'), 'export const x = 1;');

      mkdirSync(join(cwd, 'apps', 'site'), { recursive: true });
      writeFileSync(join(cwd, 'apps', 'site', 'package.json'),
        JSON.stringify({ name: '@cooper/site' }));
      writeFileSync(join(cwd, 'apps', 'site', 'main.ts'), 'console.log("hi");');
      writeFileSync(join(cwd, 'apps', 'site', 'main.test.ts'), 'it("works", () => {});');

      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');

      // Each workspace package gets a section with its package.json name
      expect(md).toContain('### `packages/core`');
      expect(md).toContain('Package: `@cooper/core`');
      expect(md).toContain('Domain model + types');
      expect(md).toContain('### `apps/site`');
      expect(md).toContain('Package: `@cooper/site`');
      // File counts reflect the project, not SLOPE's empty `src/`
      expect(md).toMatch(/Source files: 1 \| Test files: 0/); // packages/core
      expect(md).toMatch(/Source files: 1 \| Test files: 1/); // apps/site
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('falls back to "_No packages..." when neither workspaces nor src/ exist', () => {
    const cwd = setupNonSlopeRepo({ name: 'standalone-tool' });
    try {
      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(md).toContain('No packages, apps, or top-level src/ directory detected');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('inventories non-TypeScript source files from repository roots (#505)', () => {
    const cwd = setupNonSlopeRepo({ name: 'python-unity-tool' });
    try {
      mkdirSync(join(cwd, 'Assets', 'Scripts'), { recursive: true });
      mkdirSync(join(cwd, 'Assets', 'Tests'), { recursive: true });
      writeFileSync(join(cwd, 'main.py'), 'print("hi")\n');
      writeFileSync(join(cwd, 'Assets', 'Scripts', 'Player.cs'), 'public class Player {}\n');
      writeFileSync(join(cwd, 'Assets', 'Tests', 'PlayerTest.cs'), 'public class PlayerTest {}\n');

      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(md).toContain('source_files: 2');
      expect(md).toContain('test_files: 1');
      expect(md).toContain('### `.`');
      expect(md).toContain('Source files: 2 | Test files: 1');
      expect(md).not.toContain('No packages, apps, or top-level src/ directory detected');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refreshes metadata without overwriting an existing curated zero-source map (#505)', () => {
    const cwd = setupNonSlopeRepo({ name: 'docs-only-tool' });
    try {
      writeFileSync(join(cwd, 'CODEBASE.md'), '# Useful existing map\n\nKeep this.\n');

      const output = runSlopeMap(cwd, [], { encoding: 'utf8' }) as string;
      const refreshed = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(output).toContain('preserved existing manual content');
      expect(refreshed).toContain('git_sha:');
      expect(refreshed).toContain('source_files: 0');
      expect(refreshed).toContain('Useful existing map');

      runSlopeMap(cwd, ['--force']);
      const forced = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(forced).toContain('# docs-only-tool Codebase Map');
      expect(forced).toContain('No packages, apps, or top-level src/ directory detected');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('uses an ancestry-path git distance so sibling worktree bases do not inflate --check (#505)', () => {
    const cwd = setupNonSlopeRepo({ name: 'worktree-map-tool' });
    try {
      const initialSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      execSync('git checkout -q -b map-source', { cwd });
      writeFileSync(join(cwd, 'map-source.txt'), 'map source\n');
      execSync('git add map-source.txt && git commit -q -m "map source"', { cwd });
      const siblingMapSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

      execSync(`git checkout -q -b worktree-branch ${initialSha}`, { cwd });
      writeFileSync(join(cwd, 'branch.txt'), 'branch work\n');
      execSync('git add branch.txt && git commit -q -m "branch work"', { cwd });
      writeFileSync(join(cwd, 'CODEBASE.md'), [
        '---',
        `generated_at: "${new Date().toISOString()}"`,
        `git_sha: "${siblingMapSha}"`,
        'sprint: 0',
        'source_files: 0',
        'test_files: 0',
        'flows: 0',
        '---',
        '# Curated map',
        '',
      ].join('\n'));

      const output = runSlopeMap(cwd, ['--check'], { encoding: 'utf8' }) as string;
      expect(output).toContain('Git distance: 0 commits behind');
      expect(output).toContain('Overall: CURRENT');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not leak Windows stderr from staleness git distance (#512)', () => {
    const cwd = setupNonSlopeRepo({ name: 'stderr-clean-tool' });
    try {
      writeCurrentCodebaseMap(cwd);

      const mapCheck = runSlopeCommand(cwd, ['map', '--check']);
      expect(mapCheck.status).toBe(0);
      expect(mapCheck.stdout).toContain('Overall: CURRENT');
      expect(mapCheck.stderr).not.toContain('The system cannot find the path specified');

      const commitReady = runSlopeCommand(cwd, ['commit-ready', '--json']);
      expect(commitReady.status).toBe(0);
      expect(() => JSON.parse(commitReady.stdout)).not.toThrow();
      expect(commitReady.stderr).not.toContain('The system cannot find the path specified');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('uses directory basename when package.json is missing entirely', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-map-bare-'));
    try {
      mkdirSync(join(cwd, '.slope'), { recursive: true });
      writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
        roadmapPath: 'docs/backlog/roadmap.json',
        scorecardDir: 'docs/retros',
        scorecardPattern: 'sprint-*.json',
      }));
      execSync('git init -q', { cwd });
      execSync('git config user.email t@t', { cwd });
      execSync('git config user.name t', { cwd });
      execSync('git commit -q --allow-empty -m initial', { cwd });

      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      // Directory basename is appended to "Codebase Map"
      expect(md).toMatch(/^# .+ Codebase Map/m);
      expect(md).not.toContain('# SLOPE Codebase Map');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('regenerates from scratch when an existing CODEBASE.md is SLOPE-shaped (v1.55.1 leftover)', () => {
    const cwd = setupNonSlopeRepo({ name: '@cooper/web', description: 'Cooper' });
    try {
      // Simulate the bug: a prior SLOPE-shaped map already on disk
      writeFileSync(join(cwd, 'CODEBASE.md'),
        '# SLOPE Codebase Map\n\nSprint Lifecycle & Operational Performance Engine\n');

      runSlopeMap(cwd);
      const md = readFileSync(join(cwd, 'CODEBASE.md'), 'utf8');
      expect(md).toContain('# @cooper/web Codebase Map');
      expect(md).not.toContain('# SLOPE Codebase Map');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
