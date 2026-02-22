import { computeHandicapCard } from '@slope-dev/core';
import type { MissDirection } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { resolveMetaphor } from '../metaphor.js';

export function cardCommand(args: string[] = []): void {
  const config = loadConfig();
  const metaphor = resolveMetaphor(args, config.metaphor);
  const scorecards = loadScorecards(config);

  if (scorecards.length === 0) {
    console.log('\nNo scorecards found. Run `slope init` to create an example.\n');
    process.exit(0);
  }

  const card = computeHandicapCard(scorecards);

  const pad = (s: string | number, w: number) => String(s).padStart(w);
  const pct = (n: number) => n.toFixed(1) + '%';

  const minSprint = config.minSprint;
  const cardTitle = metaphor ? `SLOPE ${metaphor.vocabulary.handicapCard.charAt(0).toUpperCase() + metaphor.vocabulary.handicapCard.slice(1)}` : 'SLOPE Handicap Card';
  console.log(`\n${cardTitle} (${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'}, Sprint ${minSprint}+)`);
  console.log('\u2501'.repeat(47));
  console.log('');
  console.log(`${'Stat'.padEnd(20)}${'Last 5'.padStart(9)}${'Last 10'.padStart(10)}${'All-time'.padStart(10)}`);
  console.log('\u2500'.repeat(49));

  const rows: [string, (w: typeof card.last_5) => string][] = [
    ['Handicap', w => `+${w.handicap.toFixed(1)}`],
    ['Fairways', w => pct(w.fairway_pct)],
    ['GIR', w => pct(w.gir_pct)],
    ['Avg putts/hole', w => w.avg_putts.toFixed(1)],
    ['Penalties/round', w => w.penalties_per_round.toFixed(1)],
    ['Mulligans', w => String(w.mulligans)],
    ['Gimmes', w => String(w.gimmes)],
  ];

  for (const [label, fn] of rows) {
    console.log(`${label.padEnd(20)}${pad(fn(card.last_5), 9)}${pad(fn(card.last_10), 10)}${pad(fn(card.all_time), 10)}`);
  }

  // Miss pattern summary
  const allMiss = card.all_time.miss_pattern;
  const totalMisses = allMiss.long + allMiss.short + allMiss.left + allMiss.right;

  console.log('');
  if (totalMisses === 0) {
    console.log('Miss Pattern: No misses recorded.');
  } else {
    const dirs = (['long', 'short', 'left', 'right'] as MissDirection[])
      .filter(d => allMiss[d] > 0)
      .map(d => `${d}: ${allMiss[d]}`)
      .join(', ');
    console.log(`Miss Pattern: ${dirs} (${totalMisses} total)`);
  }

  if (scorecards.length < 5) {
    console.log(`\nNote: Only ${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'} \u2014 windows fill at Sprint ${minSprint + 5 - scorecards.length}.`);
  }

  console.log('');
}
