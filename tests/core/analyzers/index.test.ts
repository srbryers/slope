import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRepoProfile, saveRepoProfile } from '../../../src/core/analyzers/index.js';
import type { RepoProfile, AnalyzerName } from '../../../src/core/analyzers/types.js';

function makeProfile(overrides: Partial<RepoProfile> = {}): RepoProfile {
  return {
    analyzedAt: '2026-02-25T00:00:00.000Z',
    analyzersRun: ['stack', 'structure', 'git', 'testing'],
    stack: { primaryLanguage: 'TypeScript', languages: { TypeScript: 10 }, frameworks: ['vitest'] },
    structure: { totalFiles: 15, sourceFiles: 10, testFiles: 5, maxDepth: 3, isMonorepo: false, modules: [], largeFiles: [] },
    git: { totalCommits: 50, commitsLast90d: 20, commitsPerWeek: 3, contributors: [], activeBranches: [], inferredCadence: 'weekly' },
    testing: { testFileCount: 5, hasTestScript: true, hasCoverage: false, testDirs: ['tests'] },
    ci: { configFiles: [], hasTestStage: false, hasBuildStage: false, hasDeployStage: false },
    docs: { hasReadme: false, hasContributing: false, hasChangelog: false, hasAdr: false, hasApiDocs: false },
    ...overrides,
  };
}

describe('loadRepoProfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-analyzer-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no profile exists', () => {
    expect(loadRepoProfile(tmpDir)).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'repo-profile.json'), 'not json');
    expect(loadRepoProfile(tmpDir)).toBeNull();
  });

  it('loads a saved profile', () => {
    const profile = makeProfile();
    const dir = join(tmpDir, '.slope');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'repo-profile.json'), JSON.stringify(profile));
    const loaded = loadRepoProfile(tmpDir);
    expect(loaded).toEqual(profile);
  });
});

describe('saveRepoProfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-analyzer-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .slope dir and writes profile', () => {
    const profile = makeProfile();
    saveRepoProfile(profile, tmpDir);
    const filePath = join(tmpDir, '.slope', 'repo-profile.json');
    expect(existsSync(filePath)).toBe(true);
    const loaded = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(loaded.analyzedAt).toBe(profile.analyzedAt);
    expect(loaded.stack.primaryLanguage).toBe('TypeScript');
  });

  it('round-trips through save and load', () => {
    const profile = makeProfile({ analyzersRun: ['stack'] as AnalyzerName[] });
    saveRepoProfile(profile, tmpDir);
    const loaded = loadRepoProfile(tmpDir);
    expect(loaded).toEqual(profile);
  });
});
