import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { loadConfig } from '../../core/index.js';

/**
 * Review-stale guard: fires on Stop.
 * Warns if any scored sprints lack review markdown files.
 * Non-blocking suggestion — next-action handles the hard block.
 */
export async function reviewStaleGuard(_input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig(cwd);
  const retrosDir = join(cwd, config.scorecardDir);

  if (!existsSync(retrosDir)) return {};

  // Find scorecard files and check for matching reviews
  const missingReviews: number[] = [];
  try {
    const files = readdirSync(retrosDir);
    const scorecardPattern = /^sprint-(\d+)\.json$/;

    for (const file of files) {
      const match = file.match(scorecardPattern);
      if (!match) continue;

      const sprintNum = parseInt(match[1], 10);
      const reviewPath = join(retrosDir, `sprint-${sprintNum}-review.md`);
      if (!existsSync(reviewPath)) {
        missingReviews.push(sprintNum);
      }
    }
  } catch {
    return {}; // Can't read retros dir — skip
  }

  if (missingReviews.length === 0) return {};

  // Sort for consistent output
  missingReviews.sort((a, b) => a - b);

  const suggestion: Suggestion = {
    id: 'review-stale',
    title: 'Missing Reviews',
    context: `${missingReviews.length} sprint(s) have scorecards but no review: ${missingReviews.map(n => `S${n}`).join(', ')}`,
    options: missingReviews.map(n => ({
      id: `review-${n}`,
      label: `Generate S${n} review`,
      command: `slope review docs/retros/sprint-${n}.json`,
    })),
    requiresDecision: false,
    priority: 'normal',
  };

  return { suggestion };
}
