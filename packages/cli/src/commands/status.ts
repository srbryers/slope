import { checkConflicts } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { createRegistry } from '../registries/index.js';
import type { SprintClaim } from '@slope-dev/core';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function resolveSprint(flags: Record<string, string>, cwd: string): number {
  if (flags.sprint) return parseInt(flags.sprint, 10);
  const config = loadConfig(cwd);
  if (config.currentSprint) return config.currentSprint;
  const scorecards = loadScorecards(config, cwd);
  if (scorecards.length === 0) return 1;
  const maxSprint = Math.max(...scorecards.map(s => s.sprint_number));
  return maxSprint + 1;
}

export async function statusCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const registry = createRegistry(config, cwd);
  const sprintNumber = resolveSprint(flags, cwd);

  const claims = await registry.list(sprintNumber);

  console.log(`\nSprint ${sprintNumber} — Course Status`);
  console.log('═'.repeat(40));

  if (claims.length === 0) {
    console.log('\n  No claims registered.\n');
    return;
  }

  // Group by player
  const byPlayer = new Map<string, SprintClaim[]>();
  for (const claim of claims) {
    const list = byPlayer.get(claim.player) || [];
    list.push(claim);
    byPlayer.set(claim.player, list);
  }

  for (const [player, playerClaims] of byPlayer) {
    console.log(`\n  ${player}:`);
    for (const c of playerClaims) {
      const scopeTag = c.scope === 'area' ? '[area]' : '[ticket]';
      const notes = c.notes ? ` — ${c.notes}` : '';
      console.log(`    ${scopeTag} ${c.target}${notes}  (${c.id})`);
    }
  }

  // Check conflicts
  const conflicts = checkConflicts(claims);
  if (conflicts.length > 0) {
    console.log(`\n  Conflicts (${conflicts.length}):`);
    for (const c of conflicts) {
      const icon = c.severity === 'overlap' ? '!!' : '~';
      console.log(`    [${icon}] ${c.reason} (${c.severity})`);
    }
  }

  console.log('');
}
