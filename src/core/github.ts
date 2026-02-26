// SLOPE — Remote Git Analysis
// Lightweight GitHub API client using fetch() — no octokit dependency.

export type GitHubErrorCode = 'NOT_FOUND' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NETWORK' | 'DECODE_ERROR';

export class GitHubApiError extends Error {
  constructor(public code: GitHubErrorCode, message: string, public retryAfter?: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  files?: string[];
}

export interface GitHubTreeEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: string[];
  milestone?: { number: number; title: string };
  body?: string;
  createdAt: string;
}

export interface GitHubMilestone {
  number: number;
  title: string;
  description?: string;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
  dueOn?: string;
}

export interface GitHubClient {
  listCommits(owner: string, repo: string, opts?: {
    branch?: string;
    since?: string;
    limit?: number;
  }): Promise<GitHubCommit[]>;

  getTree(owner: string, repo: string, opts?: {
    branch?: string;
    recursive?: boolean;
  }): Promise<GitHubTreeEntry[]>;

  getFileContent(owner: string, repo: string, path: string, opts?: {
    branch?: string;
  }): Promise<string>;

  listIssues(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string;
    milestone?: number;
    limit?: number;
  }): Promise<GitHubIssue[]>;

  listMilestones(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all';
  }): Promise<GitHubMilestone[]>;
}

const API_BASE = 'https://api.github.com';

/** Parse a GitHub URL into owner/repo components */
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  // Handle https://github.com/owner/repo or https://github.com/owner/repo.git
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function githubFetch(
  url: string,
  token: string,
  method = 'GET',
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'slope-dev',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers });
  } catch (err) {
    throw new GitHubApiError('NETWORK', `Network error: ${(err as Error).message}`);
  }

  // Check rate limiting — only reject on actual 429, not on remaining=0 header
  // (remaining=0 means "this was your last allowed request", the response is still valid)
  if (response.status === 429) {
    const resetHeader = response.headers.get('X-RateLimit-Reset');
    const retryAfter = resetHeader ? parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000) : undefined;
    throw new GitHubApiError('RATE_LIMITED', 'GitHub API rate limit exceeded', retryAfter);
  }

  if (response.status === 401 || response.status === 403) {
    throw new GitHubApiError('UNAUTHORIZED', `GitHub API authentication failed (${response.status})`);
  }
  if (response.status === 404) {
    throw new GitHubApiError('NOT_FOUND', `GitHub resource not found: ${url}`);
  }
  if (!response.ok) {
    throw new GitHubApiError('NETWORK', `GitHub API error ${response.status}: ${response.statusText}`);
  }

  return response;
}

/** Parse Link header for pagination */
function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/** Create a GitHubClient. Token from parameter or GITHUB_TOKEN env var. */
export function createGitHubClient(token?: string): GitHubClient {
  const resolvedToken = token ?? process.env.GITHUB_TOKEN ?? '';
  if (!resolvedToken) {
    throw new GitHubApiError('UNAUTHORIZED', 'GitHub token required. Pass token or set GITHUB_TOKEN env var.');
  }

  return {
    async listCommits(owner, repo, opts = {}) {
      const { branch, since, limit = 100 } = opts;
      const params = new URLSearchParams();
      if (branch) params.set('sha', branch);
      if (since) params.set('since', since);
      params.set('per_page', String(Math.min(limit, 100)));

      const commits: GitHubCommit[] = [];
      let url: string | null = `${API_BASE}/repos/${owner}/${repo}/commits?${params}`;

      while (url && commits.length < limit) {
        const response = await githubFetch(url, resolvedToken);
        const data = await response.json() as Array<{
          sha: string;
          commit: { message: string; author: { name: string; date: string } };
          files?: Array<{ filename: string }>;
        }>;

        for (const item of data) {
          if (commits.length >= limit) break;
          commits.push({
            sha: item.sha,
            message: item.commit.message,
            author: item.commit.author.name,
            timestamp: item.commit.author.date,
            files: item.files?.map(f => f.filename),
          });
        }

        url = getNextPageUrl(response.headers.get('Link'));
      }

      return commits;
    },

    async getTree(owner, repo, opts = {}) {
      const { branch = 'HEAD', recursive = true } = opts;
      const recursiveParam = recursive ? '?recursive=1' : '';
      const url = `${API_BASE}/repos/${owner}/${repo}/git/trees/${branch}${recursiveParam}`;

      const response = await githubFetch(url, resolvedToken);
      const data = await response.json() as {
        tree: Array<{ path: string; type: string; size?: number }>;
      };

      return data.tree.map(entry => ({
        path: entry.path,
        type: (entry.type === 'tree' ? 'dir' : 'file') as 'file' | 'dir',
        size: entry.size,
      }));
    },

    async getFileContent(owner, repo, path, opts = {}) {
      const { branch } = opts;
      const params = branch ? `?ref=${encodeURIComponent(branch)}` : '';
      const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}${params}`;

      const response = await githubFetch(url, resolvedToken);
      const data = await response.json() as { content?: string; encoding?: string };

      if (!data.content) {
        throw new GitHubApiError('DECODE_ERROR', `No content returned for ${path}`);
      }

      if (data.encoding === 'base64') {
        try {
          return Buffer.from(data.content, 'base64').toString('utf8');
        } catch {
          throw new GitHubApiError('DECODE_ERROR', `Failed to decode base64 content for ${path}`);
        }
      }

      return data.content;
    },

    async listIssues(owner, repo, opts = {}) {
      const { state = 'open', labels, milestone, limit = 200 } = opts;
      const params = new URLSearchParams();
      params.set('state', state);
      params.set('per_page', String(Math.min(limit, 100)));
      if (labels) params.set('labels', labels);
      if (milestone !== undefined) params.set('milestone', String(milestone));

      const issues: GitHubIssue[] = [];
      let url: string | null = `${API_BASE}/repos/${owner}/${repo}/issues?${params}`;

      while (url && issues.length < limit) {
        const response = await githubFetch(url, resolvedToken);
        const data = await response.json() as Array<{
          number: number;
          title: string;
          state: string;
          labels: Array<{ name: string }>;
          milestone?: { number: number; title: string };
          body?: string;
          created_at: string;
          pull_request?: unknown;
        }>;

        for (const item of data) {
          if (issues.length >= limit) break;
          // Skip pull requests (GitHub API returns PRs in issues endpoint)
          if (item.pull_request) continue;
          issues.push({
            number: item.number,
            title: item.title,
            state: item.state as 'open' | 'closed',
            labels: item.labels.map(l => l.name),
            milestone: item.milestone ? { number: item.milestone.number, title: item.milestone.title } : undefined,
            body: item.body ?? undefined,
            createdAt: item.created_at,
          });
        }

        url = getNextPageUrl(response.headers.get('Link'));
      }

      return issues;
    },

    async listMilestones(owner, repo, opts = {}) {
      const { state = 'all' } = opts;
      const params = new URLSearchParams();
      params.set('state', state);
      params.set('per_page', '100');

      const milestones: GitHubMilestone[] = [];
      let url: string | null = `${API_BASE}/repos/${owner}/${repo}/milestones?${params}`;

      while (url) {
        const response = await githubFetch(url, resolvedToken);
        const data = await response.json() as Array<{
          number: number;
          title: string;
          description?: string;
          state: string;
          open_issues: number;
          closed_issues: number;
          due_on?: string;
        }>;

        for (const item of data) {
          milestones.push({
            number: item.number,
            title: item.title,
            description: item.description ?? undefined,
            state: item.state as 'open' | 'closed',
            openIssues: item.open_issues,
            closedIssues: item.closed_issues,
            dueOn: item.due_on ?? undefined,
          });
        }

        url = getNextPageUrl(response.headers.get('Link'));
      }

      return milestones;
    },
  };
}
