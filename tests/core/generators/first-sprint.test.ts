import { describe, it, expect } from 'vitest';
import { generateFirstSprint } from '../../../src/core/generators/first-sprint.js';
import type { RepoProfile } from '../../../src/core/analyzers/types.js';
import type { ComplexityProfile } from '../../../src/core/analyzers/complexity.js';
import type { BacklogAnalysis } from '../../../src/core/generators/first-sprint.js';

function makeProfile(overrides?: Partial<RepoProfile['testing']>): RepoProfile {
  const defaults: RepoProfile['testing'] = {
    framework: 'vitest',
    testFileCount: 10,
    hasTestScript: true,
    hasCoverage: false,
    testDirs: ['tests'],
  };
  return {
    analyzedAt: new Date().toISOString(),
    analyzersRun: ['stack', 'structure', 'git', 'testing'],
    stack: {
      primaryLanguage: 'TypeScript',
      languages: { TypeScript: 100 },
      frameworks: ['vitest'],
      packageManager: 'pnpm',
      runtime: 'node',
    },
    structure: {
      totalFiles: 50, sourceFiles: 30, testFiles: 10, maxDepth: 4,
      isMonorepo: false, modules: [{ name: 'core', path: 'src/core', fileCount: 15 }],
      largeFiles: [],
    },
    git: {
      totalCommits: 100, commitsLast90d: 50, commitsPerWeek: 5,
      contributors: [{ name: 'Alice', email: 'alice@test.com', commits: 100 }],
      activeBranches: ['main'],
      inferredCadence: 'weekly',
    },
    testing: { ...defaults, ...overrides },
  };
}

function makeComplexity(overrides?: Partial<ComplexityProfile>): ComplexityProfile {
  return {
    estimatedPar: overrides?.estimatedPar ?? 4,
    estimatedSlope: overrides?.estimatedSlope ?? 2,
    slopeFactors: overrides?.slopeFactors ?? ['monorepo', 'solo-developer'],
    riskAreas: overrides?.riskAreas ?? [],
    busFactor: overrides?.busFactor ?? [],
  };
}

describe('generateFirstSprint', () => {
  it('generates a sprint with par/slope from complexity', () => {
    const result = generateFirstSprint(makeProfile(), makeComplexity({ estimatedPar: 5, estimatedSlope: 3 }));
    expect(result.sprint.par).toBe(5);
    expect(result.sprint.slope).toBe(3);
  });

  it('creates tickets from TODO clusters in backlog', () => {
    const backlog: BacklogAnalysis = {
      todos: [
        { type: 'TODO', text: 'fix auth', file: 'src/core/auth.ts', line: 10 },
        { type: 'TODO', text: 'add tests', file: 'src/core/auth.ts', line: 20 },
        { type: 'TODO', text: 'update api', file: 'src/cli/api.ts', line: 5 },
      ],
      todosByModule: {
        core: [
          { type: 'TODO', text: 'fix auth', file: 'src/core/auth.ts', line: 10 },
          { type: 'TODO', text: 'add tests', file: 'src/core/auth.ts', line: 20 },
        ],
        cli: [
          { type: 'TODO', text: 'update api', file: 'src/cli/api.ts', line: 5 },
        ],
      },
    };
    const result = generateFirstSprint(makeProfile(), makeComplexity(), backlog);
    expect(result.sprint.tickets.length).toBeGreaterThanOrEqual(2);
    expect(result.sprint.tickets[0].title).toContain('TODO');
    expect(result.sprint.tickets[0].title).toContain('core');
  });

  it('adds setup task when no test framework detected', () => {
    const profile = makeProfile({ framework: undefined });
    const result = generateFirstSprint(profile, makeComplexity());
    const titles = result.sprint.tickets.map(t => t.title);
    expect(titles).toContain('Configure test framework');
  });

  it('adds coverage task when framework exists but no coverage', () => {
    const profile = makeProfile({ hasCoverage: false });
    const result = generateFirstSprint(profile, makeComplexity());
    const titles = result.sprint.tickets.map(t => t.title);
    expect(titles).toContain('Add test coverage reporting');
  });

  it('does not add coverage task when coverage already exists', () => {
    const profile = makeProfile({ hasCoverage: true });
    const result = generateFirstSprint(profile, makeComplexity());
    const titles = result.sprint.tickets.map(t => t.title);
    expect(titles).not.toContain('Add test coverage reporting');
  });

  it('generates at least one ticket even with no backlog or gaps', () => {
    const profile = makeProfile({ hasCoverage: true });
    const result = generateFirstSprint(profile, makeComplexity());
    expect(result.sprint.tickets.length).toBeGreaterThanOrEqual(1);
  });

  it('wraps sprint in a valid roadmap structure', () => {
    const result = generateFirstSprint(makeProfile(), makeComplexity());
    expect(result.roadmap.phases).toHaveLength(1);
    expect(result.roadmap.phases[0].sprints).toContain(1);
    expect(result.roadmap.sprints).toHaveLength(1);
    expect(result.roadmap.sprints[0].id).toBe(1);
  });

  it('ticket keys follow S1-N format', () => {
    const backlog: BacklogAnalysis = {
      todos: [
        { type: 'TODO', text: 'a', file: 'src/a/x.ts', line: 1 },
        { type: 'TODO', text: 'b', file: 'src/b/y.ts', line: 1 },
      ],
      todosByModule: {
        a: [{ type: 'TODO', text: 'a', file: 'src/a/x.ts', line: 1 }],
        b: [{ type: 'TODO', text: 'b', file: 'src/b/y.ts', line: 1 }],
      },
    };
    const result = generateFirstSprint(makeProfile(), makeComplexity(), backlog);
    for (const ticket of result.sprint.tickets) {
      expect(ticket.key).toMatch(/^S1-\d+$/);
    }
  });
});
