import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { analyzeGit, extractSprintArtifactReferences, extractSprintReferences, findShippedSprintsOnMain } from '../../../src/core/analyzers/git.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-git-'));
}

function gitInit(cwd: string): void {
  execSync('git init', { cwd, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd, stdio: 'pipe' });
}

function gitCommit(cwd: string, message: string): void {
  execSync(`git commit -m "${message}" --allow-empty`, { cwd, stdio: 'pipe' });
}

function gitCommitFile(cwd: string, file: string, content: string, message: string): void {
  const fullPath = join(cwd, file);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  execSync('git add -A', { cwd, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd, stdio: 'pipe' });
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
  }, 10000);

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
    // 65 commits in the "last 90 days" -> ~5 per week -> daily
    for (let i = 0; i < 65; i++) {
      gitCommit(tmpDir, `commit ${i}`);
    }

    const result = await analyzeGit(tmpDir);
    expect(result.inferredCadence).toBe('daily');
  }, 15000);

  it('infers sporadic cadence from few commits', async () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'lone commit');

    const result = await analyzeGit(tmpDir);
    // 1 commit in 90 days = 0.08/week → sporadic
    expect(result.inferredCadence).toBe('sporadic');
  });
});

describe('extractSprintReferences', () => {
  it('extracts sprint id from feat(SXX) prefix', () => {
    expect(extractSprintReferences(['feat(S77): The 19th Hole'])).toEqual(new Set([77]));
  });

  it('extracts both ids from a multi-sprint commit', () => {
    expect(extractSprintReferences(['feat(S70+S71): Session Insights'])).toEqual(new Set([70, 71]));
  });

  it('extracts id from bare (SXX) parenthetical', () => {
    expect(extractSprintReferences(['feat(pi-extension): harness v1.53.0 (S84) (#303)'])).toEqual(new Set([84]));
  });

  it('handles ticket key references like SXX-N', () => {
    expect(extractSprintReferences(['feat(S78-1): wire forceApi flag'])).toEqual(new Set([78]));
  });

  it('does not treat ticket-zero scoping commits as shipped sprint refs', () => {
    expect(extractSprintReferences(['docs(S101-0): scope guard utilization sprint'])).toEqual(new Set());
  });

  it('still treats nonzero ticket commits as shipped sprint refs', () => {
    expect(extractSprintReferences(['fix(S101-2): normalize apply_patch paths'])).toEqual(new Set([101]));
  });

  it('does not match S75 inside S75.5', () => {
    expect(extractSprintReferences(['feat(S75.5): The Bug Clearing'])).toEqual(new Set());
  });

  it('aggregates across multiple commit subjects', () => {
    const subjects = [
      'feat(S77): The 19th Hole',
      'feat(S78): The Wiring',
      'chore: bump version 1.51.0',
      'feat(S77-3): cleanup',
    ];
    expect(extractSprintReferences(subjects)).toEqual(new Set([77, 78]));
  });

  it('returns empty set for commits without sprint refs', () => {
    expect(extractSprintReferences(['chore: bump version', 'fix: typo'])).toEqual(new Set());
  });
});

describe('extractSprintArtifactReferences', () => {
  it('extracts sprint ids from scorecard and review artifact paths', () => {
    expect(extractSprintArtifactReferences([
      'docs/retros/sprint-99.json',
      'docs/retros/sprint-100-review.md',
      'docs/backlog/roadmap.json',
    ])).toEqual(new Set([99, 100]));
  });
});

describe('findShippedSprintsOnMain', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty set for non-git directory', () => {
    expect(findShippedSprintsOnMain(tmpDir)).toEqual(new Set());
  });

  it('detects sprint ids from commit subjects on the default branch', () => {
    gitInit(tmpDir);
    // git init may default to 'master' on older systems — write to whichever exists
    gitCommit(tmpDir, 'feat(S70+S71): parallel session insights');
    gitCommit(tmpDir, 'feat(S77): the 19th hole');
    gitCommit(tmpDir, 'chore: bump version');

    // Helper resolves main → master → HEAD
    const result = findShippedSprintsOnMain(tmpDir);
    expect(result).toEqual(new Set([70, 71, 77]));
  });

  it('honors explicit ref argument', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat(S99): only on HEAD');

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set([99]));
  });

  it('detects shipped sprints from scorecard artifacts in squash merge commits', () => {
    gitInit(tmpDir);
    gitCommitFile(
      tmpDir,
      'docs/retros/sprint-99.json',
      JSON.stringify({ sprint_number: 99 }),
      'Fix session state source-of-truth drift (#391)',
    );

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set([99]));
  });

  it('does not mark sprint scoping commits as shipped work', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'docs(S101-0): scope guard utilization sprint');

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set());
  });

  it('does not treat arbitrary S-prefixed file paths as shipped sprint refs', () => {
    gitInit(tmpDir);
    gitCommitFile(
      tmpDir,
      'src/S88Widget.ts',
      'export const widget = true;\n',
      'Add widget without sprint subject',
    );

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set());
  });

  it('refuses unsafe refs (shell-injection guard)', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat(S99): only on HEAD');

    // Semicolons, backticks, $(), spaces, pipes — anything outside the
    // SAFE_REF_RE allowlist must short-circuit to an empty set rather than
    // fall through to the shell.
    for (const unsafe of [
      'HEAD; echo pwned',
      'HEAD`echo pwned`',
      'HEAD$(echo pwned)',
      'HEAD || echo pwned',
      'HEAD | sh',
      'HEAD\nrm -rf /',
    ]) {
      expect(findShippedSprintsOnMain(tmpDir, unsafe)).toEqual(new Set());
    }
  });
});
