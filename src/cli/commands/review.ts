import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { formatSprintReview, compareSprintIds, normalizeScorecard, parseSprintNumber } from '../../core/index.js';
import type { GolfScorecard } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { resolveMetaphor } from '../metaphor.js';
import { loadSprintState, updateGate } from '../sprint-state.js';

function discoverScorecardPaths(cwd: string, config: ReturnType<typeof loadConfig>): string[] {
  const dir = join(cwd, config.scorecardDir);
  if (!existsSync(dir)) return [];
  const patternParts = config.scorecardPattern.split('*');
  const prefix = patternParts[0] ?? '';
  const suffix = patternParts[1] ?? '';
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escapeRegex(prefix)}(\\d+(?:\\.\\d+)?)${escapeRegex(suffix)}$`);

  return readdirSync(dir)
    .map(file => ({ file, sprint: parseSprintNumber(file.match(regex)?.[1] ?? '') }))
    .filter((entry): entry is { file: string; sprint: number } =>
      entry.sprint != null && entry.sprint >= config.minSprint,
    )
    .sort((a, b) => compareSprintIds(a.sprint, b.sprint))
    .map(entry => join(dir, entry.file));
}

function resolveScorecardPath(
  path: string | undefined,
  sprintSelector: string | undefined,
  cwd: string,
  config: ReturnType<typeof loadConfig>,
): string {
  if (path && sprintSelector) {
    console.error('\nUse either an explicit scorecard path or --sprint, not both.\n');
    process.exit(1);
  }
  if (path) return isAbsolute(path) ? path : resolve(cwd, path);

  if (sprintSelector) {
    const sprint = parseSprintNumber(sprintSelector);
    if (sprint == null) {
      console.error(`\nInvalid sprint selector: ${sprintSelector}\n`);
      process.exit(1);
    }
    const selected = join(cwd, config.scorecardDir, config.scorecardPattern.replace('*', String(sprint)));
    if (!existsSync(selected)) {
      console.error(`\nScorecard not found for Sprint ${sprint}: ${relative(cwd, selected)}\n`);
      process.exit(1);
    }
    return selected;
  }

  const scorecards = discoverScorecardPaths(cwd, config);
  if (scorecards.length === 0) {
    console.error('\nNo scorecards found. Pass an explicit scorecard path.\n');
    process.exit(1);
  }
  if (scorecards.length > 1) {
    console.error('\nMultiple scorecards found; refusing to guess which sprint to review.');
    console.error('Pass an explicit path, for example:');
    console.error(`  slope review ${relative(cwd, scorecards[scorecards.length - 1])}`);
    console.error('');
    process.exit(1);
  }
  return scorecards[0];
}

export function reviewCommand(
  path?: string,
  mode?: string,
  metaphorFlag?: string,
  outputPath?: string | null,
  sprintSelector?: string,
): void {
  const config = loadConfig();
  const cwd = process.cwd();
  const metaphor = resolveMetaphor(metaphorFlag ? [`--metaphor=${metaphorFlag}`] : [], config.metaphor);
  const scorecardPath = resolveScorecardPath(path, sprintSelector, cwd, config);

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(scorecardPath, 'utf8'));
  } catch {
    console.error(`\nFailed to parse ${scorecardPath}\n`);
    process.exit(1);
  }

  const card: GolfScorecard = normalizeScorecard(raw);

  const reviewMode = mode === 'plain' ? 'plain' : 'technical';
  const review = formatSprintReview(card, undefined, undefined, reviewMode, metaphor);
  console.log('');
  console.log(review);

  if (outputPath !== null) {
    const reviewPath = outputPath
      ? isAbsolute(outputPath) ? outputPath : join(cwd, outputPath)
      : join(dirname(scorecardPath), `sprint-${card.sprint_number}-review.md`);
    mkdirSync(dirname(reviewPath), { recursive: true });
    writeFileSync(reviewPath, review + '\n');
    console.error(`\nReview written: ${relative(cwd, reviewPath)}`);
  }

  // Generating a historical sprint's review must not complete a different
  // active sprint's gate.
  const sprintState = loadSprintState(cwd);
  if (sprintState?.sprint === card.sprint_number) {
    updateGate(cwd, 'review_md', true);
  }
}

export const reviewCommandInternals = {
  discoverScorecardPaths,
  resolveScorecardPath,
};
