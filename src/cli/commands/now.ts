import { formatSprintLabel, formatRoadmapSprintLabel, formatSprintNumber, isRoadmapSprintPending, loadScorecards, parseSprintNumber } from '../../core/index.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket, SprintClaim } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { inferSprintContext, loadRoadmapForInference } from '../sprint-inference.js';
import { isRequiredReviewGate, isReviewGateSatisfied, loadSprintState, pendingGates, waivedReviewGateNames, type ReviewGateName } from '../sprint-state.js';
import { resolveStore } from '../store.js';

interface NowSnapshot {
  sprint: number;
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
  nextAction: string;
  nextTicket?: RoadmapTicket;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

function sprintStatus(sprint: RoadmapSprint | undefined, completed: Set<number>, currentSprint: number): string {
  if (!sprint) return 'not in roadmap';
  const explicit = (sprint as RoadmapSprint & { status?: string }).status;
  if (explicit === 'superseded') return 'superseded';
  if (explicit === 'complete' || completed.has(sprint.id)) return 'complete';
  if (sprint.id === currentSprint) return 'active';
  if (isRoadmapSprintPending(sprint)) return 'pending';
  return explicit ?? 'unknown';
}

function isTerminal(sprint: RoadmapSprint, completed: Set<number>): boolean {
  const explicit = (sprint as RoadmapSprint & { status?: string }).status;
  return explicit === 'complete' || explicit === 'superseded' || completed.has(sprint.id);
}

function formatPhaseProgress(roadmap: RoadmapDefinition, sprint: number, completed: Set<number>): { name: string; progress: string } | undefined {
  const phase = roadmap.phases.find(p => p.sprints.includes(sprint));
  if (!phase) return undefined;
  const phaseSprints = roadmap.sprints.filter(s => phase.sprints.includes(s.id));
  const completedCount = phaseSprints.filter(s => isTerminal(s, completed)).length;
  return {
    name: phase.name,
    progress: `${completedCount}/${phaseSprints.length}`,
  };
}

function findNextTicket(sprint: RoadmapSprint | undefined, claims: SprintClaim[]): RoadmapTicket | undefined {
  if (!sprint) return undefined;
  const claimedTargets = new Set(claims.map(c => c.target));
  return sprint.tickets.find(ticket => !claimedTargets.has(ticket.key)) ?? sprint.tickets[0];
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
    return `Start ${snapshot.nextTicket.key}: ${snapshot.nextTicket.title}`;
  }
  if (snapshot.sprintState && snapshot.sprintState.pendingGates.length > 0) {
    return `Clear pending gates: ${snapshot.sprintState.pendingGates.join(', ')}`;
  }
  return `Review ${snapshot.sprintLabel} and prepare closeout.`;
}

async function buildNowSnapshot(cwd: string, flags: Record<string, string>): Promise<NowSnapshot> {
  const config = loadConfig(cwd);
  const inferred = inferSprintContext(cwd, config);
  const parsedSprint = flags.sprint ? parseSprintNumber(flags.sprint) : inferred.sprint;
  if (parsedSprint == null) {
    throw new Error(`Invalid sprint number: ${flags.sprint}`);
  }
  const sprint = parsedSprint;
  const roadmap = loadRoadmapForInference(cwd, config) ?? undefined;
  // Without roadmap evidence, an integer like 245 is ambiguous: it could be a
  // real S245 or the legacy encoding of S24.5. Prefer roadmap-aware labelling so
  // this repo's own S245 stops rendering as "S24.5" (GH #635).
  const sprintLabel = roadmap ? formatRoadmapSprintLabel(roadmap, sprint) : formatSprintLabel(sprint);
  const scorecards = loadScorecards(config, cwd);
  const completed = new Set(scorecards.map(card => card.sprint_number));
  const current = roadmap?.sprints.find(s => s.id === sprint);
  const phase = roadmap ? formatPhaseProgress(roadmap, sprint, completed) : undefined;
  const state = loadSprintState(cwd);

  const store = await resolveStore(cwd);
  let claims: SprintClaim[];
  try {
    claims = await store.list(sprint);
  } finally {
    store.close();
  }

  const partial: Omit<NowSnapshot, 'nextAction'> = {
    sprint,
    sprintLabel,
    source: flags.sprint ? 'flag' : inferred.source,
    roadmap: roadmap ? {
      name: roadmap.name,
      theme: current?.theme,
      phase: phase?.name,
      phaseProgress: phase?.progress,
      status: sprintStatus(current, completed, sprint),
    } : undefined,
    sprintState: state?.sprint === sprint ? {
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
    nextTicket: findNextTicket(current, claims),
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
  console.log(`Next: ${snapshot.nextAction}`);
  if (snapshot.nextTicket && snapshot.nextAction.startsWith('Start ')) {
    console.log(`Start: slope start --ticket=${snapshot.nextTicket.key}`);
  }
  console.log(`More: slope roadmap status --sprint=${formatSprintNumber(snapshot.sprint)}\n`);
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
