import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTournamentReview, compareSprintIdKeys, formatTournamentReview, sprintIdKey } from '../../core/index.js';
import type { GolfScorecard } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';

function parseArgs(args: string[]): {
  id?: string;
  name?: string;
  sprints?: string;
  output?: string;
} {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

export function tournamentCommand(args: string[]): void {
  const opts = parseArgs(args);
  const config = loadConfig();
  const allCards = loadScorecards(config);

  if (!opts.id) {
    console.error('\nUsage: slope tournament --id=<id> [--name=<name>] [--sprints=N-M] [--output=path]\n');
    console.error('  --id       Tournament identifier (e.g. M-09)');
    console.error('  --name     Human-readable name (defaults to id)');
    console.error('  --sprints  Sprint range, e.g. 197-202 (defaults to all)');
    console.error('  --output   Write JSON+MD to this directory (defaults to scorecardDir)\n');
    process.exit(1);
  }

  let filtered: GolfScorecard[] = allCards;

  if (opts.sprints) {
    const rangeMatch = opts.sprints.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      const start = sprintIdKey(rangeMatch[1])!;
      const end = sprintIdKey(rangeMatch[2])!;
      filtered = allCards.filter((c) =>
        compareSprintIdKeys(c.sprint_number, start) >= 0
        && compareSprintIdKeys(c.sprint_number, end) <= 0);
    } else {
      const nums = new Set(opts.sprints.split(',').map(sprint => sprintIdKey(sprint) ?? sprint.trim()));
      filtered = allCards.filter((c) => nums.has(c.sprint_number));
    }
  }

  if (filtered.length === 0) {
    console.error('\nNo scorecards found for the specified range.\n');
    process.exit(1);
  }

  const name = opts.name ?? opts.id;
  const review = buildTournamentReview(opts.id, name, filtered);
  const md = formatTournamentReview(review);
  const outputDir = join(process.cwd(), opts.output ?? config.scorecardDir);

  const jsonPath = join(outputDir, `tournament-${opts.id}.json`);
  const mdPath = join(outputDir, `tournament-${opts.id}.md`);

  writeFileSync(jsonPath, JSON.stringify(review, null, 2) + '\n');
  writeFileSync(mdPath, md + '\n');

  console.log('');
  console.log(md);
  console.log('');
  console.log(`Written to:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
}
