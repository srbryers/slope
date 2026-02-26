// SLOPE — slope vision: display project vision document
import { loadVision } from '../../core/vision.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function visionCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
slope vision — Display project vision document

Usage:
  slope vision          Show current vision
  slope vision --json   Output as JSON
`);
    return;
  }

  const vision = loadVision();

  if (!vision) {
    console.log('No vision set. Run `slope init --interactive` to create one.');
    return;
  }

  if (flags.json === 'true') {
    console.log(JSON.stringify(vision, null, 2));
    return;
  }

  console.log(`\nProject Vision\n`);
  console.log(`  Purpose:      ${vision.purpose}`);
  if (vision.audience) console.log(`  Audience:     ${vision.audience}`);
  if (vision.priorities.length > 0) {
    console.log(`  Priorities:`);
    for (const p of vision.priorities) {
      console.log(`    - ${p}`);
    }
  }
  if (vision.techDirection) console.log(`  Tech:         ${vision.techDirection}`);
  if (vision.nonGoals && vision.nonGoals.length > 0) {
    console.log(`  Non-goals:`);
    for (const ng of vision.nonGoals) {
      console.log(`    - ${ng}`);
    }
  }
  console.log(`  Updated:      ${vision.updatedAt}\n`);
}
