import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createSprintState, loadSprintState, mutateSprintState, saveSprintState, type SprintPhase } from './sprint-state.js';
import {
  castRoadmapStructure,
  formatSprintLabel,
  formatSprintNumber,
  loadScorecards,
  loadWorkflow,
  parseRoadmap,
  parseSprintNumber,
  type RoadmapSprint,
  type WorkflowDefinition,
  type WorkflowExecution,
} from '../core/index.js';
import type { SlopeStore } from '../core/store.js';

const DEFAULT_STALE_WORKFLOW_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StaleWorkflowExecution {
  exec: WorkflowExecution;
  reason: string;
}

export interface WorkflowResyncResult {
  paused: StaleWorkflowExecution[];
  fastForwarded: Array<{ exec: WorkflowExecution; phase: string; step: string; reason: string }>;
}

export interface SprintStateRebindResult {
  sprint: number;
  previousSprint?: number;
  rebound: boolean;
  reason?: string;
}

export function inferSprintFromBranch(cwd: string): number | null {
  const branch = currentBranch(cwd);
  if (!branch) return null;
  const match = branch.match(/(?:^|[-/])s(?:print-?)?(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return parseSprintNumber(match[1]) ?? null;
}

export function currentBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function sprintNumberFromId(sprintId: string | undefined): number | null {
  if (!sprintId) return null;
  const normalized = sprintId.replace(/^S/i, '');
  return parseSprintNumber(normalized) ?? null;
}

export function sprintNumberForExecution(exec: Pick<WorkflowExecution, 'sprint_id' | 'variables'>): number | null {
  for (const candidate of sprintIdCandidates(exec)) {
    const sprint = sprintNumberFromId(candidate);
    if (sprint !== null) return sprint;
  }
  return null;
}

export function sprintLabelForExecution(exec: Pick<WorkflowExecution, 'id' | 'sprint_id' | 'variables'>): string {
  const sprint = sprintNumberForExecution(exec);
  return sprint === null ? (exec.sprint_id ?? exec.id) : formatSprintLabel(sprint);
}

function sprintIdCandidates(exec: Pick<WorkflowExecution, 'sprint_id' | 'variables'>): string[] {
  const candidates = [
    exec.sprint_id,
    exec.variables?.sprint_id,
    exec.variables?.sprint,
    exec.variables?.sprintId,
  ];
  return candidates.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function scorecardExistsForSprint(cwd: string, sprint: number): boolean {
  const config = loadConfig(cwd);
  const pattern = config.scorecardPattern.replaceAll('*', formatSprintNumber(sprint));
  return existsSync(join(cwd, config.scorecardDir, pattern));
}

export function completedRoadmapSprintIds(cwd: string, config = loadConfig(cwd)): Set<number> {
  if (!config.roadmapPath) return new Set();
  const roadmapPath = join(cwd, config.roadmapPath);
  if (!existsSync(roadmapPath)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const parsed = parseRoadmap(raw);
    const roadmap = parsed.roadmap ?? castRoadmapStructure(raw);
    if (!roadmap) return new Set();
    return new Set(
      roadmap.sprints
        .filter(sprint => {
          const status = (sprint as RoadmapSprint & { status?: string }).status;
          return status === 'complete' || status === 'superseded';
        })
        .map(sprint => sprint.id),
    );
  } catch {
    return new Set();
  }
}

export async function findStaleWorkflowExecutions(
  cwd: string,
  store: Pick<SlopeStore, 'listExecutions'>,
  options: { staleAgeMs?: number; now?: Date; branchSprint?: number | null; includeNewerRunning?: boolean } = {},
): Promise<StaleWorkflowExecution[]> {
  const config = loadConfig(cwd);
  const scorecardSprintIds = new Set(loadScorecards(config, cwd).map(card => card.sprint_number));
  const roadmapDoneIds = completedRoadmapSprintIds(cwd, config);
  const running = await store.listExecutions({ status: 'running' });
  const runningSprints = running
    .map(exec => sprintNumberForExecution(exec))
    .filter((sprint): sprint is number => sprint !== null);
  const newestRunningSprint = runningSprints.length > 0 ? Math.max(...runningSprints) : null;
  const branchSprint = options.branchSprint === undefined ? inferSprintFromBranch(cwd) : options.branchSprint;
  const includeNewerRunning = options.includeNewerRunning ?? true;
  const staleAgeMs = options.staleAgeMs ?? DEFAULT_STALE_WORKFLOW_AGE_MS;
  const now = options.now ?? new Date();
  const stale: StaleWorkflowExecution[] = [];

  for (const exec of running) {
    const sprint = sprintNumberForExecution(exec);
    if (sprint === null) continue;
    const reasons: string[] = [];
    if (scorecardSprintIds.has(sprint)) reasons.push('scorecard exists');
    if (roadmapDoneIds.has(sprint)) reasons.push('roadmap complete/superseded');
    if (branchSprint !== null && sprint < branchSprint) reasons.push(`branch is on newer sprint S${formatSprintNumber(branchSprint)}`);
    if (includeNewerRunning && newestRunningSprint !== null && sprint < newestRunningSprint) reasons.push(`newer running sprint S${formatSprintNumber(newestRunningSprint)} exists`);
    if (isOlderThan(exec.updated_at || exec.started_at, now, staleAgeMs)) reasons.push(`older than ${Math.round(staleAgeMs / (24 * 60 * 60 * 1000))} days`);
    if (reasons.length > 0) {
      stale.push({ exec, reason: reasons.join(', ') });
    }
  }

  return stale;
}

export async function reconcileWorkflowExecutions(
  cwd: string,
  store: Pick<SlopeStore, 'listExecutions' | 'completeExecution' | 'updateExecutionState'>,
  options: { includeNewerRunning?: boolean } = {},
): Promise<WorkflowResyncResult> {
  const paused = await findStaleWorkflowExecutions(cwd, store, options);
  for (const { exec } of paused) {
    await store.completeExecution(exec.id, 'paused');
  }

  const fastForwarded: WorkflowResyncResult['fastForwarded'] = [];
  const active = await store.listExecutions({ status: 'running' });
  for (const exec of active) {
    const target = workflowFastForwardTarget(cwd, exec);
    if (!target) continue;
    await store.updateExecutionState(exec.id, target.phase, target.step);
    const sprint = sprintNumberFromId(exec.sprint_id);
    if (sprint !== null) syncSprintStateWithWorkflowPhase(cwd, sprint, target.phase);
    fastForwarded.push({ exec, ...target });
  }

  return { paused, fastForwarded };
}

export function reconcileSprintStateForBranch(cwd: string): SprintStateRebindResult | null {
  const branchSprint = inferSprintFromBranch(cwd);
  if (branchSprint === null) return null;

  const state = loadSprintState(cwd);
  if (!state) return null;
  if (state.sprint === branchSprint) return { sprint: state.sprint, rebound: false };
  if (!isStaleSprintStateForBranch(cwd, state.sprint, branchSprint)) return null;

  const phase: SprintPhase = scorecardExistsForSprint(cwd, branchSprint) ? 'scoring' : 'implementing';
  saveSprintState(cwd, createSprintState(branchSprint, phase));
  return {
    sprint: branchSprint,
    previousSprint: state.sprint,
    rebound: true,
    reason: `branch suggests S${formatSprintNumber(branchSprint)}`,
  };
}

function workflowFastForwardTarget(cwd: string, exec: WorkflowExecution): { phase: string; step: string; reason: string } | null {
  const sprint = sprintNumberForExecution(exec);
  if (sprint === null) return null;
  const branchSprint = inferSprintFromBranch(cwd);
  if (branchSprint !== sprint) return null;
  if (!hasSprintCommits(cwd, sprint)) return null;

  const def = loadExecutionWorkflow(exec, cwd);
  if (!def) return null;
  const target = preferredAgentWorkStep(def);
  if (!target) return null;
  if (exec.current_phase === target.phase && exec.current_step === target.step) return null;
  if (workflowPosition(def, exec.current_phase, exec.current_step) >= workflowPosition(def, target.phase, target.step)) return null;
  return { ...target, reason: 'sprint commits exist on current branch' };
}

function loadExecutionWorkflow(exec: WorkflowExecution, cwd: string): WorkflowDefinition | null {
  try {
    if (exec.definition_json) return JSON.parse(exec.definition_json) as WorkflowDefinition;
    return loadWorkflow(exec.workflow_name, cwd);
  } catch {
    return null;
  }
}

function preferredAgentWorkStep(def: WorkflowDefinition): { phase: string; step: string } | null {
  const perTicket = def.phases.find(phase => phase.id === 'per_ticket');
  const perTicketStep = perTicket?.steps.find(step => step.type === 'agent_work');
  if (perTicket && perTicketStep) return { phase: perTicket.id, step: perTicketStep.id };

  for (const phase of def.phases) {
    const step = phase.steps.find(candidate => candidate.type === 'agent_work');
    if (step) return { phase: phase.id, step: step.id };
  }
  return null;
}

function workflowPosition(def: WorkflowDefinition, phaseId: string | undefined, stepId: string | undefined): number {
  if (!phaseId || !stepId) return -1;
  let index = 0;
  for (const phase of def.phases) {
    for (const step of phase.steps) {
      if (phase.id === phaseId && step.id === stepId) return index;
      index++;
    }
  }
  return -1;
}

function isStaleSprintStateForBranch(cwd: string, stateSprint: number, branchSprint: number): boolean {
  if (stateSprint < branchSprint) return true;
  if (scorecardExistsForSprint(cwd, stateSprint)) return true;
  return completedRoadmapSprintIds(cwd).has(stateSprint);
}

const SPRINT_PHASE_ORDER: Record<SprintPhase, number> = {
  planning: 0,
  reviewing: 1,
  implementing: 2,
  scoring: 3,
  complete: 4,
};

function sprintPhaseForWorkflowPhase(workflowPhase: string): SprintPhase | null {
  switch (workflowPhase) {
    case 'pre_hole':
      return 'planning';
    case 'plan_review':
      return 'reviewing';
    case 'per_ticket':
      return 'implementing';
    case 'post_hole':
    case 'validate':
      return 'scoring';
    default:
      return null;
  }
}

function syncSprintStateWithWorkflowPhase(cwd: string, sprint: number, workflowPhase: string): void {
  const nextPhase = sprintPhaseForWorkflowPhase(workflowPhase);
  if (!nextPhase) return;

  const existing = loadSprintState(cwd);
  if (!existing || existing.sprint !== sprint) {
    saveSprintState(cwd, createSprintState(sprint, nextPhase));
    return;
  }
  if (existing.phase === 'complete') return;
  if (SPRINT_PHASE_ORDER[nextPhase] <= SPRINT_PHASE_ORDER[existing.phase]) return;

  mutateSprintState(cwd, current => {
    if (current.sprint !== sprint || current.phase === 'complete') return false;
    if (SPRINT_PHASE_ORDER[nextPhase] <= SPRINT_PHASE_ORDER[current.phase]) return false;
    current.phase = nextPhase;
    return true;
  });
}

function hasSprintCommits(cwd: string, sprint: number): boolean {
  const subjects = gitLogSubjects(cwd, ['origin/main..HEAD']);
  const scan = subjects.length > 0 ? subjects : gitLogSubjects(cwd, ['-n', '25']);
  const sprintLabel = escapeRegExp(formatSprintNumber(sprint));
  const re = new RegExp(`(?:^|\\b|[(/_-])S?${sprintLabel}(?:\\b|[-:_)]|$)`, 'i');
  return scan.some(subject => re.test(subject));
}

function gitLogSubjects(cwd: string, revArgs: string[]): string[] {
  try {
    const out = execFileSync('git', ['log', '--format=%s', ...revArgs], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isOlderThan(timestamp: string | undefined, now: Date, ageMs: number): boolean {
  if (!timestamp) return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && now.getTime() - time > ageMs;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
