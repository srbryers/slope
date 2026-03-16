import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';

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

  const suggestion: Suggestion = {
    id: 'pr-review',
    title: 'PR Review',
    context: `A pull request was just created (${prUrl}). After the review, capture findings with \`slope review findings add\`, then \`slope review amend\` to apply to scorecard.`,
    options: [
      { id: 'code', label: 'Code Review', description: 'Detailed line-by-line code review of the diff' },
      { id: 'architect', label: 'Architect Review', description: 'High-level architecture and design review' },
      { id: 'both', label: 'Both', description: 'Run code review followed by architect review' },
      { id: 'manual', label: 'Manual Review', description: 'User will review manually, no automated review' },
      { id: 'skip', label: 'Skip / Merge Now', description: 'No review needed, proceed to merge' },
    ],
    requiresDecision: true,
    priority: 'high',
  };

  return { suggestion };
}
