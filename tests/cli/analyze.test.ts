import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runAnalyzers, saveRepoProfile, loadRepoProfile } from '../../src/core/analyzers/index.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-analyze-cli-'));
}

function setupSampleRepo(dir: string): void {
  // Git init
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });

  // Package.json
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-project',
    devDependencies: { vitest: '^1.0.0' },
    scripts: { test: 'vitest run' },
    engines: { node: '>=18' },
  }));

  // Config files
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), '');

  // Source files
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;');
  writeFileSync(join(dir, 'src/app.ts'), 'export const y = 2;');

  // Test files
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests/index.test.ts'), 'test("x", () => {})');

  // Git commit
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'pipe' });
}

describe('runAnalyzers (integration)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setupSampleRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs all analyzers against a sample repo', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir });

    expect(profile.analyzedAt).toBeTruthy();
    expect(profile.analyzersRun).toEqual(['stack', 'structure', 'git', 'testing', 'ci', 'docs']);

    // Stack
    expect(profile.stack.primaryLanguage).toBe('TypeScript');
    expect(profile.stack.packageManager).toBe('pnpm');
    expect(profile.stack.frameworks).toContain('vitest');

    // Structure
    expect(profile.structure.sourceFiles).toBeGreaterThanOrEqual(2);
    expect(profile.structure.testFiles).toBeGreaterThanOrEqual(1);

    // Git
    expect(profile.git.totalCommits).toBeGreaterThanOrEqual(1);

    // Testing
    expect(profile.testing.framework).toBe('vitest');
    expect(profile.testing.hasTestScript).toBe(true);
  });

  it('runs only specified analyzers', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir, analyzers: ['stack'] });

    expect(profile.analyzersRun).toEqual(['stack']);
    expect(profile.stack.primaryLanguage).toBe('TypeScript');

    // Other sections should be empty defaults
    expect(profile.structure.totalFiles).toBe(0);
    expect(profile.git.totalCommits).toBe(0);
    expect(profile.testing.testFileCount).toBe(0);
  });

  it('saves and loads profile to .slope/', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir });
    saveRepoProfile(profile, tmpDir);

    expect(existsSync(join(tmpDir, '.slope', 'repo-profile.json'))).toBe(true);

    const loaded = loadRepoProfile(tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded!.stack.primaryLanguage).toBe('TypeScript');
    expect(loaded!.analyzersRun).toEqual(['stack', 'structure', 'git', 'testing', 'ci', 'docs']);
  });

  it('profile JSON is valid', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir });
    saveRepoProfile(profile, tmpDir);

    const raw = readFileSync(join(tmpDir, '.slope', 'repo-profile.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.analyzedAt).toBeTruthy();
    expect(parsed.stack).toBeDefined();
    expect(parsed.structure).toBeDefined();
    expect(parsed.git).toBeDefined();
    expect(parsed.testing).toBeDefined();
  });
});
