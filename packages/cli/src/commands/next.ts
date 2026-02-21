import { loadConfig } from '../config.js';
import { resolveCurrentSprint, detectLatestSprint } from '../loader.js';

export function nextCommand(): void {
  const config = loadConfig();
  const cwd = process.cwd();
  const latest = detectLatestSprint(config, cwd);
  const next = resolveCurrentSprint(config, cwd);

  console.log('');
  if (latest === 0) {
    console.log('  No scorecards found. Next sprint: S1');
  } else {
    console.log(`  Latest scorecard: S${latest}`);
    console.log(`  Next sprint: S${next}`);
  }

  if (config.currentSprint) {
    console.log(`  (set explicitly in .slope/config.json)`);
  } else {
    console.log(`  (auto-detected from scorecards)`);
  }

  console.log('');
  console.log('  Quick start:');
  console.log(`    slope briefing --sprint=${next}`);
  console.log(`    slope auto-card --sprint=${next} --since="$(date -d yesterday +%Y-%m-%d)"`);
  console.log('');
}
