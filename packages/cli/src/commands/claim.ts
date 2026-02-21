import { checkConflicts } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { resolveStore } from '../store.js';
import type { ClaimScope, SprintClaim } from '@slope-dev/core';

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

export async function claimCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const force = args.includes('--force');
  const cwd = process.cwd();
  const store = await resolveStore(cwd);

  const target = flags.target;
  if (!target) {
    console.error('Error: --target is required');
    process.exit(1);
  }

  const scope: ClaimScope = (flags.scope as ClaimScope) || 'ticket';
  const player = flags.player || process.env.USER || 'unknown';
  const sprintNumber = resolveSprint(flags, cwd);

  // Preflight conflict check: build a temporary claim and test against existing claims
  const existingClaims = await store.list(sprintNumber);
  const tempClaim: SprintClaim = {
    id: '__pending__',
    sprint_number: sprintNumber,
    player,
    target,
    scope,
    claimed_at: new Date().toISOString(),
    ...(flags.notes ? { notes: flags.notes } : {}),
  };

  const conflicts = checkConflicts([...existingClaims, tempClaim]);
  const overlaps = conflicts.filter(c => c.severity === 'overlap');
  const adjacents = conflicts.filter(c => c.severity === 'adjacent');

  // Block on overlaps unless --force
  if (overlaps.length > 0 && !force) {
    console.error(`\nClaim blocked — overlap conflict(s) detected:`);
    for (const c of overlaps) {
      console.error(`  [!!] ${c.reason}`);
    }
    console.error(`\nUse --force to override.`);
    process.exit(1);
  }

  // Register the claim
  const claim = await store.claim({
    sprint_number: sprintNumber,
    player,
    target,
    scope,
    ...(flags.notes ? { notes: flags.notes } : {}),
  });

  // Forced overlap warning
  if (overlaps.length > 0 && force) {
    console.log(`\nClaim registered (forced override):`);
    console.log(`  Warning: ${overlaps.length} overlap conflict(s) overridden:`);
    for (const c of overlaps) {
      console.log(`    [!!] ${c.reason}`);
    }
  } else {
    console.log(`\nClaim registered:`);
  }

  console.log(`  ID:     ${claim.id}`);
  console.log(`  Sprint: ${claim.sprint_number}`);
  console.log(`  Player: ${claim.player}`);
  console.log(`  Target: ${claim.target} (${claim.scope})`);
  if (claim.notes) console.log(`  Notes:  ${claim.notes}`);

  // Adjacent conflicts are informational only
  if (adjacents.length > 0) {
    console.log(`\n  Note: ${adjacents.length} adjacent conflict(s):`);
    for (const c of adjacents) {
      console.log(`    [~] ${c.reason}`);
    }
  }

  if (overlaps.length === 0 && adjacents.length === 0) {
    console.log(`\n  No conflicts detected.`);
  }
  console.log('');
}
