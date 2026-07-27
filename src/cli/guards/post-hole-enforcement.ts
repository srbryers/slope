import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import {
  compareSprintIdKeys,
  findShippedSprintsOnMain,
  parseRoadmap,
  roadmapSprintKey,
  sprintIdKey,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { pendingPrCloseouts, pendingPrReviews } from '../pr-review-state.js';
import type { PrReviewRecord } from '../pr-review-state.js';

/**
 * Post-hole enforcement guard: fires on Stop.
 *
 * Detects "silent roadmap drift" — sprints with shipped commits on main
 * that haven't been properly closed out per the post-hole routine. A
 * sprint is considered drifting if either:
 *   • roadmap.json status is not "complete", OR
 *   • no scorecard exists at docs/retros/sprint-N.json
 *
 * Advisory by default — surfaces the drift list with fix commands. Set
 * SLOPE_POST_HOLE_BLOCK=1 to upgrade to a mechanical block on session end.
 *
 * Tied to GH #291. Builds on the validator drift detector from S86-1
 * (findShippedSprintsOnMain in src/core/analyzers/git.ts).
 */
export async function postHoleEnforcementGuard(_input: HookInput, cwd: string): Promise<GuardResult> {
  let roadmapAbs: string;
  let scorecardDirAbs: string;
  let scorecardPattern: string;

  try {
    const config = loadConfig(cwd);
    roadmapAbs = join(cwd, config.roadmapPath);
    scorecardDirAbs = join(cwd, config.scorecardDir);
    scorecardPattern = config.scorecardPattern;
  } catch {
    return {};
  }

  // Pattern must contain a '*' wildcard so each sprint's scorecard resolves
  // to a unique filename. Misconfigured patterns (e.g. 'sprint.json') would
  // collide every sprint to the same path, making this check meaningless.
  if (!scorecardPattern.includes('*')) {
    return {
      context: `SLOPE post-hole enforcement: scorecardPattern "${scorecardPattern}" has no '*' wildcard — drift detection skipped. Update .slope/config.json to e.g. "sprint-*.json".`,
    };
  }

  if (!existsSync(roadmapAbs)) return {};

  // Loose JSON parse — only need .sprints[]; phases and other fields are
  // out of scope for this guard.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(roadmapAbs, 'utf8'));
  } catch {
    return {};
  }
  const sprints = (parsed as { sprints?: unknown[] })?.sprints;
  if (!Array.isArray(sprints)) return {};

  const roadmap = parseRoadmap(parsed).roadmap;
  const statusById = new Map<string, string | null>();
  for (const sprint of roadmap?.sprints ?? []) {
    statusById.set(
      roadmapSprintKey(roadmap!, sprint),
      typeof sprint.status === 'string' ? sprint.status : null,
    );
  }

  type Drift = { sprint: string; issues: string[] };
  const shipped = findShippedSprintsOnMain(cwd);
  const drifts: Drift[] = [];
  if (shipped.size > 0) {
    const shippedKeys = [...shipped]
      .map(sprintIdKey)
      .filter((id): id is string => id !== null)
      .sort((a, b) => compareSprintIdKeys(b, a));
    for (const id of shippedKeys) {
      const status = statusById.get(id);
      // Replace EVERY '*' so patterns with multiple wildcards are sanitized
      // (CodeQL js/incomplete-sanitization): single .replace() leaves later
      // occurrences as literal '*' which won't match real filenames.
      const scorecardFile = join(scorecardDirAbs, scorecardPattern.replaceAll('*', String(id)));
      const hasScorecard = existsSync(scorecardFile);

      const issues: string[] = [];
      if (status !== 'complete') issues.push(`status="${status ?? 'unset'}"`);
      if (!hasScorecard) issues.push('no scorecard');

      if (issues.length > 0) drifts.push({ sprint: id, issues });
    }
  }

  const prReviewGaps = pendingPrReviews(cwd);
  const prCloseoutGaps = pendingPrCloseouts(cwd);
  if (drifts.length === 0 && prReviewGaps.length === 0 && prCloseoutGaps.length === 0) return {};

  const sections: string[] = [];
  if (drifts.length > 0) sections.push(formatCloseoutDriftMessage(drifts));
  if (prReviewGaps.length > 0) sections.push(formatPendingPrReviewMessage(prReviewGaps));
  if (prCloseoutGaps.length > 0) sections.push(formatPendingPrCloseoutMessage(prCloseoutGaps));

  const message = sections.join('\n\n');

  if (process.env.SLOPE_POST_HOLE_BLOCK === '1') {
    return { decision: 'deny', blockReason: message };
  }
  return { context: message };
}

function formatCloseoutDriftMessage(drifts: Array<{ sprint: string; issues: string[] }>): string {
  const shown = drifts.slice(0, 5);
  const remainder = drifts.length - shown.length;
  const lines = [
    `SLOPE post-hole enforcement: ${drifts.length} shipped sprint${drifts.length === 1 ? '' : 's'} with incomplete close-out:`,
    '',
    ...shown.map(d => `  • S${d.sprint}: ${d.issues.join(', ')}`),
  ];
  if (remainder > 0) lines.push(`  …and ${remainder} more`);
  lines.push(
    '',
    'Per the post-hole routine, each shipped sprint needs:',
    '  • status:complete in roadmap.json',
    '  • scorecard at docs/retros/sprint-N.json',
    '',
    'Fix commands:',
    '  - Build scorecard: slope auto-card --sprint=<N>',
    '  - Validate scorecard: slope validate',
    '  - Roadmap status: edit docs/backlog/roadmap.json (or slope sprint complete)',
  );
  return lines.join('\n');
}

function formatPendingPrReviewMessage(records: PrReviewRecord[]): string {
  const shown = records.slice(0, 5);
  const remainder = records.length - shown.length;
  const lines = [
    `SLOPE PR review enforcement: ${records.length} created PR${records.length === 1 ? '' : 's'} missing a \`slope pr review\` record:`,
    '',
    ...shown.map(record => {
      const sprintArg = record.sprint ? ` --sprint=${record.sprint}` : '';
      const sprintLabel = record.sprint ? ` (S${record.sprint})` : '';
      return `  • PR #${record.pr}${sprintLabel}: slope pr review --pr=${record.pr}${sprintArg}`;
    }),
  ];
  if (remainder > 0) lines.push(`  …and ${remainder} more`);
  lines.push(
    '',
    'Run the review command before presenting the PR as ready to merge.',
  );
  return lines.join('\n');
}

function formatPendingPrCloseoutMessage(records: PrReviewRecord[]): string {
  const shown = records.slice(0, 5);
  const remainder = records.length - shown.length;
  const lines = [
    `SLOPE PR closeout enforcement: ${records.length} reviewed PR${records.length === 1 ? '' : 's'} still need review/check settlement:`,
    '',
    ...shown.map(record => {
      const sprintArg = record.sprint ? ` --sprint=${record.sprint}` : '';
      const sprintLabel = record.sprint ? ` (S${record.sprint})` : '';
      return `  • PR #${record.pr}${sprintLabel}: slope pr status --pr=${record.pr}${sprintArg}`;
    }),
  ];
  if (remainder > 0) lines.push(`  …and ${remainder} more`);
  lines.push(
    '',
    'Wait for GitHub checks and review threads to settle, address actionable feedback, then rerun the status command before presenting the PR as ready to merge.',
  );
  return lines.join('\n');
}
