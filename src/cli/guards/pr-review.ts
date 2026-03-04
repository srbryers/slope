import type { HookInput, GuardResult } from '../../core/index.js';

/**
 * PR review guard: fires PostToolUse on Bash.
 * Detects `gh pr create` output and prompts for review workflow choice.
 */
export async function prReviewGuard(input: HookInput, _cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';
  const response = (input.tool_response?.stdout as string) ?? (input.tool_response?.result as string) ?? '';

  // Only fire after gh pr create commands
  if (!command.includes('gh pr create')) return {};

  // Verify a PR URL was returned (successful creation)
  if (!response.includes('github.com/') || !response.includes('/pull/')) return {};

  // Extract PR URL from response
  const urlMatch = response.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/);
  const prUrl = urlMatch ? urlMatch[1] : 'the PR';

  return {
    context: [
      `SLOPE pr-review: A pull request was just created (${prUrl}).`,
      '',
      'IMPORTANT: You MUST now ask the user how they want to handle the PR review using AskUserQuestion.',
      'Present these options:',
      '',
      '1. Code Review — Detailed line-by-line code review of the diff',
      '2. Architect Review — High-level architecture and design review',
      '3. Both — Run code review followed by architect review',
      '4. Manual Review — User will review manually, no automated review',
      '5. Skip / Merge Now — No review needed, proceed to merge',
      '',
      'Wait for the user\'s choice before taking any further action.',
      '',
      'After the review is complete, capture findings:',
      '1. For each issue found: `slope review findings add --type=<type> --ticket=<key> --severity=<sev> --description="..."`',
      '2. After all findings recorded: `slope review amend` to apply to scorecard',
      '3. Run `slope distill --auto` to promote recurring patterns',
      '',
      'Review type to finding type mapping: architect→architect, code→code',
    ].join('\n'),
  };
}
