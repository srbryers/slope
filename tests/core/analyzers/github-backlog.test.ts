import { describe, it, expect } from 'vitest';
import { analyzeGitHubBacklog } from '../../../src/core/analyzers/github-backlog.js';
import type { GitHubClient, GitHubIssue, GitHubMilestone } from '../../../src/core/github.js';

function mockClient(
  issues: GitHubIssue[] = [],
  milestones: GitHubMilestone[] = [],
): GitHubClient {
  return {
    listCommits: async () => [],
    getTree: async () => [],
    getFileContent: async () => '',
    listIssues: async () => issues,
    listMilestones: async () => milestones,
  };
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

describe('analyzeGitHubBacklog', () => {
  it('groups issues by label', async () => {
    const issues = [
      makeIssue({ number: 1, labels: ['bug', 'frontend'] }),
      makeIssue({ number: 2, labels: ['bug'] }),
      makeIssue({ number: 3, labels: ['feature'] }),
    ];
    const client = mockClient(issues);

    const result = await analyzeGitHubBacklog('owner', 'repo', client);
    expect(result.issuesByLabel['bug']).toHaveLength(2);
    expect(result.issuesByLabel['frontend']).toHaveLength(1);
    expect(result.issuesByLabel['feature']).toHaveLength(1);
  });

  it('groups issues by milestone', async () => {
    const ms = { number: 1, title: 'v1.0' };
    const issues = [
      makeIssue({ number: 1, milestone: ms }),
      makeIssue({ number: 2, milestone: ms }),
      makeIssue({ number: 3 }),
    ];
    const client = mockClient(issues);

    const result = await analyzeGitHubBacklog('owner', 'repo', client);
    expect(result.issuesByMilestone['v1.0']).toHaveLength(2);
    expect(Object.keys(result.issuesByMilestone)).toHaveLength(1);
  });

  it('detects high-priority issues by label keywords', async () => {
    const issues = [
      makeIssue({ number: 1, labels: ['bug'] }),
      makeIssue({ number: 2, labels: ['priority:high'] }),
      makeIssue({ number: 3, labels: ['security'] }),
      makeIssue({ number: 4, labels: ['enhancement'] }),
      makeIssue({ number: 5, labels: ['critical'] }),
    ];
    const client = mockClient(issues);

    const result = await analyzeGitHubBacklog('owner', 'repo', client);
    expect(result.highPriority).toHaveLength(4);
    const highNums = result.highPriority.map(i => i.number);
    expect(highNums).toContain(1);
    expect(highNums).toContain(2);
    expect(highNums).toContain(3);
    expect(highNums).toContain(5);
    expect(highNums).not.toContain(4);
  });

  it('returns milestones from client', async () => {
    const milestones: GitHubMilestone[] = [
      { number: 1, title: 'v1.0', state: 'open', openIssues: 5, closedIssues: 3 },
      { number: 2, title: 'v2.0', state: 'open', openIssues: 2, closedIssues: 0 },
    ];
    const client = mockClient([], milestones);

    const result = await analyzeGitHubBacklog('owner', 'repo', client);
    expect(result.milestones).toHaveLength(2);
    expect(result.milestones[0].title).toBe('v1.0');
  });

  it('handles empty issues and milestones', async () => {
    const client = mockClient();

    const result = await analyzeGitHubBacklog('owner', 'repo', client);
    expect(result.issues).toEqual([]);
    expect(result.issuesByLabel).toEqual({});
    expect(result.issuesByMilestone).toEqual({});
    expect(result.highPriority).toEqual([]);
    expect(result.milestones).toEqual([]);
  });

  it('handles issues with multiple high-priority labels without duplicates', async () => {
    const issues = [
      makeIssue({ number: 1, labels: ['bug', 'critical'] }),
    ];
    const client = mockClient(issues);

    const result = await analyzeGitHubBacklog('owner', 'repo', client);
    expect(result.highPriority).toHaveLength(1);
  });
});
