import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseRepoUrl,
  createGitHubClient,
  GitHubApiError,
} from '../../src/core/github.js';

describe('parseRepoUrl', () => {
  it('parses standard GitHub URL', () => {
    expect(parseRepoUrl('https://github.com/acme/repo')).toEqual({
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('parses GitHub URL with .git suffix', () => {
    expect(parseRepoUrl('https://github.com/acme/repo.git')).toEqual({
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('parses URL with hyphens and dots', () => {
    expect(parseRepoUrl('https://github.com/my-org/my-app.js')).toEqual({
      owner: 'my-org',
      repo: 'my-app',
    });
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseRepoUrl('https://gitlab.com/acme/repo')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseRepoUrl('not-a-url')).toBeNull();
  });

  it('returns null for incomplete GitHub URL', () => {
    expect(parseRepoUrl('https://github.com/acme')).toBeNull();
  });
});

describe('createGitHubClient', () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.restoreAllMocks();
  });

  it('throws UNAUTHORIZED when no token available', () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => createGitHubClient()).toThrow(GitHubApiError);
    expect(() => createGitHubClient()).toThrow(/token required/);
  });

  it('uses provided token over env var', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    // Should not throw — token is provided
    const client = createGitHubClient('my-token');
    expect(client).toBeTruthy();
  });

  it('uses GITHUB_TOKEN env var as fallback', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    const client = createGitHubClient();
    expect(client).toBeTruthy();
  });

  describe('listCommits', () => {
    it('parses commit data from API response', async () => {
      const mockResponse = [
        {
          sha: 'abc123',
          commit: {
            message: 'feat: add feature',
            author: { name: 'Alice', date: '2025-01-01T00:00:00Z' },
          },
          files: [{ filename: 'src/index.ts' }],
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = createGitHubClient('test-token');
      const commits = await client.listCommits('acme', 'repo');

      expect(commits).toHaveLength(1);
      expect(commits[0].sha).toBe('abc123');
      expect(commits[0].message).toBe('feat: add feature');
      expect(commits[0].author).toBe('Alice');
      expect(commits[0].files).toEqual(['src/index.ts']);
    });

    it('respects limit parameter', async () => {
      const mockResponse = Array.from({ length: 5 }, (_, i) => ({
        sha: `sha-${i}`,
        commit: {
          message: `commit ${i}`,
          author: { name: 'Alice', date: '2025-01-01T00:00:00Z' },
        },
      }));

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = createGitHubClient('test-token');
      const commits = await client.listCommits('acme', 'repo', { limit: 3 });

      expect(commits).toHaveLength(3);
    });

    it('follows pagination via Link header', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'X-RateLimit-Remaining': '100',
            Link: '<https://api.github.com/repos/acme/repo/commits?page=2>; rel="next"',
          }),
          json: () => Promise.resolve([{
            sha: 'page1',
            commit: { message: 'first', author: { name: 'A', date: '2025-01-01T00:00:00Z' } },
          }]),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'X-RateLimit-Remaining': '99' }),
          json: () => Promise.resolve([{
            sha: 'page2',
            commit: { message: 'second', author: { name: 'A', date: '2025-01-02T00:00:00Z' } },
          }]),
        } as Response);

      const client = createGitHubClient('test-token');
      const commits = await client.listCommits('acme', 'repo', { limit: 10 });

      expect(commits).toHaveLength(2);
      expect(commits[0].sha).toBe('page1');
      expect(commits[1].sha).toBe('page2');
    });
  });

  describe('getTree', () => {
    it('parses tree entries', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
        json: () => Promise.resolve({
          tree: [
            { path: 'src', type: 'tree' },
            { path: 'src/index.ts', type: 'blob', size: 500 },
          ],
        }),
      } as Response);

      const client = createGitHubClient('test-token');
      const tree = await client.getTree('acme', 'repo');

      expect(tree).toHaveLength(2);
      expect(tree[0]).toEqual({ path: 'src', type: 'dir', size: undefined });
      expect(tree[1]).toEqual({ path: 'src/index.ts', type: 'file', size: 500 });
    });
  });

  describe('getFileContent', () => {
    it('decodes base64 content', async () => {
      const encoded = Buffer.from('console.log("hello")').toString('base64');

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
        json: () => Promise.resolve({ content: encoded, encoding: 'base64' }),
      } as Response);

      const client = createGitHubClient('test-token');
      const content = await client.getFileContent('acme', 'repo', 'src/index.ts');

      expect(content).toBe('console.log("hello")');
    });

    it('throws DECODE_ERROR when no content', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
        json: () => Promise.resolve({}),
      } as Response);

      const client = createGitHubClient('test-token');
      await expect(client.getFileContent('acme', 'repo', 'missing.ts'))
        .rejects.toThrow(GitHubApiError);
    });
  });

  describe('error handling', () => {
    it('throws NOT_FOUND on 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
      } as Response);

      const client = createGitHubClient('test-token');
      await expect(client.listCommits('acme', 'nonexistent'))
        .rejects.toThrow(GitHubApiError);
    });

    it('throws UNAUTHORIZED on 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'X-RateLimit-Remaining': '100' }),
      } as Response);

      const client = createGitHubClient('test-token');
      await expect(client.listCommits('acme', 'repo'))
        .rejects.toThrow(GitHubApiError);
    });

    it('throws RATE_LIMITED on HTTP 429', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        }),
      } as Response);

      const client = createGitHubClient('test-token');
      await expect(client.listCommits('acme', 'repo'))
        .rejects.toThrow(GitHubApiError);
    });

    it('does not throw when remaining is 0 but response is 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'X-RateLimit-Remaining': '0',
          Link: '',
        }),
        json: async () => [],
      } as unknown as Response);

      const client = createGitHubClient('test-token');
      const result = await client.listCommits('acme', 'repo');
      expect(result).toEqual([]);
    });

    it('throws NETWORK on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

      const client = createGitHubClient('test-token');
      await expect(client.listCommits('acme', 'repo'))
        .rejects.toThrow(GitHubApiError);
    });
  });
});
