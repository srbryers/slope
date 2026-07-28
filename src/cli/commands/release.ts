import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { formatActorName, formatActorSource, resolveActor } from '../actor.js';
import { resolveStore } from '../store.js';
import { sprintIdKey, type SprintId } from '../../core/index.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function resolveSprintRange(flags: Record<string, string>, cwd: string): SprintId[] | null {
  const config = loadConfig(cwd);
  if (flags.sprint) {
    const sprint = sprintIdKey(flags.sprint);
    return sprint ? [sprint] : [];
  }
  if (config.currentSprint) return [config.currentSprint];
  return null;
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
    const actor = resolveActor(cwd, { explicitActor: flags.actor || flags.player });
    const player = actor.name;
    const playerDisplay = formatActorName(actor);
    const sprints = resolveSprintRange(flags, cwd);
    const allClaims = sprints === null ? await store.getActiveClaims() : null;

    for (const sprint of sprints ?? [null]) {
      const claims = sprint === null ? allClaims ?? [] : await store.list(sprint);
      const match = claims.find(c => c.target === flags.target && c.player === player);
      if (match) {
        const released = await store.release(match.id);
        if (released) {
          console.log(`\nClaim ${match.id} (${match.target} by ${playerDisplay}, sprint ${match.sprint_number}) released.\n`);
          console.log(`Actor source: ${formatActorSource(actor)}\n`);
          return;
        }
      }
    }

    console.error(`\nNo claim found for target "${flags.target}" by player "${playerDisplay}".\n`);
    process.exit(1);
    return;
  }

  console.error('Error: --id or --target is required');
  process.exit(1);
}
