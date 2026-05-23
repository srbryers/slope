import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { formatSprintLabel, nextCanonicalSprintId } from '../../core/index.js';

export function nextCommand(): void {
  const config = loadConfig();
  const cwd = process.cwd();
  const context = inferSprintContext(cwd, config);

  console.log('');
  if (context.latestScorecard === 0) {
    console.log(`  No scorecards found. Next sprint: ${context.label}`);
  } else {
    console.log(`  Latest scorecard: S${context.latestScorecard}`);
    console.log(`  Next sprint: ${context.label}`);
  }

  if (context.source === 'config') {
    console.log(`  (set explicitly in .slope/config.json)`);
  } else if (context.source === 'roadmap') {
    console.log(`  (selected from pending roadmap sprint${context.roadmapSprint?.theme ? `: ${context.roadmapSprint.theme}` : ''})`);
    if (context.latestScorecard > 0 && context.sprint !== nextCanonicalSprintId(context.latestScorecard)) {
      console.log(`  (roadmap state overrides scorecard fallback to ${formatSprintLabel(nextCanonicalSprintId(context.latestScorecard))})`);
    }
  } else {
    console.log(`  (auto-detected from scorecards)`);
  }

  console.log('');
  console.log('  Quick start:');
  console.log(`    slope briefing --sprint=${context.sprint}`);
  console.log(`    slope auto-card --sprint=${context.sprint} --since="$(date -d yesterday +%Y-%m-%d)"`);
  console.log('');
}
