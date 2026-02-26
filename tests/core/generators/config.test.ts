import { describe, it, expect } from 'vitest';
import { generateConfig } from '../../../src/core/generators/config.js';
import type { RepoProfile } from '../../../src/core/analyzers/types.js';

function makeProfile(overrides: Partial<{
  primaryLanguage: string;
  frameworks: string[];
  inferredCadence: RepoProfile['git']['inferredCadence'];
  contributors: RepoProfile['git']['contributors'];
}>): RepoProfile {
  return {
    analyzedAt: new Date().toISOString(),
    analyzersRun: ['stack', 'structure', 'git', 'testing'],
    stack: {
      primaryLanguage: overrides.primaryLanguage ?? 'TypeScript',
      languages: { TypeScript: 100 },
      frameworks: overrides.frameworks ?? ['vitest', 'express'],
      packageManager: 'pnpm',
      runtime: 'node',
    },
    structure: {
      totalFiles: 50, sourceFiles: 30, testFiles: 10, maxDepth: 4,
      isMonorepo: false, modules: [], largeFiles: [],
    },
    git: {
      totalCommits: 100, commitsLast90d: 50, commitsPerWeek: 5,
      contributors: overrides.contributors ?? [
        { name: 'Alice', email: 'alice@test.com', commits: 60 },
        { name: 'Bob', email: 'bob@test.com', commits: 40 },
      ],
      activeBranches: ['main'],
      inferredCadence: overrides.inferredCadence ?? 'weekly',
    },
    testing: {
      framework: 'vitest', testFileCount: 10,
      hasTestScript: true, hasCoverage: false, testDirs: ['tests'],
    },
  };
}

describe('generateConfig', () => {
  it('generates project name from language + framework', () => {
    const config = generateConfig(makeProfile({}));
    expect(config.projectName).toBe('TypeScript-vitest-project');
  });

  it('falls back to language-only name when no frameworks', () => {
    const config = generateConfig(makeProfile({ frameworks: [] }));
    expect(config.projectName).toBe('TypeScript-project');
  });

  it('maps daily/weekly cadence to weekly', () => {
    expect(generateConfig(makeProfile({ inferredCadence: 'daily' })).sprintCadence).toBe('weekly');
    expect(generateConfig(makeProfile({ inferredCadence: 'weekly' })).sprintCadence).toBe('weekly');
  });

  it('maps biweekly cadence to biweekly', () => {
    expect(generateConfig(makeProfile({ inferredCadence: 'biweekly' })).sprintCadence).toBe('biweekly');
  });

  it('maps monthly/sporadic cadence to monthly', () => {
    expect(generateConfig(makeProfile({ inferredCadence: 'monthly' })).sprintCadence).toBe('monthly');
    expect(generateConfig(makeProfile({ inferredCadence: 'sporadic' })).sprintCadence).toBe('monthly');
  });

  it('extracts top 5 contributors as team', () => {
    const contributors = Array.from({ length: 7 }, (_, i) => ({
      name: `Dev ${i}`, email: `dev${i}@test.com`, commits: 100 - i * 10,
    }));
    const config = generateConfig(makeProfile({ contributors }));
    expect(Object.keys(config.team)).toHaveLength(5);
    expect(config.team['dev-0']).toBe('Dev 0');
  });

  it('copies frameworks to techStack', () => {
    const config = generateConfig(makeProfile({ frameworks: ['react', 'next'] }));
    expect(config.techStack).toEqual(['react', 'next']);
  });

  it('defaults metaphor to golf', () => {
    expect(generateConfig(makeProfile({})).metaphor).toBe('golf');
  });
});
