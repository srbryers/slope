import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import '../../../src/core/adapters/claude-code.js';
import { prReviewGuard } from '../../../src/cli/guards/pr-review.js';
import { loadPrReviewState } from '../../../src/cli/pr-review-state.js';
import { createSprintState, saveSprintState } from '../../../src/cli/sprint-state.js';
import { formatPostToolUseOutput } from '../../../src/core/index.js';
import type { HookInput } from '../../../src/core/index.js';

function makeInput(command: string, stdout: string): HookInput {
  return {
    session_id: 'test-session',
    cwd: '/tmp/test',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout },
  };
}

describe('prReviewGuard', () => {
  it('fires after successful gh pr create', async () => {
    const input = makeInput(
      'gh pr create --title "feat: test" --body "body"',
      'https://github.com/owner/repo/pull/42',
    );

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.suggestion).toBeUndefined();
    expect(result.context).toContain('pull/42');
    expect(result.context).toContain('slope pr review --pr=42');
    expect(result.context).toContain('slope pr status --pr=42');
  });

  it('formats as PostToolUse additionalContext instead of a block decision', async () => {
    const input = makeInput(
      'gh pr create --title "feat: test" --body "body"',
      'https://github.com/owner/repo/pull/42',
    );

    const result = await prReviewGuard(input, '/tmp/test');
    const output = formatPostToolUseOutput(result) as {
      decision?: string;
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };

    expect(output.decision).toBeUndefined();
    expect(output.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
    expect(output.hookSpecificOutput?.additionalContext).toContain('slope pr review --pr=42');
  });

  it('does not fire for non-PR commands', async () => {
    const input = makeInput('git push -u origin main', 'Everything up-to-date');

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.context).toBeUndefined();
  });

  it('does not fire when gh pr create fails (no PR URL)', async () => {
    const input = makeInput(
      'gh pr create --title "test" --body "body"',
      'Error: pull request create failed',
    );

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.context).toBeUndefined();
  });

  it('extracts PR URL from multiline output', async () => {
    const input = makeInput(
      'gh pr create --title "test" --body "body"',
      'Creating pull request...\nhttps://github.com/owner/repo/pull/99\n',
    );

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.context).toContain('pull/99');
  });

  it('handles response in result field', async () => {
    const input: HookInput = {
      session_id: 'test',
      cwd: '/tmp/test',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --title "t" --body "b"' },
      tool_response: { result: 'https://github.com/owner/repo/pull/7' },
    };

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.context).toContain('pull/7');
  });

  it('records a pending PR review when gh pr create succeeds in a sprint repo', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-pr-review-guard-'));
    try {
      execSync('git init -q', { cwd });
      execSync('git config user.email test@test', { cwd });
      execSync('git config user.name test', { cwd });
      saveSprintState(cwd, createSprintState(100, 'implementing'));

      const input = makeInput(
        'gh pr create --title "feat: test" --body "body"',
        'https://github.com/owner/repo/pull/42',
      );

      await prReviewGuard(input, cwd);

      const state = loadPrReviewState(cwd);
      expect(state.reviews).toHaveLength(1);
      expect(state.reviews[0]).toMatchObject({
        pr: 42,
        sprint: '100',
        status: 'pending',
        closeout_status: 'pending',
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('stacked PR base warning (GH #648)', () => {
  function input(base: string) {
    return {
      session_id: 'stack-test',
      cwd: process.cwd(),
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: `gh pr create --base ${base} --head feat/x` },
      tool_response: { stdout: 'https://github.com/srbryers/slope/pull/999' },
    } as unknown as HookInput;
  }

  it('warns when the base is another feature branch', async () => {
    const result = await prReviewGuard(input('feat/S246-session'), process.cwd());
    expect(result.context).toContain('stacked PR');
    expect(result.context).toContain('never squash');
    expect(result.context).toContain('--delete-branch');
  });

  it.each(['main', 'master'])('does not warn for the default branch %s', async base => {
    const result = await prReviewGuard(input(base), process.cwd());
    expect(result.context).not.toContain('stacked PR');
  });

  it('does not warn when no base is given', async () => {
    const bare = {
      session_id: 'stack-test',
      cwd: process.cwd(),
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --fill' },
      tool_response: { stdout: 'https://github.com/srbryers/slope/pull/999' },
    } as unknown as HookInput;
    const result = await prReviewGuard(bare, process.cwd());
    expect(result.context).not.toContain('stacked PR');
  });
});
