import { describe, it, expect } from 'vitest';
import '../../../src/core/adapters/claude-code.js';
import { prReviewGuard } from '../../../src/cli/guards/pr-review.js';
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
});
