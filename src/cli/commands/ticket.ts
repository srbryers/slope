import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findRoadmapSprint,
  formatSprintLabel,
  parseRoadmap,
  roadmapSprintKey,
  sprintIdKey,
} from '../../core/index.js';
import type { RoadmapDefinition } from '../../core/index.js';
import { formatActorName, formatActorSource, resolveActor } from '../actor.js';
import { loadConfig } from '../config.js';
import { isInsideGitWorkTree } from '../git-preflight.js';
import { TICKET_DONE_KIND, readTicketCompletion } from '../../core/index.js';
import type { TicketCompletion } from '../../core/index.js';
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

  if (sub === 'repair') {
    await repairSubcommand(args.slice(1));
    return;
  }

  if (sub === 'show') {
    await showSubcommand(args.slice(1));
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
  slope ticket done <key> --actor=<name>     Override actor identity for claim lookup

  slope ticket repair <key> --commit=<sha>   Correct evidence on an already-completed
                                             ticket; needs no claim
  slope ticket repair <key> --notes="..."    Replace the recorded notes

  slope ticket show <key> [--json]           Show the recorded completion evidence
`);
}

interface DoneFlags {
  commit?: string;
  notes?: string;
  actor?: string;
}

interface CommitResolution {
  sha: string | null;
  missingGitWorkTree: boolean;
  /** Set when an explicit --commit value named something git could not
   *  resolve to a commit. Refused rather than recorded (#698). */
  unresolvedRef?: string;
}

function parseFlags(args: string[]): DoneFlags {
  const flags: DoneFlags = {};
  for (const a of args) {
    if (a.startsWith('--commit=')) flags.commit = a.slice('--commit='.length);
    else if (a.startsWith('--notes=')) flags.notes = a.slice('--notes='.length);
    else if (a.startsWith('--actor=')) flags.actor = a.slice('--actor='.length);
    else if (a.startsWith('--player=')) flags.actor = a.slice('--player='.length);
  }
  return flags;
}

/**
 * Sprint for a ticket — sprint state wins; otherwise match the roadmap ticket
 * before falling back to the display label in S{N}-... keys. Shared so
 * `repair` lands its correction on the same sprint `done` recorded (#698).
 */
function resolveSprintForTicket(
  cwd: string,
  ticketKey: string,
  roadmap: RoadmapDefinition | null,
): string {
  const state = loadSprintState(cwd);
  let sprintNumber: string | null = state?.sprint ?? null;
  if (sprintNumber == null && roadmap) {
    const roadmapSprint = roadmap.sprints.find(s => s.tickets.some(t => t.key === ticketKey));
    if (roadmapSprint) sprintNumber = roadmapSprintKey(roadmap, roadmapSprint);
  }
  if (sprintNumber == null) {
    const m = ticketKey.match(/^S(\d+(?:\.\d+)?)-/i);
    if (m) sprintNumber = sprintIdKey(m[1]);
  }
  if (sprintNumber == null) {
    console.error(`Could not resolve sprint for ticket ${ticketKey}.`);
    console.error('Run `slope sprint start --number=N` or use a ticket key like S1-1.');
    process.exit(1);
  }
  return sprintNumber as string;
}

async function doneSubcommand(args: string[]): Promise<void> {
  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    console.error('\nUsage: slope ticket done <key> [--commit=<sha>] [--notes="..."] [--actor=<name>]\n');
    process.exit(1);
  }
  const flags = parseFlags(args);
  const cwd = process.cwd();

  const roadmap = loadRoadmap(cwd);
  const sprintNumber = resolveSprintForTicket(cwd, ticketKey, roadmap);

  // 1. Verify ticket exists in roadmap (best-effort — warn but don't block)
  if (roadmap) {
    const sprint = findRoadmapSprint(roadmap, sprintNumber);
    const ticketDefined = sprint?.tickets.some(t => t.key === ticketKey);
    if (!ticketDefined) {
      console.warn(`Warning: ticket ${ticketKey} not found in roadmap ${formatSprintLabel(sprintNumber)}. Continuing anyway.`);
    }
  }

  // 2. Find the player's active claim
  const actor = resolveActor(cwd, { explicitActor: flags.actor });
  const player = actor.name;
  const playerDisplay = formatActorName(actor);
  const store = await resolveStore(cwd);
  let releasedId: string | null = null;
  try {
    const existing = await store.list(sprintNumber);
    const ownClaim = existing.find(c => c.target === ticketKey && c.player === player);
    if (!ownClaim) {
      console.error(`No active claim for ${ticketKey} by ${playerDisplay} on ${formatSprintLabel(sprintNumber)}.`);
      console.error('Run `slope claim --target=' + ticketKey + ' --sprint=' + sprintNumber + '` first.');
      process.exit(1);
    }

    // 3. Resolve commit SHA — explicit flag wins, fall back to HEAD
    const commit = resolveCommitSha(flags.commit, cwd);
    // Refuse before the claim is released. The reporter's complaint was that
    // `--commit=HEAD` succeeded, released the claim, and left no supported way
    // to correct the evidence afterwards (#698).
    if (commit.unresolvedRef) {
      console.error(`\n${ticketKey}: could not resolve --commit=${commit.unresolvedRef} to a commit.`);
      console.error(commit.missingGitWorkTree
        ? 'No git repository was detected here, so the value cannot be verified. Run `git init -b main`, or omit --commit to record the completion without one.'
        : 'Pass a commit-ish git can resolve, or omit --commit to use HEAD.');
      console.error('Nothing was recorded and the claim is still yours.\n');
      store.close();
      process.exit(1);
      return;
    }
    const sha = commit.sha;

    // 4. Record the completion. This is the ledger `slope now`, `agent` and
    // roadmap status read to know the ticket is finished, so a failure here
    // has to surface: a swallowed write left the command reporting success
    // while nothing durable said the ticket was done, and the next-action
    // commands went on recommending it (#697).
    try {
      await store.insertEvent({
        type: 'decision',
        sprint_number: sprintNumber,
        ticket_key: ticketKey,
        data: {
          kind: TICKET_DONE_KIND,
          player,
          ...(sha ? { commit: sha } : {}),
          ...(flags.notes ? { notes: flags.notes } : {}),
        },
      });
    } catch (error) {
      console.error(`\nCould not record completion for ${ticketKey}: ${(error as Error).message}`);
      console.error('The claim was NOT released, so the ticket is still yours. Retry once the store is reachable.\n');
      store.close();
      process.exit(1);
      return;
    }

    // 5. Release the claim
    const released = await store.release(ownClaim.id);
    if (released) {
      releasedId = ownClaim.id;
    }

    console.log(`\nTicket ${ticketKey}: done.`);
    console.log(`  Sprint:  ${formatSprintLabel(sprintNumber)}`);
    console.log(`  Player:  ${playerDisplay}`);
    console.log(`  Actor source: ${formatActorSource(actor)}`);
    if (sha) console.log(`  Commit:  ${sha}`);
    if (commit.missingGitWorkTree) {
      console.warn('Warning: no git repository detected; commit SHA was not attached. Run `git init -b main` before future completions or pass `--commit=<sha>` explicitly.');
    }
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

/**
 * `slope ticket repair <key> --commit=<sha>` — correct the evidence on an
 * already-completed ticket (#698).
 *
 * The reporter's complaint was that a bad `--commit` value became permanent:
 * `ticket done` releases the claim, and every other path into the ledger
 * requires one. Repair deliberately does not need a claim, and records a fresh
 * completion rather than editing the old event, so the ledger stays an
 * append-only history of what was believed when.
 */
async function repairSubcommand(args: string[]): Promise<void> {
  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    console.error('\nUsage: slope ticket repair <key> --commit=<sha> [--notes="..."] [--actor=<name>]\n');
    process.exit(1);
    return;
  }
  const flags = parseFlags(args);
  // Presence, not truthiness: `--notes=` is a request to clear the notes,
  // which the truthy check refused as "nothing to repair".
  if (flags.commit === undefined && flags.notes === undefined) {
    console.error(`\nNothing to repair for ${ticketKey}: pass --commit=<sha> and/or --notes="..." (--notes= clears them).\n`);
    process.exit(1);
    return;
  }
  const cwd = process.cwd();

  // Only resolve when a commit was actually named. `done` falls back to HEAD
  // when the flag is absent; repairing notes must not quietly retarget the
  // commit at whatever HEAD happens to be now.
  const commit: CommitResolution = flags.commit
    ? resolveCommitSha(flags.commit, cwd)
    : { sha: null, missingGitWorkTree: false };
  if (commit.unresolvedRef) {
    console.error(`\n${ticketKey}: could not resolve --commit=${commit.unresolvedRef} to a commit.`);
    console.error(commit.missingGitWorkTree
      ? 'No git repository was detected here, so the value cannot be verified. Run `git init -b main` first.'
      : 'Pass a commit-ish git can resolve.');
    console.error('Nothing was recorded.\n');
    process.exit(1);
    return;
  }

  const actor = resolveActor(cwd, { explicitActor: flags.actor });
  const store = await resolveStore(cwd);
  let prior: TicketCompletion | undefined;
  try {
    // By ticket key, not by current sprint. Resolving through sprint state
    // made repair refuse a real completion the moment state advanced, which
    // is precisely when bad evidence gets noticed (#698).
    prior = await readTicketCompletion(store, ticketKey);
  } catch (error) {
    store.close();
    console.error(`\nCould not read the completion ledger: ${(error as Error).message}`);
    console.error('Nothing was recorded.\n');
    process.exit(1);
    return;
  }
  if (!prior) {
    store.close();
    console.error(`\nNo recorded completion for ${ticketKey}.`);
    console.error(`Repair corrects existing evidence. Run \`slope ticket done ${ticketKey}\` to record the completion first.\n`);
    process.exit(1);
    return;
  }
  // The correction lands on the sprint the completion was recorded against,
  // never on whatever sprint happens to be current.
  const sprintNumber = prior.sprint ?? resolveSprintForTicket(cwd, ticketKey, loadRoadmap(cwd));

  try {
    // Carry forward whatever this repair does not replace, so correcting the
    // commit does not silently discard notes recorded with the original.
    // `--notes=` with an empty value clears them; only an absent flag keeps.
    const notes = flags.notes !== undefined ? flags.notes : prior.notes;
    const sha = commit.sha ?? prior.commit;
    await store.insertEvent({
      type: 'decision',
      sprint_number: sprintNumber,
      ticket_key: ticketKey,
      data: {
        kind: TICKET_DONE_KIND,
        // The original player, not the repairer. A correction to the evidence
        // is not a change of who did the work.
        player: prior.player ?? actor.name,
        repaired: true,
        repaired_by: actor.name,
        ...(sha ? { commit: sha } : {}),
        ...(notes ? { notes } : {}),
      },
    });

    console.log(`\nTicket ${ticketKey}: evidence repaired.`);
    console.log(`  Sprint:  ${formatSprintLabel(sprintNumber)}`);
    if (prior.player) console.log(`  Player:  ${prior.player}`);
    console.log(`  Repaired by: ${formatActorName(actor)}`);
    if (prior.commit) console.log(`  Was:     ${prior.commit}`);
    if (sha) console.log(`  Commit:  ${sha}`);
    if (notes) console.log(`  Notes:   ${notes}`);
    else if (prior.notes) console.log('  Notes:   (cleared)');
    console.log('');
  } finally {
    store.close();
  }
}

/**
 * `slope ticket show <key>` — what the ledger currently records for a ticket.
 *
 * Repair needs a before picture: nothing else surfaced the recorded commit, so
 * bad evidence was invisible until something downstream failed on it (#698).
 */
async function showSubcommand(args: string[]): Promise<void> {
  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    console.error('\nUsage: slope ticket show <key> [--json]\n');
    process.exit(1);
    return;
  }
  const json = args.includes('--json');
  const cwd = process.cwd();

  const store = await resolveStore(cwd);
  let completion: TicketCompletion | undefined;
  try {
    // By ticket key. Reading through the current sprint reported a real
    // completion as absent once sprint state moved on (#698).
    completion = await readTicketCompletion(store, ticketKey);
  } catch (error) {
    store.close();
    console.error(`\nCould not read the completion ledger: ${(error as Error).message}\n`);
    process.exit(1);
    return;
  } finally {
    store.close();
  }

  if (json) {
    // `completed` is always present. Emitting it only in the negative case
    // meant a consumer reading it got `undefined` for a finished ticket and
    // `false` for an unfinished one, so both read as not done.
    console.log(JSON.stringify({ ticketKey, completed: !!completion, ...completion }, null, 2));
    return;
  }
  if (!completion) {
    console.log(`\n${ticketKey}: no recorded completion.\n`);
    return;
  }
  console.log(`\nTicket ${ticketKey}`);
  if (completion.sprint) console.log(`  Sprint:  ${formatSprintLabel(completion.sprint)}`);
  if (completion.player) console.log(`  Player:  ${completion.player}`);
  if (completion.commit) console.log(`  Commit:  ${completion.commit}`);
  if (completion.notes) console.log(`  Notes:   ${completion.notes}`);
  if (completion.at) console.log(`  Done at: ${completion.at}`);
  if (completion.repaired) console.log('  Evidence was repaired after the original completion.');
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

function resolveCommitSha(explicit: string | undefined, cwd: string): CommitResolution {
  // An explicit value gets the same resolution the fallback already did.
  // Storing it verbatim recorded `HEAD` as permanent completion evidence,
  // which is not immutable and breaks shipped-commit checks that read it
  // later (#698). The asymmetry was the whole bug.
  if (explicit) {
    // Refuse rather than store the value unverified. Returning it verbatim
    // here left the original #698 defect fully reproducible outside a work
    // tree: `--commit=HEAD` was recorded permanently, under a warning saying
    // no SHA had been attached. `isInsideGitWorkTree` is also false when git
    // is missing from PATH, which widens the reach.
    if (!isInsideGitWorkTree(cwd)) {
      return { sha: null, missingGitWorkTree: true, unresolvedRef: explicit };
    }
    try {
      const sha = execFileSync('git', ['rev-parse', '--verify', `${explicit}^{commit}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { sha, missingGitWorkTree: false };
    } catch {
      return { sha: null, missingGitWorkTree: false, unresolvedRef: explicit };
    }
  }
  if (!isInsideGitWorkTree(cwd)) {
    return { sha: null, missingGitWorkTree: true };
  }
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { sha, missingGitWorkTree: false };
  } catch {
    return { sha: null, missingGitWorkTree: false };
  }
}
