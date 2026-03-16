import { describe, it, expect } from 'vitest';
import { prReviewGuard } from '../../../src/cli/guards/pr-review.js';
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
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion!.id).toBe('pr-review');
    expect(result.suggestion!.context).toContain('pull/42');
    expect(result.suggestion!.options.map(o => o.label)).toContain('Code Review');
    expect(result.suggestion!.options.map(o => o.label)).toContain('Architect Review');
    expect(result.suggestion!.options.map(o => o.label)).toContain('Both');
    expect(result.suggestion!.options.map(o => o.label)).toContain('Manual Review');
    expect(result.suggestion!.options.map(o => o.label)).toContain('Skip / Merge Now');
  });

  it('does not fire for non-PR commands', async () => {
    const input = makeInput('git push -u origin main', 'Everything up-to-date');

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.suggestion).toBeUndefined();
  });

  it('does not fire when gh pr create fails (no PR URL)', async () => {
    const input = makeInput(
      'gh pr create --title "test" --body "body"',
      'Error: pull request create failed',
    );

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.suggestion).toBeUndefined();
  });

  it('extracts PR URL from multiline output', async () => {
    const input = makeInput(
      'gh pr create --title "test" --body "body"',
      'Creating pull request...\nhttps://github.com/owner/repo/pull/99\n',
    );

    const result = await prReviewGuard(input, '/tmp/test');
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion!.context).toContain('pull/99');
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
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion!.context).toContain('pull/7');
  });
});
