import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runAnalyzers, saveRepoProfile } from '../../src/core/analyzers/index.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-analyze-ext-'));
}

function setupRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-proj',
    devDependencies: { vitest: '^1.0.0' },
    scripts: { test: 'vitest run' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeFileSync(join(dir, 'README.md'), '# Test Project\n\nA test project for SLOPE.\n');
  writeFileSync(join(dir, 'CONTRIBUTING.md'), '# Contributing\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');

  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/ci.yml'), [
    'name: CI',
    'on: push',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm test',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm run build',
  ].join('\n'));

  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;');
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests/index.test.ts'), 'test("x", () => {})');

  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
}

describe('slope analyze — CI and docs integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setupRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes ci and docs in full analyzer run', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir });

    expect(profile.analyzersRun).toContain('ci');
    expect(profile.analyzersRun).toContain('docs');
    expect(profile.ci.system).toBe('github-actions');
    expect(profile.ci.hasTestStage).toBe(true);
    expect(profile.ci.hasBuildStage).toBe(true);
    expect(profile.docs.hasReadme).toBe(true);
    expect(profile.docs.hasContributing).toBe(true);
    expect(profile.docs.hasChangelog).toBe(true);
  });

  it('runs only ci and docs when filtered', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir, analyzers: ['ci', 'docs'] });

    expect(profile.analyzersRun).toEqual(['ci', 'docs']);
    expect(profile.ci.system).toBe('github-actions');
    expect(profile.docs.hasReadme).toBe(true);

    // Other sections should be empty defaults
    expect(profile.stack.primaryLanguage).toBe('');
    expect(profile.git.totalCommits).toBe(0);
  });

  it('JSON output includes ci and docs fields', async () => {
    const profile = await runAnalyzers({ cwd: tmpDir });
    saveRepoProfile(profile, tmpDir);

    const raw = readFileSync(join(tmpDir, '.slope', 'repo-profile.json'), 'utf8');
    const parsed = JSON.parse(raw);

    expect(parsed.ci).toBeDefined();
    expect(parsed.ci.system).toBe('github-actions');
    expect(parsed.docs).toBeDefined();
    expect(parsed.docs.hasReadme).toBe(true);
  });
});
