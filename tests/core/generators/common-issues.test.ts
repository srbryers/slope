import { describe, it, expect } from 'vitest';
import { generateCommonIssues } from '../../../src/core/generators/common-issues.js';
import type { RepoProfile } from '../../../src/core/analyzers/types.js';
import type { BacklogAnalysis } from '../../../src/core/analyzers/backlog.js';

function makeProfile(overrides?: {
  testFileCount?: number;
  largeFiles?: RepoProfile['structure']['largeFiles'];
  isMonorepo?: boolean;
  packageManager?: string;
}): RepoProfile {
  return {
    analyzedAt: new Date().toISOString(),
    analyzersRun: ['stack', 'structure', 'git', 'testing'],
    stack: {
      primaryLanguage: 'TypeScript',
      languages: { TypeScript: 100 },
      frameworks: ['vitest'],
      packageManager: overrides?.packageManager ?? 'pnpm',
      runtime: 'node',
    },
    structure: {
      totalFiles: 50, sourceFiles: 30, testFiles: overrides?.testFileCount ?? 10,
      maxDepth: 4, isMonorepo: overrides?.isMonorepo ?? false,
      modules: [{ name: 'core', path: 'src/core', fileCount: 15 }],
      largeFiles: overrides?.largeFiles ?? [],
    },
    git: {
      totalCommits: 100, commitsLast90d: 50, commitsPerWeek: 5,
      contributors: [{ name: 'Alice', email: 'a@test.com', commits: 100 }],
      activeBranches: ['main'],
      inferredCadence: 'weekly',
    },
    testing: {
      framework: 'vitest', testFileCount: overrides?.testFileCount ?? 10,
      hasTestScript: true, hasCoverage: false, testDirs: ['tests'],
    },
  };
}

function makeBacklog(todosByModule?: Record<string, BacklogAnalysis['todos']>): BacklogAnalysis {
  const modules = todosByModule ?? {};
  const todos = Object.values(modules).flat();
  return { todos, todosByModule: modules };
}

describe('generateCommonIssues', () => {
  it('creates pattern from HACK cluster (3+ in same module)', () => {
    const backlog = makeBacklog({
      core: [
        { type: 'HACK', text: 'workaround 1', file: 'src/core/a.ts', line: 1 },
        { type: 'HACK', text: 'workaround 2', file: 'src/core/b.ts', line: 1 },
        { type: 'HACK', text: 'workaround 3', file: 'src/core/c.ts', line: 1 },
      ],
    });
    const result = generateCommonIssues(makeProfile(), backlog);
    expect(result.recurring_patterns).toHaveLength(1);
    expect(result.recurring_patterns[0].title).toContain('HACK');
    expect(result.recurring_patterns[0].title).toContain('core');
    expect(result.recurring_patterns[0].reported_by).toContain('analyzer');
  });

  it('creates pattern from FIXME cluster', () => {
    const backlog = makeBacklog({
      cli: [
        { type: 'FIXME', text: 'fix 1', file: 'src/cli/a.ts', line: 1 },
        { type: 'FIXME', text: 'fix 2', file: 'src/cli/b.ts', line: 1 },
        { type: 'FIXME', text: 'fix 3', file: 'src/cli/c.ts', line: 1 },
      ],
    });
    const result = generateCommonIssues(makeProfile(), backlog);
    expect(result.recurring_patterns).toHaveLength(1);
    expect(result.recurring_patterns[0].category).toBe('code-quality');
  });

  it('ignores modules with fewer than 3 HACK/FIXME', () => {
    const backlog = makeBacklog({
      core: [
        { type: 'HACK', text: 'workaround', file: 'src/core/a.ts', line: 1 },
        { type: 'TODO', text: 'not a hack', file: 'src/core/b.ts', line: 1 },
      ],
    });
    const result = generateCommonIssues(makeProfile(), backlog);
    expect(result.recurring_patterns).toEqual([]);
  });

  it('adds no-test-coverage warning', () => {
    const result = generateCommonIssues(makeProfile({ testFileCount: 0 }), makeBacklog());
    const titles = result.recurring_patterns.map(p => p.title);
    expect(titles).toContain('No test coverage');
  });

  it('adds large file complexity warning', () => {
    const result = generateCommonIssues(
      makeProfile({ largeFiles: [{ path: 'big.ts', lines: 1200 }] }),
      makeBacklog(),
    );
    const titles = result.recurring_patterns.map(p => p.title);
    expect(titles).toContain('Large file complexity');
  });

  it('adds monorepo warning when no workspace tooling', () => {
    const result = generateCommonIssues(
      makeProfile({ isMonorepo: true, packageManager: 'npm' }),
      makeBacklog(),
    );
    const titles = result.recurring_patterns.map(p => p.title);
    expect(titles).toContain('Monorepo without workspace tooling');
  });

  it('does not add monorepo warning when pnpm is used', () => {
    const result = generateCommonIssues(
      makeProfile({ isMonorepo: true, packageManager: 'pnpm' }),
      makeBacklog(),
    );
    const titles = result.recurring_patterns.map(p => p.title);
    expect(titles).not.toContain('Monorepo without workspace tooling');
  });

  it('all patterns have sequential IDs', () => {
    const backlog = makeBacklog({
      core: [
        { type: 'HACK', text: 'a', file: 'src/core/a.ts', line: 1 },
        { type: 'HACK', text: 'b', file: 'src/core/b.ts', line: 1 },
        { type: 'HACK', text: 'c', file: 'src/core/c.ts', line: 1 },
      ],
    });
    const result = generateCommonIssues(makeProfile({ testFileCount: 0 }), backlog);
    const ids = result.recurring_patterns.map(p => p.id);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
  });

  it('all patterns have empty sprints_hit', () => {
    const backlog = makeBacklog({
      core: [
        { type: 'HACK', text: 'a', file: 'a.ts', line: 1 },
        { type: 'HACK', text: 'b', file: 'b.ts', line: 1 },
        { type: 'HACK', text: 'c', file: 'c.ts', line: 1 },
      ],
    });
    const result = generateCommonIssues(makeProfile(), backlog);
    for (const p of result.recurring_patterns) {
      expect(p.sprints_hit).toEqual([]);
    }
  });
});
