import { resolveStore } from '../store.js';
import { runPipeline } from '../../core/index.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function distillCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const auto = opts['auto'] === 'true' || args.includes('--auto');
  const dryRun = opts['dry-run'] === 'true' || args.includes('--dry-run');
  const threshold = opts['threshold'] ? parseInt(opts['threshold'], 10) : undefined;
  const sprintNumber = opts['sprint'] ? parseInt(opts['sprint'], 10) : undefined;

  const store = await resolveStore();

  try {
    // Load events
    let events: Awaited<ReturnType<typeof store.getEventsBySprint>>;
    if (sprintNumber) {
      events = await store.getEventsBySprint(sprintNumber);
    } else {
      events = await store.getAllEvents();
    }

    if (events.length === 0) {
      console.log('\n  No events found. Use `slope extract` to add events first.\n');
      return;
    }

    // Load existing common issues
    const existingIssues = await store.loadCommonIssues();

    // Run pipeline
    const result = runPipeline(events, existingIssues, { threshold });

    // Report
    console.log(`\n  Events analyzed: ${events.length}`);
    console.log(`  Clusters found: ${result.clusters.length}`);
    console.log(`  Promotion candidates: ${result.candidates.length}`);

    if (result.candidates.length > 0) {
      console.log('\n  Candidates:');
      for (const c of result.candidates) {
        console.log(`    - ${c.suggestedPattern.title}`);
        console.log(`      ${c.reason}`);
      }
    }

    if (dryRun) {
      console.log('\n  Dry run — no changes written.\n');
      return;
    }

    if (auto && result.promoted > 0) {
      await store.saveCommonIssues(existingIssues);
      console.log(`\n  Promoted: ${result.promoted} | Skipped: ${result.skipped}`);
      console.log('  Common issues updated.\n');
    } else if (!auto && result.candidates.length > 0) {
      console.log('\n  Use --auto to promote candidates to common issues.\n');
    } else {
      console.log('\n  No new patterns to promote.\n');
    }
  } finally {
    store.close();
  }
}

function printUsage(): void {
  console.log(`
slope distill — Analyze events and promote recurring patterns to common issues

Usage:
  slope distill [--auto] [--dry-run] [--sprint=<N>] [--threshold=<N>]

Options:
  --auto           Automatically promote candidates to common issues
  --dry-run        Show candidates without writing changes
  --sprint=<N>     Analyze events from a specific sprint only
  --threshold=<N>  Minimum sprint appearances to promote (default: 2)
`);
}
