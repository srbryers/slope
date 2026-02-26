import { describe, it, expect } from 'vitest';
import { generateRoadmap } from '../../../src/core/generators/roadmap.js';
import type { RepoProfile } from '../../../src/core/analyzers/types.js';
import type { ComplexityProfile } from '../../../src/core/analyzers/complexity.js';
import type { MergedBacklog } from '../../../src/core/analyzers/backlog-merged.js';
import type { GitHubBacklogAnalysis } from '../../../src/core/analyzers/github-backlog.js';
import type { GitHubIssue, GitHubMilestone } from '../../../src/core/github.js';

function makeProfile(): RepoProfile {
  return {
    analyzedAt: new Date().toISOString(),
    analyzersRun: ['stack', 'structure', 'git', 'testing', 'ci', 'docs'],
    stack: { primaryLanguage: 'TypeScript', languages: { TypeScript: 100 }, frameworks: [] },
    structure: { totalFiles: 50, sourceFiles: 30, testFiles: 10, maxDepth: 4, isMonorepo: false, modules: [], largeFiles: [] },
    git: { totalCommits: 100, commitsLast90d: 50, commitsPerWeek: 5, contributors: [{ name: 'Alice', email: 'a@test.com', commits: 100 }], activeBranches: ['main'], inferredCadence: 'weekly' },
    testing: { testFileCount: 10, hasTestScript: true, hasCoverage: false, testDirs: ['tests'] },
    ci: { configFiles: [], hasTestStage: false, hasBuildStage: false, hasDeployStage: false },
    docs: { hasReadme: true, hasContributing: false, hasChangelog: false, hasAdr: false, hasApiDocs: false },
  };
}

function makeComplexity(): ComplexityProfile {
  return { estimatedPar: 4, estimatedSlope: 2, slopeFactors: [], riskAreas: [], busFactor: [] };
}

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: 'Test issue',
    state: 'open',
    labels: [],
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRemote(
  issues: GitHubIssue[],
  milestones: GitHubMilestone[] = [],
): GitHubBacklogAnalysis {
  const issuesByLabel: Record<string, GitHubIssue[]> = {};
  const issuesByMilestone: Record<string, GitHubIssue[]> = {};
  for (const issue of issues) {
    for (const label of issue.labels) {
      if (!issuesByLabel[label]) issuesByLabel[label] = [];
      issuesByLabel[label].push(issue);
    }
    if (issue.milestone) {
      const t = issue.milestone.title;
      if (!issuesByMilestone[t]) issuesByMilestone[t] = [];
      issuesByMilestone[t].push(issue);
    }
  }
  return { issues, issuesByLabel, issuesByMilestone, highPriority: [], milestones };
}

function makeBacklog(remote?: GitHubBacklogAnalysis, localTodos = 0): MergedBacklog {
  const todos = Array.from({ length: localTodos }, (_, i) => ({
    type: 'TODO' as const, text: `task ${i}`, file: `src/m${i % 3}/f.ts`, line: i + 1,
  }));
  const todosByModule: Record<string, typeof todos> = {};
  for (const t of todos) {
    const mod = t.file.split('/')[1];
    if (!todosByModule[mod]) todosByModule[mod] = [];
    todosByModule[mod].push(t);
  }
  return {
    local: { todos, todosByModule },
    remote,
    totalItems: todos.length + (remote?.issues.length ?? 0),
  };
}

describe('generateRoadmap', () => {
  it('generates phases from milestones', () => {
    const milestones: GitHubMilestone[] = [
      { number: 1, title: 'v1.0', state: 'open', openIssues: 2, closedIssues: 0 },
      { number: 2, title: 'v2.0', state: 'open', openIssues: 1, closedIssues: 0 },
    ];
    const issues = [
      makeIssue({ number: 1, title: 'Auth', labels: ['feature'], milestone: { number: 1, title: 'v1.0' } }),
      makeIssue({ number: 2, title: 'Login', labels: ['feature'], milestone: { number: 1, title: 'v1.0' } }),
      makeIssue({ number: 3, title: 'Dashboard', labels: ['feature'], milestone: { number: 2, title: 'v2.0' } }),
    ];
    const remote = makeRemote(issues, milestones);
    const backlog = makeBacklog(remote);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);

    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].name).toContain('v1.0');
    expect(result.phases[1].name).toContain('v2.0');
    expect(result.sprints).toHaveLength(2);
    expect(result.sprints[0].tickets).toHaveLength(2);
    expect(result.sprints[1].tickets).toHaveLength(1);
  });

  it('falls back to label-based grouping when no milestones', () => {
    const issues = [
      makeIssue({ number: 1, title: 'Fix crash', labels: ['bug'] }),
      makeIssue({ number: 2, title: 'Fix leak', labels: ['bug'] }),
      makeIssue({ number: 3, title: 'Add feature', labels: ['enhancement'] }),
    ];
    const remote = makeRemote(issues);
    const backlog = makeBacklog(remote);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);

    expect(result.sprints.length).toBeGreaterThanOrEqual(1);
    expect(result.description).toContain('labels');
  });

  it('falls back to local TODOs when no remote data', () => {
    const backlog = makeBacklog(undefined, 6);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);

    expect(result.sprints).toHaveLength(1);
    expect(result.sprints[0].theme).toBe('Local Backlog Cleanup');
    expect(result.sprints[0].tickets.length).toBeGreaterThanOrEqual(1);
    expect(result.description).toContain('local');
  });

  it('generates generic starter when no data at all', () => {
    const backlog = makeBacklog(undefined, 0);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);

    expect(result.sprints).toHaveLength(1);
    expect(result.sprints[0].theme).toBe('Getting Started');
    expect(result.sprints[0].tickets[0].title).toContain('infrastructure');
  });

  it('infers dependencies from issue body references', () => {
    const milestones: GitHubMilestone[] = [
      { number: 1, title: 'Sprint 1', state: 'open', openIssues: 2, closedIssues: 0 },
    ];
    const issues = [
      makeIssue({ number: 10, title: 'Base', labels: ['feature'], milestone: { number: 1, title: 'Sprint 1' } }),
      makeIssue({ number: 11, title: 'Depends', labels: ['feature'], milestone: { number: 1, title: 'Sprint 1' }, body: 'depends on #10' }),
    ];
    const remote = makeRemote(issues, milestones);
    const backlog = makeBacklog(remote);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);

    const depTicket = result.sprints[0].tickets[1];
    expect(depTicket.depends_on).toBeDefined();
    expect(depTicket.depends_on).toContain(result.sprints[0].tickets[0].key);
  });

  it('produces valid RoadmapDefinition structure', () => {
    const milestones: GitHubMilestone[] = [
      { number: 1, title: 'v1.0', state: 'open', openIssues: 1, closedIssues: 0 },
    ];
    const issues = [
      makeIssue({ number: 1, title: 'Task', labels: ['feature'], milestone: { number: 1, title: 'v1.0' } }),
    ];
    const remote = makeRemote(issues, milestones);
    const backlog = makeBacklog(remote);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);

    expect(result.name).toBeTruthy();
    expect(result.phases.length).toBeGreaterThanOrEqual(1);
    expect(result.sprints.length).toBeGreaterThanOrEqual(1);

    for (const sprint of result.sprints) {
      expect(sprint.id).toBeGreaterThan(0);
      expect(sprint.par).toBeGreaterThanOrEqual(3);
      expect(sprint.par).toBeLessThanOrEqual(5);
      for (const ticket of sprint.tickets) {
        expect(ticket.key).toMatch(/^S\d+-\d+$/);
        expect(ticket.title).toBeTruthy();
        expect(['driver', 'long_iron', 'short_iron', 'wedge', 'putter']).toContain(ticket.club);
      }
    }
  });

  it('classifies bugs as wedge, features as short_iron', () => {
    const milestones: GitHubMilestone[] = [
      { number: 1, title: 'v1', state: 'open', openIssues: 2, closedIssues: 0 },
    ];
    const issues = [
      makeIssue({ number: 1, title: 'Fix crash', labels: ['bug'], milestone: { number: 1, title: 'v1' } }),
      makeIssue({ number: 2, title: 'New feature', labels: ['feature'], milestone: { number: 1, title: 'v1' } }),
    ];
    const remote = makeRemote(issues, milestones);
    const backlog = makeBacklog(remote);

    const result = generateRoadmap(makeProfile(), makeComplexity(), backlog);
    const tickets = result.sprints[0].tickets;
    expect(tickets[0].club).toBe('wedge');
    expect(tickets[1].club).toBe('short_iron');
  });
});
