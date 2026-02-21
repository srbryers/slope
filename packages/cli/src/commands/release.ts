import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { resolveStore } from '../store.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function resolveSprintRange(flags: Record<string, string>, cwd: string): number[] {
  const config = loadConfig(cwd);
  if (flags.sprint) return [parseInt(flags.sprint, 10)];
  if (config.currentSprint) return [config.currentSprint];
  const scorecards = loadScorecards(config, cwd);
  if (scorecards.length === 0) return [1];
  const maxSprint = Math.max(...scorecards.map(s => s.sprint_number));
  // Check the current and next sprint (most likely locations)
  return Array.from({ length: maxSprint + 1 }, (_, i) => i + 1);
}

export async function releaseCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();
  const store = await resolveStore(cwd);

  // Release by ID
  if (flags.id) {
    const released = await store.release(flags.id);
    if (released) {
      console.log(`\nClaim ${flags.id} released.\n`);
    } else {
      console.error(`\nClaim ${flags.id} not found.\n`);
      process.exit(1);
    }
    return;
  }

  // Release by target + player lookup
  if (flags.target) {
    const player = flags.player || process.env.USER || 'unknown';
    const sprints = resolveSprintRange(flags, cwd);

    for (const sprint of sprints) {
      const claims = await store.list(sprint);
      const match = claims.find(c => c.target === flags.target && c.player === player);
      if (match) {
        const released = await store.release(match.id);
        if (released) {
          console.log(`\nClaim ${match.id} (${match.target} by ${match.player}, sprint ${match.sprint_number}) released.\n`);
          return;
        }
      }
    }

    console.error(`\nNo claim found for target "${flags.target}" by player "${player}".\n`);
    process.exit(1);
    return;
  }

  console.error('Error: --id or --target is required');
  process.exit(1);
}
