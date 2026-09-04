import {
  findRoadmapSprint,
  formatRoadmapSprintLabel,
  isRoadmapSprintPending,
  loadScorecards,
  roadmapSprintKey,
  roadmapSprintKeyFromId,
  sprintIdKey,
  sprintIdsEqual,
} from '../../core/index.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket, SprintClaim, SprintId } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { inferSprintContext, loadRoadmapForInference } from '../sprint-inference.js';
import { isRequiredReviewGate, isReviewGateSatisfied, loadSprintState, pendingGates, waivedReviewGateNames, type ReviewGateName } from '../sprint-state.js';
import { resolveStore } from '../store.js';
import { resolveActor } from '../actor.js';
import {
  readCompletedTicketKeysOrEmpty,
  selectNextTicket,
  type NextTicketReason,
} from '../../core/index.js';

interface NowSnapshot {
  sprint: SprintId;
  sprintLabel: string;
  source: string;
  roadmap?: {
    name: string;
    theme?: string;
    phase?: string;
    phaseProgress?: string;
    status: string;
  };
  sprintState?: {
    phase: string;
    pendingGates: string[];
    requiredReviewsPending: ReviewGateName[];
    reviewWaivers: ReviewGateName[];
  };
  claims: {
    total: number;
    ticketClaims: number;
  };
  /** Recorded completions for the current sprint's tickets (#697). */
  tickets?: {
    total: number;
    completed: number;
    status: NextTicketReason;
  };
  /** Set when the completion ledger could not be read, so the counts above
   *  are "unknown" rather than "none". */
  ledgerError?: string;
  nextAction: string;
  /** Null, never absent, when there is nothing to start. */
  nextTicket: RoadmapTicket | null;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

function sprintStatus(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint | undefined,
  completed: Set<string>,
  currentSprint: SprintId,
): string {
  if (!sprint) return 'not in roadmap';
  const explicit = (sprint as RoadmapSprint & { status?: string }).status;
  if (explicit === 'superseded') return 'superseded';
  if (explicit === 'complete' || completed.has(roadmapSprintKey(roadmap, sprint))) return 'complete';
  if (roadmapSprintKey(roadmap, sprint) === roadmapSprintKeyFromId(roadmap, currentSprint)) return 'active';
  if (isRoadmapSprintPending(sprint)) return 'pending';
  return explicit ?? 'unknown';
}

function isTerminal(roadmap: RoadmapDefinition, sprint: RoadmapSprint, completed: Set<string>): boolean {
  const explicit = (sprint as RoadmapSprint & { status?: string }).status;
  return explicit === 'complete'
    || explicit === 'superseded'
    || completed.has(roadmapSprintKey(roadmap, sprint));
}

function formatPhaseProgress(roadmap: RoadmapDefinition, sprint: SprintId, completed: Set<string>): { name: string; progress: string } | undefined {
  const sprintKey = roadmapSprintKeyFromId(roadmap, sprint);
  const phase = roadmap.phases.find(p =>
    (p.sprint_keys ?? p.sprints.map(String))
      .some(id => roadmapSprintKeyFromId(roadmap, id) === sprintKey));
  if (!phase) return undefined;
  const phaseKeys = new Set((phase.sprint_keys ?? phase.sprints.map(String))
    .map(id => roadmapSprintKeyFromId(roadmap, id)));
  const phaseSprints = roadmap.sprints.filter(s => phaseKeys.has(roadmapSprintKey(roadmap, s)));
  const completedCount = phaseSprints.filter(s => isTerminal(roadmap, s, completed)).length;
  return {
    name: phase.name,
    progress: `${completedCount}/${phaseSprints.length}`,
  };
}

function findNextTicket(
  sprint: RoadmapSprint | undefined,
  claims: SprintClaim[],
  completed: ReadonlySet<string>,
  self: string,
): { ticket: RoadmapTicket | null; reason: NextTicketReason } {
  if (!sprint) return { ticket: null, reason: 'no_tickets' };
  // One shared rule across `now`, `agent status` and roadmap status, so a live
  // claim stops producing two different answers (#697).
  const result = selectNextTicket({
    tickets: sprint.tickets.map(t => t.key),
    completed,
    claimedBySelf: new Set(claims.filter(c => c.player === self).map(c => c.target)),
    claimedByOthers: new Set(claims.filter(c => c.player !== self).map(c => c.target)),
  });
  const ticket = result.ticketKey
    ? sprint.tickets.find(t => t.key === result.ticketKey) ?? null
    : null;
  return { ticket, reason: result.reason };
}

function buildNextAction(snapshot: Omit<NowSnapshot, 'nextAction'>): string {
  if (!snapshot.roadmap) {
    return 'Run slope init or slope roadmap status to establish project direction.';
  }
  if (snapshot.sprintState?.reviewWaivers.length) {
    return `Review waiver recorded for ${snapshot.sprintState.reviewWaivers.join(', ')}: attach independent/PR evidence to replace it, or proceed with the explicit downgrade.`;
  }
  if (snapshot.sprintState?.requiredReviewsPending.length) {
    return `Review decision for ${snapshot.sprintState.requiredReviewsPending.join(', ')}: attach independent/PR evidence, or explicitly waive with --waive-independent-review.`;
  }
  if (snapshot.nextTicket) {
    const verb = snapshot.tickets?.status === 'in_flight' ? 'Continue' : 'Start';
    return `${verb} ${snapshot.nextTicket.key}: ${snapshot.nextTicket.title}`;
  }
  if (snapshot.tickets?.status === 'all_claimed') {
    // Not the same as done. Recommending closeout here would call a sprint
    // finished while someone else is still mid-ticket.
    return 'Every unfinished ticket is claimed by someone else. Wait, or take one over with slope claim --force.';
  }
  if (snapshot.sprintState && snapshot.sprintState.pendingGates.length > 0) {
    return `Clear pending gates: ${snapshot.sprintState.pendingGates.join(', ')}`;
  }
  return `Review ${snapshot.sprintLabel} and prepare closeout.`;
}

async function buildNowSnapshot(cwd: string, flags: Record<string, string>): Promise<NowSnapshot> {
  const config = loadConfig(cwd);
  const inferred = inferSprintContext(cwd, config);
  const parsedSprint = flags.sprint ? sprintIdKey(flags.sprint) : inferred.sprint;
  if (parsedSprint == null) {
    throw new Error(`Invalid sprint number: ${flags.sprint}`);
  }
  const sprint = parsedSprint;
  const roadmap = loadRoadmapForInference(cwd, config) ?? undefined;
  const current = roadmap ? findRoadmapSprint(roadmap, sprint) : undefined;
  // Without roadmap evidence, an integer like 245 is ambiguous: it could be a
  // real S245 or the legacy encoding of S24.5. Prefer roadmap-aware labelling so
  // this repo's own S245 stops rendering as "S24.5" (GH #635).
  const sprintLabel = roadmap
    ? formatRoadmapSprintLabel(roadmap, current ? roadmapSprintKey(roadmap, current) : sprint)
    : `S${sprintIdKey(sprint) ?? sprint}`;
  const scorecards = loadScorecards(config, cwd);
  const completed = new Set(scorecards.map(card => card.sprint_number));
  const phase = roadmap ? formatPhaseProgress(roadmap, sprint, completed) : undefined;
  const state = loadSprintState(cwd);

  const store = await resolveStore(cwd);
  let claims: SprintClaim[];
  let completedTickets: Set<string>;
  let ledgerError: string | undefined;
  try {
    claims = await store.list(sprint);
    const read = await readCompletedTicketKeysOrEmpty(store, sprint);
    completedTickets = read.keys;
    // Say so rather than rendering "nothing recorded" as fact. A silently
    // empty ledger is what made every surface recommend finished work.
    ledgerError = read.error?.message;
  } finally {
    store.close();
  }
  const self = resolveActor(cwd).name;
  const next = findNextTicket(current, claims, completedTickets, self);

  const partial: Omit<NowSnapshot, 'nextAction'> = {
    sprint,
    sprintLabel,
    source: flags.sprint ? 'flag' : inferred.source,
    roadmap: roadmap ? {
      name: roadmap.name,
      theme: current?.theme,
      phase: phase?.name,
      phaseProgress: phase?.progress,
      status: sprintStatus(roadmap, current, completed, sprint),
    } : undefined,
    sprintState: state && sprintIdsEqual(state.sprint, sprint) ? {
      phase: state.phase,
      pendingGates: pendingGates(state),
      requiredReviewsPending: (['code_review', 'architect_review'] as ReviewGateName[])
        .filter(gate => isRequiredReviewGate(state, gate) && !isReviewGateSatisfied(state, gate)),
      reviewWaivers: waivedReviewGateNames(state),
    } : undefined,
    claims: {
      total: claims.length,
      ticketClaims: claims.filter(c => c.scope === 'ticket').length,
    },
    tickets: current ? {
      total: current.tickets.length,
      completed: current.tickets.filter(t => completedTickets.has(t.key)).length,
      status: next.reason,
    } : undefined,
    ledgerError,
    // Always present, and null rather than absent when there is nothing to
    // start, so a consumer reading `nextTicket.key` fails the same way on both
    // surfaces instead of only on this one.
    nextTicket: next.ticket,
  };

  return {
    ...partial,
    nextAction: buildNextAction(partial),
  };
}

function printNowSnapshot(snapshot: NowSnapshot): void {
  console.log('\nSLOPE Now');
  console.log('='.repeat(32));
  const theme = snapshot.roadmap?.theme ? ` - ${snapshot.roadmap.theme}` : '';
  console.log(`Current: ${snapshot.sprintLabel}${theme}`);
  if (snapshot.roadmap?.phase) {
    const progress = snapshot.roadmap.phaseProgress ? ` (${snapshot.roadmap.phaseProgress})` : '';
    console.log(`Phase: ${snapshot.roadmap.phase}${progress}`);
  }
  console.log(`Roadmap: ${snapshot.roadmap?.status ?? 'not found'} (${snapshot.source})`);
  console.log(`Sprint state: ${snapshot.sprintState?.phase ?? 'not started'}`);
  if (snapshot.sprintState?.reviewWaivers.length) {
    console.log(`Review downgrade: ${snapshot.sprintState.reviewWaivers.join(', ')} independently required but explicitly waived`);
  }
  console.log(`Claims: ${snapshot.claims.total} active, ${snapshot.claims.ticketClaims} ticket`);
  if (snapshot.ledgerError) {
    console.log(`Tickets: unknown — ${snapshot.ledgerError}`);
  } else if (snapshot.tickets) {
    console.log(`Tickets: ${snapshot.tickets.completed}/${snapshot.tickets.total} recorded done`);
  }
  console.log(`Next: ${snapshot.nextAction}`);
  if (snapshot.nextTicket && snapshot.nextAction.startsWith('Start ')) {
    console.log(`Start: slope start --ticket=${snapshot.nextTicket.key}`);
  }
  console.log(`More: slope roadmap status --sprint=${snapshot.sprint}\n`);
}

function printUsage(): void {
  console.log(`
slope now - Compact current-state cockpit

Usage:
  slope now [--sprint=N] [--json]

Shows the current sprint, phase, sprint state, claim count, and next human action.
`);
}

export async function nowCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseArgs(args);
  const snapshot = await buildNowSnapshot(process.cwd(), flags);
  if (flags.json === 'true') {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  printNowSnapshot(snapshot);
}

export const testInternals = {
  buildNowSnapshot,
};
