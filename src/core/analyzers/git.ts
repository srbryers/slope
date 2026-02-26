// SLOPE — Git History Analyzer: commits, contributors, cadence, branches, releases
import { execSync } from 'node:child_process';
import type { GitProfile } from './types.js';

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function parseContributors(output: string): Array<{ name: string; email: string; commits: number }> {
  if (!output) return [];
  const contributors: Array<{ name: string; email: string; commits: number }> = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^\s*(\d+)\s+(.+?)\s+<([^>]+)>$/);
    if (match) {
      contributors.push({
        commits: parseInt(match[1], 10),
        name: match[2].trim(),
        email: match[3].trim(),
      });
    }
  }
  return contributors.sort((a, b) => b.commits - a.commits);
}

function inferCadence(commitsPerWeek: number): GitProfile['inferredCadence'] {
  if (commitsPerWeek >= 5) return 'daily';
  if (commitsPerWeek >= 2) return 'weekly';
  if (commitsPerWeek >= 0.5) return 'biweekly';
  if (commitsPerWeek >= 0.2) return 'monthly';
  return 'sporadic';
}

export async function analyzeGit(cwd: string): Promise<GitProfile> {
  // Check if we're in a git repo
  const isGit = git('rev-parse --is-inside-work-tree', cwd);
  if (isGit !== 'true') {
    return {
      totalCommits: 0,
      commitsLast90d: 0,
      commitsPerWeek: 0,
      contributors: [],
      activeBranches: [],
      inferredCadence: 'sporadic',
    };
  }

  // Total commits
  const totalStr = git('rev-list --count HEAD', cwd);
  const totalCommits = parseInt(totalStr, 10) || 0;

  // Commits in last 90 days
  const recentStr = git('log --oneline --since="90 days ago"', cwd);
  const commitsLast90d = recentStr ? recentStr.split('\n').length : 0;

  // Commits per week (90 days ≈ 12.86 weeks)
  const commitsPerWeek = commitsLast90d > 0 ? Math.round((commitsLast90d / 12.86) * 100) / 100 : 0;

  // Contributors (last 90 days)
  const shortlog = git('shortlog -sne --since="90 days ago" HEAD', cwd);
  const contributors = parseContributors(shortlog);

  // Active branches
  const branchOutput = git('branch -r --no-merged', cwd);
  const activeBranches = branchOutput
    ? branchOutput.split('\n')
        .map(b => b.trim())
        .filter(b => b && !b.includes('HEAD') && !b.includes('->'))
        .map(b => b.replace(/^origin\//, ''))
    : [];

  // Last release tag
  let lastRelease: GitProfile['lastRelease'];
  const tag = git('describe --tags --abbrev=0', cwd);
  if (tag) {
    const tagDate = git(`log -1 --format=%aI ${tag}`, cwd);
    lastRelease = { tag, date: tagDate || new Date().toISOString() };
  }

  const inferredCadence = inferCadence(commitsPerWeek);

  return {
    totalCommits,
    commitsLast90d,
    commitsPerWeek,
    contributors,
    activeBranches,
    lastRelease,
    inferredCadence,
  };
}
