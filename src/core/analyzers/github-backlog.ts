// SLOPE — GitHub Backlog Analyzer
// Fetches open issues and milestones, groups by label and milestone.

import type { GitHubClient, GitHubIssue, GitHubMilestone } from '../github.js';

export interface GitHubBacklogAnalysis {
  issues: GitHubIssue[];
  issuesByLabel: Record<string, GitHubIssue[]>;
  issuesByMilestone: Record<string, GitHubIssue[]>;
  highPriority: GitHubIssue[];
  milestones: GitHubMilestone[];
}

const HIGH_PRIORITY_LABELS = ['priority', 'bug', 'security', 'critical', 'urgent', 'p0', 'p1'];

function isHighPriority(labels: string[]): boolean {
  return labels.some(label => {
    const lower = label.toLowerCase();
    return HIGH_PRIORITY_LABELS.some(hp => lower.includes(hp));
  });
}

/**
 * Analyze a GitHub repo's backlog: open issues grouped by label/milestone,
 * high-priority detection, and milestone listing.
 */
export async function analyzeGitHubBacklog(
  owner: string,
  repo: string,
  client: GitHubClient,
): Promise<GitHubBacklogAnalysis> {
  const [issues, milestones] = await Promise.all([
    client.listIssues(owner, repo, { state: 'open', limit: 200 }),
    client.listMilestones(owner, repo, { state: 'all' }),
  ]);

  const issuesByLabel: Record<string, GitHubIssue[]> = {};
  const issuesByMilestone: Record<string, GitHubIssue[]> = {};
  const highPriority: GitHubIssue[] = [];

  for (const issue of issues) {
    // Group by label
    for (const label of issue.labels) {
      if (!issuesByLabel[label]) issuesByLabel[label] = [];
      issuesByLabel[label].push(issue);
    }

    // Group by milestone
    if (issue.milestone) {
      const msTitle = issue.milestone.title;
      if (!issuesByMilestone[msTitle]) issuesByMilestone[msTitle] = [];
      issuesByMilestone[msTitle].push(issue);
    }

    // High priority detection
    if (isHighPriority(issue.labels)) {
      highPriority.push(issue);
    }
  }

  return { issues, issuesByLabel, issuesByMilestone, highPriority, milestones };
}
