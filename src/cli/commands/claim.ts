import { checkConflicts, sprintIdKey } from '../../core/index.js';
import { formatActorName, formatActorSource, formatConflictSummary, resolveActor } from '../actor.js';
import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { resolveStore } from '../store.js';
import type { ClaimScope, SprintClaim } from '../../core/index.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function printClaimHelp(): void {
  console.log(`slope claim --target=<target> [options]
slope claim list [--sprint=<number>] [--all]
slope claim release --target=<target> [--sprint=<number>] | --id=<claim-id>

Register a sprint claim for a ticket, file, or area, or inspect and release
existing claims.

Options:
  --target=<target>      Ticket, file path, or area to claim
  --scope=<scope>        Claim scope: ticket or area (default: ticket)
  --sprint=<number>      Sprint number (default: inferred from context)
  --actor=<name>         Actor override for audit trail identity
  --player=<name>        Legacy alias for --actor
  --notes=<text>         Optional claim notes
  --all                  With list: show claims from every sprint
  --force                Override overlap conflicts
  --help, -h             Show this help
`);
}

/**
 * Show claims so operators can see what is held before trying to release it.
 * Without this there was no way to inspect claim state at all — `slope now`
 * reported only a count, and stranded claims had to be read out of the SQLite
 * store by hand (GH #642).
 */
async function listClaims(flags: Record<string, string>, cwd: string, showAll: boolean): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    // Default to the current sprint, matching what `slope now` counts. --all
    // shows every claim ever recorded, which on a long-lived repo is hundreds.
    // Note: parseArgs only captures --key=value, so bare flags must be read
    // from argv directly (as --force already is).
    const sprint = showAll ? undefined : resolveSprint(flags, cwd);
    const claims = sprint != null ? await store.list(sprint) : await store.getActiveClaims();

    if (claims.length === 0) {
      console.log(sprint != null
        ? `\nNo claims for sprint ${sprint}. Use --all to list every sprint.\n`
        : '\nNo active claims.\n');
      return;
    }

    console.log(`\n${claims.length} claim(s)${sprint != null ? ` for sprint ${sprint}` : ''}:\n`);
    console.log('  Sprint  Scope   Player           Target');
    for (const claim of claims) {
      console.log(
        `  ${String(claim.sprint_number).padEnd(7)} ${claim.scope.padEnd(7)} ` +
        `${claim.player.slice(0, 16).padEnd(16)} ${claim.target}`,
      );
    }
    console.log('\nRelease one with: slope claim release --target=<target> [--sprint=<n>]\n');
  } finally {
    store.close();
  }
}

function resolveSprint(flags: Record<string, string>, cwd: string): string {
  if (flags.sprint) {
    const sprint = sprintIdKey(flags.sprint);
    if (!sprint) {
      console.error('Error: --sprint must be a positive sprint id, e.g. 114 or 114.5');
      process.exit(1);
    }
    return sprint;
  }
  const config = loadConfig(cwd);
  return inferSprintContext(cwd, config).sprint;
}

/** Subcommands `slope claim` accepts. Anything else is a typo, not a claim. */
const CLAIM_SUBCOMMANDS = new Set(['list', 'release']);

export async function claimCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    printClaimHelp();
    return;
  }

  // Unknown positionals used to be discarded, so `slope claim release --target=X`
  // registered a claim instead of releasing one — a guessable command silently
  // doing the opposite of what was asked, with no way to list or undo it
  // (GH #642). Route known subcommands; reject the rest.
  const subcommand = args.find(arg => !arg.startsWith('-'));
  if (subcommand) {
    if (subcommand === 'list') return listClaims(parseArgs(args), process.cwd(), args.includes('--all'));
    if (subcommand === 'release') {
      const { releaseCommand } = await import('./release.js');
      return releaseCommand(args.filter(arg => arg !== 'release'));
    }
    console.error(`Error: unknown subcommand "${subcommand}".`);
    console.error(`Valid subcommands: ${[...CLAIM_SUBCOMMANDS].join(', ')}.`);
    console.error('To register a claim, pass no subcommand: slope claim --target=<target>');
    process.exit(1);
  }

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
  const actor = resolveActor(cwd, { explicitActor: flags.actor || flags.player });
  const player = actor.name;
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
      console.error(`  [!!] ${formatConflictSummary(c)}`);
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
      console.log(`    [!!] ${formatConflictSummary(c)}`);
    }
  } else {
    console.log(`\nClaim registered:`);
  }

  console.log(`  ID:     ${claim.id}`);
  console.log(`  Sprint: ${claim.sprint_number}`);
  console.log(`  Player: ${formatActorName(actor)}`);
  console.log(`  Actor source: ${formatActorSource(actor)}`);
  console.log(`  Target: ${claim.target} (${claim.scope})`);
  if (claim.notes) console.log(`  Notes:  ${claim.notes}`);

  // Flip session mode to sprint — enables sprint-workflow guards
  const sessionId = process.env.CLAUDE_SESSION_ID || '';
  if (sessionId) {
    const { setSessionMode } = await import('../session-state.js');
    setSessionMode(cwd, sessionId, 'sprint');
  }

  // Adjacent conflicts are informational only
  if (adjacents.length > 0) {
    console.log(`\n  Note: ${adjacents.length} adjacent conflict(s):`);
    for (const c of adjacents) {
      console.log(`    [~] ${formatConflictSummary(c)}`);
    }
  }

  if (overlaps.length === 0 && adjacents.length === 0) {
    console.log(`\n  No conflicts detected.`);
  }
  console.log('');
}
