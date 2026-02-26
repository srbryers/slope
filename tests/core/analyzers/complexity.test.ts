import { describe, it, expect } from 'vitest';
import { estimateComplexity } from '../../../src/core/analyzers/complexity.js';
import type { RepoProfile } from '../../../src/core/analyzers/types.js';

function makeProfile(overrides: Partial<{
  modules: RepoProfile['structure']['modules'];
  isMonorepo: boolean;
  testFileCount: number;
  contributors: RepoProfile['git']['contributors'];
  largeFiles: RepoProfile['structure']['largeFiles'];
  frameworks: string[];
  testDirs: string[];
}>): RepoProfile {
  return {
    analyzedAt: new Date().toISOString(),
    analyzersRun: ['stack', 'structure', 'git', 'testing'],
    stack: {
      primaryLanguage: 'TypeScript',
      languages: { TypeScript: 80, JavaScript: 20 },
      frameworks: overrides.frameworks ?? ['vitest'],
      packageManager: 'pnpm',
      runtime: 'node',
    },
    structure: {
      totalFiles: 50,
      sourceFiles: 30,
      testFiles: overrides.testFileCount ?? 10,
      maxDepth: 4,
      isMonorepo: overrides.isMonorepo ?? false,
      modules: overrides.modules ?? [{ name: 'core', path: 'src/core', fileCount: 15 }],
      largeFiles: overrides.largeFiles ?? [],
    },
    git: {
      totalCommits: 100,
      commitsLast90d: 50,
      commitsPerWeek: 5,
      contributors: overrides.contributors ?? [
        { name: 'Alice', email: 'alice@test.com', commits: 60 },
        { name: 'Bob', email: 'bob@test.com', commits: 40 },
      ],
      activeBranches: ['main'],
      inferredCadence: 'weekly',
    },
    testing: {
      framework: 'vitest',
      testFileCount: overrides.testFileCount ?? 10,
      hasTestScript: true,
      hasCoverage: false,
      testDirs: overrides.testDirs ?? ['tests'],
    },
  };
}

describe('estimateComplexity', () => {
  describe('par estimation', () => {
    it('returns par 3 for small repos (<=2 modules)', () => {
      const profile = makeProfile({ modules: [
        { name: 'core', path: 'src/core', fileCount: 10 },
      ]});
      expect(estimateComplexity(profile).estimatedPar).toBe(3);
    });

    it('returns par 4 for medium repos (3-4 modules)', () => {
      const profile = makeProfile({ modules: [
        { name: 'core', path: 'src/core', fileCount: 10 },
        { name: 'cli', path: 'src/cli', fileCount: 10 },
        { name: 'store', path: 'src/store', fileCount: 5 },
      ]});
      expect(estimateComplexity(profile).estimatedPar).toBe(4);
    });

    it('returns par 5 for large repos (5+ modules)', () => {
      const profile = makeProfile({ modules: [
        { name: 'core', path: 'src/core', fileCount: 10 },
        { name: 'cli', path: 'src/cli', fileCount: 10 },
        { name: 'store', path: 'src/store', fileCount: 5 },
        { name: 'mcp', path: 'src/mcp', fileCount: 5 },
        { name: 'tokens', path: 'src/tokens', fileCount: 5 },
      ]});
      expect(estimateComplexity(profile).estimatedPar).toBe(5);
    });
  });

  describe('slope factors', () => {
    it('detects monorepo factor', () => {
      const profile = makeProfile({ isMonorepo: true });
      const result = estimateComplexity(profile);
      expect(result.slopeFactors).toContain('monorepo');
    });

    it('detects no-tests factor', () => {
      const profile = makeProfile({ testFileCount: 0 });
      const result = estimateComplexity(profile);
      expect(result.slopeFactors).toContain('no-tests');
    });

    it('detects solo-developer factor', () => {
      const profile = makeProfile({
        contributors: [{ name: 'Solo', email: 'solo@test.com', commits: 100 }],
      });
      const result = estimateComplexity(profile);
      expect(result.slopeFactors).toContain('solo-developer');
    });

    it('detects large-files factor', () => {
      const profile = makeProfile({
        largeFiles: [
          { path: 'a.ts', lines: 1200 },
          { path: 'b.ts', lines: 1100 },
          { path: 'c.ts', lines: 1050 },
          { path: 'd.ts', lines: 1000 },
        ],
      });
      const result = estimateComplexity(profile);
      expect(result.slopeFactors).toContain('large-files');
    });

    it('detects complex-stack factor', () => {
      const profile = makeProfile({
        frameworks: ['react', 'next', 'prisma', 'trpc', 'tailwind', 'storybook'],
      });
      const result = estimateComplexity(profile);
      expect(result.slopeFactors).toContain('complex-stack');
    });

    it('slope equals number of factors', () => {
      const profile = makeProfile({
        isMonorepo: true,
        testFileCount: 0,
        contributors: [{ name: 'Solo', email: 'solo@test.com', commits: 100 }],
      });
      const result = estimateComplexity(profile);
      expect(result.estimatedSlope).toBe(result.slopeFactors.length);
    });
  });

  describe('risk areas', () => {
    it('flags modules with >20 files and no test directory', () => {
      const profile = makeProfile({
        modules: [
          { name: 'big', path: 'src/big', fileCount: 25 },
          { name: 'small', path: 'src/small', fileCount: 5 },
        ],
        testDirs: ['tests/small'],
      });
      const result = estimateComplexity(profile);
      expect(result.riskAreas).toEqual([
        { module: 'big', reason: 'High file count with no dedicated test directory' },
      ]);
    });

    it('does not flag modules with matching test directory', () => {
      const profile = makeProfile({
        modules: [{ name: 'core', path: 'src/core', fileCount: 25 }],
        testDirs: ['tests/core'],
      });
      const result = estimateComplexity(profile);
      expect(result.riskAreas).toEqual([]);
    });
  });

  describe('bus factor', () => {
    it('flags all modules for solo developer', () => {
      const profile = makeProfile({
        contributors: [{ name: 'Solo', email: 'solo@test.com', commits: 100 }],
        modules: [
          { name: 'core', path: 'src/core', fileCount: 10 },
          { name: 'cli', path: 'src/cli', fileCount: 10 },
        ],
      });
      const result = estimateComplexity(profile);
      expect(result.busFactor).toHaveLength(2);
      expect(result.busFactor[0].pct).toBe(100);
    });

    it('flags modules when top contributor has >80%', () => {
      const profile = makeProfile({
        contributors: [
          { name: 'Alice', email: 'a@test.com', commits: 90 },
          { name: 'Bob', email: 'b@test.com', commits: 10 },
        ],
        modules: [{ name: 'core', path: 'src/core', fileCount: 10 }],
      });
      const result = estimateComplexity(profile);
      expect(result.busFactor).toHaveLength(1);
      expect(result.busFactor[0].topContributor).toBe('Alice');
      expect(result.busFactor[0].pct).toBe(90);
    });

    it('returns empty bus factor when contributors are balanced', () => {
      const profile = makeProfile({
        contributors: [
          { name: 'Alice', email: 'a@test.com', commits: 50 },
          { name: 'Bob', email: 'b@test.com', commits: 50 },
        ],
      });
      const result = estimateComplexity(profile);
      expect(result.busFactor).toEqual([]);
    });
  });
});
