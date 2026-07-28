import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
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

function gitFastHistory(cwd: string, count: number): void {
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd, stdio: 'pipe' });
  if (count <= 0) {
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const lines = [
    'blob',
    'mark :1',
    'data 1',
    'x',
  ];

  for (let i = 0; i < count; i++) {
    const mark = i + 2;
    const message = `commit ${i}`;
    lines.push(
      'commit refs/heads/main',
      `mark :${mark}`,
      `committer Test User <test@test.com> ${timestamp} +0000`,
      `data ${Buffer.byteLength(message, 'utf8')}`,
      message,
    );
    if (i > 0) {
      lines.push(`from :${mark - 1}`);
    }
    lines.push('M 100644 :1 file.txt');
  }

  execFileSync('git', ['fast-import', '--quiet'], {
    cwd,
    input: `${lines.join('\n')}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitCommitFile(cwd: string, file: string, content: string, message: string): void {
  const fullPath = join(cwd, file);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  execSync('git add -A', { cwd, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd, stdio: 'pipe' });
}

function gitCommitFiles(cwd: string, files: Array<[string, string]>, message: string): void {
  for (const [file, content] of files) {
    const fullPath = join(cwd, file);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
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
    gitFastHistory(tmpDir, 65);

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

  it('treats nonzero ticket refs as shipped even in non-implementation subjects', () => {
    expect(extractSprintReferences(['docs(S101-2): record implementation notes'])).toEqual(new Set([101]));
  });

  it('does not treat docs-only bare sprint mentions as shipped sprint refs', () => {
    expect(extractSprintReferences([
      'docs(platform): multi-tenant product architecture spike - S106 context (#287)',
      'docs(roadmap): reslot registry-purchase to S106, mark S105 as the admin audit (#284)',
    ])).toEqual(new Set());
  });

  it('requires implementation-shaped subjects for bare sprint refs', () => {
    expect(extractSprintReferences([
      'chore(release): prepare S106 follow-up',
      'refactor(roadmap): tighten shipped checks for S107',
    ])).toEqual(new Set([107]));
  });

  it('does not treat roadmap planning subjects as shipped sprint refs', () => {
    expect(extractSprintReferences([
      'feat(roadmap): reslot registry-purchase to S106',
      'fix(planning): add S107 recovery lane',
      'fix(roadmap): tighten shipped detection for S108',
    ])).toEqual(new Set([108]));
  });

  it('does not treat issue-sized ticket suffixes as shipped sprint refs', () => {
    expect(extractSprintReferences(['fix(S147-533): tolerate roadmap sprints without tickets'])).toEqual(new Set());
  });

  it('does not treat sprint range endpoints as shipped sprint refs', () => {
    expect(extractSprintReferences([
      'docs(roadmap): extend roadmap with Phases 10-12 (S64-S80) (#176)',
      'Block-based CMS - design spike + Phase 13 (S85\u2013S90) (#188)',
    ])).toEqual(new Set());
  });

  it('does not treat a forward-planning mention as a shipped sprint ref (GH #632)', () => {
    // "plan S134" announces future work; S134 was never implemented. Counting it
    // made `slope roadmap validate` demand status "complete" and exit 1.
    expect(extractSprintReferences([
      'docs: close S133 (reverted) + verified UCP findings + plan S134 (#339)',
    ])).toEqual(new Set());
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
    ])).toEqual(new Set(['99', '100']));
  });

  it('preserves exact inserted sprint keys from scorecard and review artifact paths', () => {
    expect(extractSprintArtifactReferences([
      'docs/retros/sprint-143.5.json',
      'docs/retros/sprint-143.95-review.md',
      'docs/retros/sprint-143.10.json',
      'docs/retros/sprint-144.json',
    ])).toEqual(new Set(['143.5', '143.95', '143.10', '144']));
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
    expect(result).toEqual(new Set(['70', '71', '77']));
  });

  it('honors explicit ref argument', () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, 'feat(S99): only on HEAD');

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set(['99']));
  });

  it('detects shipped sprints from scorecard artifacts in squash merge commits', () => {
    gitInit(tmpDir);
    gitCommitFile(
      tmpDir,
      'docs/retros/sprint-99.json',
      JSON.stringify({ sprint_number: 99 }),
      'Fix session state source-of-truth drift (#391)',
    );

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set(['99']));
  });

  it('detects inserted decimal sprints from scorecard artifacts in squash merge commits', () => {
    gitInit(tmpDir);
    gitCommitFile(
      tmpDir,
      'docs/retros/sprint-143.5.json',
      JSON.stringify({ sprint_number: 143.5 }),
      'Fix decimal sprint status parsing (#511)',
    );

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set(['143.5']));
  });

  it('keeps coexisting .1 and .10 artifact evidence distinct', () => {
    gitInit(tmpDir);
    gitCommitFiles(
      tmpDir,
      [
        ['docs/retros/sprint-458.1.json', JSON.stringify({ sprint_number: '458.1' })],
        ['docs/retros/sprint-458.10.json', JSON.stringify({ sprint_number: '458.10' })],
      ],
      'Publish canonical sprint scorecards (#659)',
    );

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set(['458.1', '458.10']));
  });

  it('does not attribute SLOPE-only post-merge metadata commits to next planned sprint refs (#563)', () => {
    gitInit(tmpDir);
    gitCommitFiles(
      tmpDir,
      [
        ['.slope/retros/post-merge/sprint-12-pr-3.json', '{}'],
        ['docs/backlog/roadmap.json', '{"name":"Test"}'],
        ['docs/retros/sprint-12.json', JSON.stringify({ sprint_number: 12 })],
        ['docs/retros/sprint-12-review.md', '# S12 review\n'],
      ],
      'docs(S13): post-merge housekeeping',
    );

    expect(findShippedSprintsOnMain(tmpDir, 'HEAD')).toEqual(new Set(['12']));
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
