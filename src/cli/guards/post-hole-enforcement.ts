import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { findShippedSprintsOnMain } from '../../core/index.js';
import { loadConfig } from '../config.js';

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

  const statusById = new Map<number, string | null>();
  for (const s of sprints) {
    const id = (s as { id?: unknown })?.id;
    const status = (s as { status?: unknown })?.status;
    if (typeof id === 'number') {
      statusById.set(id, typeof status === 'string' ? status : null);
    }
  }

  const shipped = findShippedSprintsOnMain(cwd);
  if (shipped.size === 0) return {};

  type Drift = { sprint: number; issues: string[] };
  const drifts: Drift[] = [];
  for (const id of [...shipped].sort((a, b) => b - a)) {
    const status = statusById.get(id);
    const scorecardFile = join(scorecardDirAbs, scorecardPattern.replace('*', String(id)));
    const hasScorecard = existsSync(scorecardFile);

    const issues: string[] = [];
    if (status !== 'complete') issues.push(`status="${status ?? 'unset'}"`);
    if (!hasScorecard) issues.push('no scorecard');

    if (issues.length > 0) drifts.push({ sprint: id, issues });
  }

  if (drifts.length === 0) return {};

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

  const message = lines.join('\n');

  if (process.env.SLOPE_POST_HOLE_BLOCK === '1') {
    return { decision: 'deny', blockReason: message };
  }
  return { context: message };
}
