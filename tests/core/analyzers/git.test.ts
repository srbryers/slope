import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { analyzeGit } from '../../../src/core/analyzers/git.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-git-'));
}

function gitInit(cwd: string): void {
  execSync('git init', { cwd, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd, stdio: 'pipe' });
}

function gitCommit(cwd: string, message: string): void {
  writeFileSync(join(cwd, `file-${Date.now()}-${Math.random()}.txt`), message);
  execSync('git add -A', { cwd, stdio: 'pipe' });
  execSync(`git commit -m "${message}" --allow-empty`, { cwd, stdio: 'pipe' });
}

describe('analyzeGit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles non-git directory gracefully', async () => {
    const result = await analyzeGit(tmpDir);
    expect(result.totalCommits).toBe(0);
    expect(result.inferredCadence).toBe('sporadic');
    expect(result.contributors).toHaveLength(0);
  });

  it('counts commits in a git repo', async () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'initial');
    gitCommit(tmpDir, 'second');
    gitCommit(tmpDir, 'third');

    const result = await analyzeGit(tmpDir);
    expect(result.totalCommits).toBe(3);
    expect(result.commitsLast90d).toBe(3);
  });

  it('computes commits per week', async () => {
    gitInit(tmpDir);
    for (let i = 0; i < 10; i++) {
      gitCommit(tmpDir, `commit ${i}`);
    }

    const result = await analyzeGit(tmpDir);
    expect(result.commitsPerWeek).toBeGreaterThan(0);
  });

  it('parses contributors', async () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'first');
    gitCommit(tmpDir, 'second');

    const result = await analyzeGit(tmpDir);
    expect(result.contributors.length).toBeGreaterThanOrEqual(1);
    expect(result.contributors[0].name).toBe('Test User');
    expect(result.contributors[0].email).toBe('test@test.com');
    expect(result.contributors[0].commits).toBeGreaterThanOrEqual(2);
  });

  it('detects last release tag', async () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'initial');
    execSync('git tag v1.0.0', { cwd: tmpDir, stdio: 'pipe' });
    gitCommit(tmpDir, 'after tag');

    const result = await analyzeGit(tmpDir);
    expect(result.lastRelease).toBeDefined();
    expect(result.lastRelease!.tag).toBe('v1.0.0');
  });

  it('infers daily cadence from many commits', async () => {
    gitInit(tmpDir);
    // 90+ commits in the "last 90 days" → ~7 per week → daily
    for (let i = 0; i < 90; i++) {
      gitCommit(tmpDir, `commit ${i}`);
    }

    const result = await analyzeGit(tmpDir);
    expect(result.inferredCadence).toBe('daily');
  });

  it('infers sporadic cadence from few commits', async () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'lone commit');

    const result = await analyzeGit(tmpDir);
    // 1 commit in 90 days = 0.08/week → sporadic
    expect(result.inferredCadence).toBe('sporadic');
  });
});
