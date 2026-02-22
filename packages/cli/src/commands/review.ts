import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatSprintReview } from '@slope-dev/core';
import type { GolfScorecard, ProjectStats } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { resolveMetaphor } from '../metaphor.js';

export function reviewCommand(path?: string, mode?: string, metaphorFlag?: string): void {
  const config = loadConfig();
  const cwd = process.cwd();
  const metaphor = resolveMetaphor(metaphorFlag ? [`--metaphor=${metaphorFlag}`] : [], config.metaphor);

  if (!path) {
    // Default to latest scorecard
    const dir = join(cwd, config.scorecardDir);
    const patternParts = config.scorecardPattern.split('*');
    const prefix = patternParts[0] ?? '';
    const suffix = patternParts[1] ?? '';
    const regex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

    try {
      const files = readdirSync(dir)
        .filter((f: string) => {
          const m = f.match(regex);
          return m && parseInt(m[1], 10) >= config.minSprint;
        })
        .sort((a, b) => {
          const na = parseInt(a.match(regex)?.[1] ?? '0', 10);
          const nb = parseInt(b.match(regex)?.[1] ?? '0', 10);
          return na - nb;
        });
      if (files.length === 0) {
        console.log('\nNo scorecards found.\n');
        process.exit(1);
      }
      path = join(dir, files[files.length - 1]);
    } catch {
      console.log('\nScorecard directory not found.\n');
      process.exit(1);
    }
  }

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error(`\nFailed to parse ${path}\n`);
    process.exit(1);
  }

  const card: GolfScorecard = { ...raw, sprint_number: raw.sprint_number ?? raw.sprint };

  const reviewMode = mode === 'plain' ? 'plain' : 'technical';
  const review = formatSprintReview(card, undefined, undefined, reviewMode, metaphor);
  console.log('');
  console.log(review);
}
