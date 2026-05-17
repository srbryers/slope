import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSprintLabel, parseRoadmap } from '../../core/index.js';
import type { RoadmapDefinition } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadSprintState } from '../sprint-state.js';
import { resolveStore } from '../store.js';

/**
 * `slope ticket done <key>` — mark a ticket complete (GH #316).
 *
 * Pairs with `slope sprint begin` (S88-3) to close the agent happy-path
 * loop. Verifies the ticket exists in the roadmap, finds the player's
 * active claim, attaches an optional commit SHA, and releases the claim.
 */
export async function ticketCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === '--help' || sub === '-h' || sub === undefined) {
    printHelp();
    return;
  }

  if (sub === 'done') {
    await doneSubcommand(args.slice(1));
    return;
  }

  console.error(`\nUnknown ticket subcommand: ${sub}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`
slope ticket — Per-ticket lifecycle commands

Usage:
  slope ticket done <key>                    Mark ticket complete; release claim
  slope ticket done <key> --commit=<sha>     Attach a specific commit SHA
  slope ticket done <key> --notes="..."      Attach completion notes
`);
}

interface DoneFlags {
  commit?: string;
  notes?: string;
}

function parseFlags(args: string[]): DoneFlags {
  const flags: DoneFlags = {};
  for (const a of args) {
    if (a.startsWith('--commit=')) flags.commit = a.slice('--commit='.length);
    else if (a.startsWith('--notes=')) flags.notes = a.slice('--notes='.length);
  }
  return flags;
}

async function doneSubcommand(args: string[]): Promise<void> {
  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    console.error('\nUsage: slope ticket done <key> [--commit=<sha>] [--notes="..."]\n');
    process.exit(1);
  }
  const flags = parseFlags(args);
  const cwd = process.cwd();

  const roadmap = loadRoadmap(cwd);

  // Resolve current sprint — sprint state wins; otherwise match the roadmap
  // ticket before falling back to the display label in S{N}-... keys.
  const state = loadSprintState(cwd);
  let sprintNumber: number | null = state?.sprint ?? null;
  if (sprintNumber == null && roadmap) {
    const roadmapSprint = roadmap.sprints.find(s => s.tickets.some(t => t.key === ticketKey));
    if (roadmapSprint) sprintNumber = roadmapSprint.id;
  }
  if (sprintNumber == null) {
    const m = ticketKey.match(/^S(\d+(?:\.\d+)?)-/i);
    if (m) sprintNumber = parseFloat(m[1]);
  }
  if (sprintNumber == null) {
    console.error(`Could not resolve sprint for ticket ${ticketKey}.`);
    console.error('Run `slope sprint start --number=N` or use a ticket key like S1-1.');
    process.exit(1);
  }

  // 1. Verify ticket exists in roadmap (best-effort — warn but don't block)
  if (roadmap) {
    const sprint = roadmap.sprints.find(s => s.id === sprintNumber);
    const ticketDefined = sprint?.tickets.some(t => t.key === ticketKey);
    if (!ticketDefined) {
      console.warn(`Warning: ticket ${ticketKey} not found in roadmap ${formatSprintLabel(sprintNumber)}. Continuing anyway.`);
    }
  }

  // 2. Find the player's active claim
  const player = process.env.USER || 'unknown';
  const store = await resolveStore(cwd);
  let releasedId: string | null = null;
  try {
    const existing = await store.list(sprintNumber);
    const ownClaim = existing.find(c => c.target === ticketKey && c.player === player);
    if (!ownClaim) {
      console.error(`No active claim for ${ticketKey} by ${player} on ${formatSprintLabel(sprintNumber)}.`);
      console.error('Run `slope claim --target=' + ticketKey + ' --sprint=' + sprintNumber + '` first.');
      process.exit(1);
    }

    // 3. Resolve commit SHA — explicit flag wins, fall back to HEAD
    const sha = resolveCommitSha(flags.commit, cwd);

    // 4. Record a 'decision' event for traceability (best-effort)
    try {
      await store.insertEvent({
        type: 'decision',
        sprint_number: sprintNumber,
        ticket_key: ticketKey,
        data: {
          kind: 'ticket_done',
          player,
          ...(sha ? { commit: sha } : {}),
          ...(flags.notes ? { notes: flags.notes } : {}),
        },
      });
    } catch {
      /* event recording is optional */
    }

    // 5. Release the claim
    const released = await store.release(ownClaim.id);
    if (released) {
      releasedId = ownClaim.id;
    }

    console.log(`\nTicket ${ticketKey}: done.`);
    console.log(`  Sprint:  ${formatSprintLabel(sprintNumber)}`);
    console.log(`  Player:  ${player}`);
    if (sha) console.log(`  Commit:  ${sha}`);
    if (flags.notes) console.log(`  Notes:   ${flags.notes}`);
    if (releasedId) console.log(`  Claim:   released (id ${releasedId.slice(0, 8)})`);
    else console.log(`  Claim:   could not release (id ${ownClaim.id.slice(0, 8)} — already gone?)`);
    console.log('');
  } finally {
    store.close();
  }

  // 6. Print recommended next via agent status
  const { collectAgentStatus } = await import('./agent.js');
  const status = await collectAgentStatus(cwd);
  if (status.nextTicket) {
    console.log(`Next ticket: ${status.nextTicket}`);
  }
  if (status.recommendedCommands.length > 0) {
    console.log('Recommended commands:');
    for (const c of status.recommendedCommands.slice(0, 3)) {
      console.log(`  $ ${c}`);
    }
  }
  console.log('');
}

function loadRoadmap(cwd: string): RoadmapDefinition | null {
  try {
    const config = loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return null;
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    return parseRoadmap(raw).roadmap;
  } catch {
    return null;
  }
}

function resolveCommitSha(explicit: string | undefined, cwd: string): string | null {
  if (explicit) return explicit;
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
