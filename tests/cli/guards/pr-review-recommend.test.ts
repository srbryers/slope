import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prReviewGuard, _internals } from '../../../src/cli/guards/pr-review.js';
import type { HookInput } from '../../../src/core/index.js';

function setupRepoWithBranch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slope-pr-rec-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  execSync('git checkout -q -b main', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# initial');
  execSync('git add -A && git commit -q -m initial', { cwd: dir });
  // Simulate origin/main pointer locally so inferBaseRef can resolve
  execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: dir });

  // Branch with auth-related changes
  execSync('git checkout -q -b feat/auth-token-rotation', { cwd: dir });
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  writeFileSync(join(dir, 'src', 'auth', 'token.ts'), 'export const x = 1;');
  execSync('git add -A && git commit -q -m "feat(S1-1): rotate auth token"', { cwd: dir });
  return dir;
}

function makeInput(stdout: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --fill' },
    tool_response: { stdout },
  };
}

describe('prReviewGuard recommendations (GH #302)', () => {
  let cwd: string;

  beforeEach(() => { cwd = setupRepoWithBranch(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('does not fire on non-PR-create commands', async () => {
    const result = await prReviewGuard(
      { ...makeInput(''), tool_input: { command: 'gh pr view 1' } },
      cwd,
    );
    expect(result).toEqual({ metricReason: 'irrelevant-command' });
  });

  it('does not fire when output is missing PR URL', async () => {
    const result = await prReviewGuard(makeInput('error: failed'), cwd);
    expect(result).toEqual({ metricReason: 'no-match' });
  });

  it('emits context with PR URL extracted from output', async () => {
    const result = await prReviewGuard(
      makeInput('Created: https://github.com/foo/bar/pull/42'),
      cwd,
    );
    expect(result.suggestion).toBeUndefined();
    expect(result.context).toContain('https://github.com/foo/bar/pull/42');
  });

  it('includes recommended review types in the context', async () => {
    const result = await prReviewGuard(
      makeInput('Created: https://github.com/foo/bar/pull/42'),
      cwd,
    );
    // Auth files trigger security review (required)
    expect(result.context).toMatch(/Recommended reviews based on diff:/);
    expect(result.context).toMatch(/security/);
  });

  it('mentions slope pr finalize as a related action', async () => {
    const result = await prReviewGuard(
      makeInput('https://github.com/x/y/pull/1'),
      cwd,
    );
    expect(result.context).toContain('slope pr finalize');
  });

  it('points agents to the transport-independent PR review command', async () => {
    const result = await prReviewGuard(
      makeInput('https://github.com/x/y/pull/42'),
      cwd,
    );
    expect(result.context).toContain('slope pr review --pr=42');
    expect(result.context).toContain('slope pr status --pr=42');
  });
});

describe('prReviewGuard internals', () => {
  it('formatRecommendations marks required reviews', () => {
    const out = _internals.formatRecommendations([
      { review_type: 'security', reason: 'auth files', priority: 'required' },
      { review_type: 'code', reason: 'baseline', priority: 'optional' },
    ]);
    expect(out).toBe('security (required), code');
  });

  it('inferTicketCount counts distinct ticket keys across commits', () => {
    // Use the same repo helper to seed multi-ticket history
    const dir = mkdtempSync(join(tmpdir(), 'slope-pr-rec-tc-'));
    try {
      execSync('git init -q', { cwd: dir });
      execSync('git config user.email t@t', { cwd: dir });
      execSync('git config user.name t', { cwd: dir });
      execSync('git checkout -q -b main', { cwd: dir });
      execSync('git commit -q --allow-empty -m initial', { cwd: dir });
      execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: dir });
      execSync('git checkout -q -b feat/multi', { cwd: dir });
      execSync('git commit -q --allow-empty -m "feat(S1-1): a"', { cwd: dir });
      execSync('git commit -q --allow-empty -m "feat(S1-2): b"', { cwd: dir });
      execSync('git commit -q --allow-empty -m "feat(S1-3): c"', { cwd: dir });
      expect(_internals.inferTicketCount(dir, 'origin/main')).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
