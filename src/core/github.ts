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

  // Check rate limiting
  const remaining = response.headers.get('X-RateLimit-Remaining');
  if (remaining !== null && parseInt(remaining, 10) === 0) {
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
  };
}
