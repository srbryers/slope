import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { formatSprintLabel, nextCanonicalSprintId } from '../../core/index.js';

export function nextCommand(args: string[] = []): void {
  if (args.includes('--help') || args.includes('-h')) {
    printNextHelp();
    return;
  }

  const config = loadConfig();
  const cwd = process.cwd();
  const context = inferSprintContext(cwd, config);
  const since = formatLocalDate(daysAgo(1));

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
  console.log(`    slope auto-card --sprint=${context.sprint} --since="${since}"`);
  console.log('');
}

function printNextHelp(): void {
  console.log(`slope next [--help]

Show the next sprint SLOPE would start.

Selection order:
  1. Active sprint state
  2. .slope/config.json currentSprint
  3. Pending roadmap sprint
  4. Latest scorecard + 1

Output includes quick-start commands for briefing and auto-card.`);
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
