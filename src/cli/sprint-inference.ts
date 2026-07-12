import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  castRoadmapStructure,
  compareSprintIds,
  compareRoadmapSprintIds,
  detectLatestSprint,
  formatSprintLabel,
  formatRoadmapSprintLabel,
  isRoadmapSprintTerminal,
  isRoadmapSprintPending,
  loadScorecards,
  nextCanonicalSprintId,
  parseRoadmap,
  roadmapSprintOrderValue,
  sprintOrderValue,
} from '../core/index.js';
import type { RoadmapDefinition, RoadmapSprint, SlopeConfig } from '../core/index.js';
import { loadConfig } from './config.js';
import { isActiveSprintState, loadSprintState } from './sprint-state.js';

export interface InferredSprintContext {
  sprint: number;
  label: string;
  source: 'sprint-state' | 'config' | 'roadmap' | 'scorecards' | 'initial';
  latestScorecard: number;
  latestScorecardLabel: string;
  scorecardFallbackSprint?: number;
  scorecardFallbackLabel?: string;
  roadmapSprint?: RoadmapSprint;
  staleSprintState?: {
    sprint: number;
    phase: string;
    reason: string;
  };
  staleConfigSprint?: {
    sprint: number;
    reason: string;
  };
}

export function loadRoadmapForInference(cwd: string, config: SlopeConfig): RoadmapDefinition | null {
  const roadmapPath = join(cwd, config.roadmapPath);
  if (!existsSync(roadmapPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const parsed = parseRoadmap(raw);
    return parsed.roadmap ?? castRoadmapStructure(raw);
  } catch {
    return null;
  }
}

export function inferSprintContext(cwd: string = process.cwd(), config: SlopeConfig = loadConfig(cwd)): InferredSprintContext {
  const latestScorecard = detectLatestSprint(config, cwd);
  const roadmap = loadRoadmapForInference(cwd, config);
  const latestScorecardLabel = labelForSprint(latestScorecard, roadmap);
  const sprintState = loadSprintState(cwd);
  const staleSprintState = activeStateCompletedByScorecards(sprintState, latestScorecard, roadmap);
  const staleConfigSprint = configuredSprintCompletedByScorecards(config.currentSprint, latestScorecard, roadmap);
  if (isActiveSprintState(sprintState) && !staleSprintState) {
    return {
      sprint: sprintState.sprint,
      label: labelForSprint(sprintState.sprint, roadmap),
      source: 'sprint-state',
      latestScorecard,
      latestScorecardLabel,
    };
  }

  if (config.currentSprint && !staleConfigSprint) {
    return {
      sprint: config.currentSprint,
      label: labelForSprint(config.currentSprint, roadmap),
      source: 'config',
      latestScorecard,
      latestScorecardLabel,
      ...(staleSprintState ? { staleSprintState } : {}),
    };
  }

  const scorecards = loadScorecards(config, cwd);
  const completedIds = new Set<number>([
    ...scorecards.map(card => card.sprint_number),
    ...(roadmap?.sprints.filter(isRoadmapSprintTerminal).map(sprint => sprint.id) ?? []),
  ]);
  const pendingSprints = roadmap?.sprints
    .filter(sprint => {
      return isRoadmapSprintPending(sprint) && !completedIds.has(sprint.id);
    })
    .sort((a, b) => compareSprintIdsForRoadmap(a.id, b.id, roadmap)) ?? [];

  const scorecardNext = latestScorecard > 0 ? nextCanonicalSprintId(latestScorecard) : 1;
  const scorecardFallbackLabel = labelForSprint(scorecardNext, roadmap);
  const pending = choosePendingSprint(pendingSprints, latestScorecard, scorecardNext, roadmap, completedIds);

  if (pending) {
    return {
      sprint: pending.id,
      label: labelForSprint(pending.id, roadmap),
      source: 'roadmap',
      latestScorecard,
      latestScorecardLabel,
      scorecardFallbackSprint: scorecardNext,
      scorecardFallbackLabel,
      roadmapSprint: pending,
      ...(staleSprintState ? { staleSprintState } : {}),
      ...(staleConfigSprint ? { staleConfigSprint } : {}),
    };
  }

  if (latestScorecard > 0) {
    const sprint = scorecardNext;
    return {
      sprint,
      label: labelForSprint(sprint, roadmap),
      source: 'scorecards',
      latestScorecard,
      latestScorecardLabel,
      scorecardFallbackSprint: scorecardNext,
      scorecardFallbackLabel,
      ...(staleSprintState ? { staleSprintState } : {}),
      ...(staleConfigSprint ? { staleConfigSprint } : {}),
    };
  }

  return {
    sprint: 1,
    label: 'S1',
    source: 'initial',
    latestScorecard: 0,
    latestScorecardLabel: 'S0',
    scorecardFallbackSprint: 1,
    scorecardFallbackLabel: 'S1',
    ...(staleSprintState ? { staleSprintState } : {}),
    ...(staleConfigSprint ? { staleConfigSprint } : {}),
  };
}

function activeStateCompletedByScorecards(
  sprintState: ReturnType<typeof loadSprintState>,
  latestScorecard: number,
  roadmap: RoadmapDefinition | null,
): InferredSprintContext['staleSprintState'] | null {
  if (!isActiveSprintState(sprintState) || latestScorecard <= 0) return null;
  if (orderForSprint(sprintState.sprint, roadmap) > orderForSprint(latestScorecard, roadmap)) return null;
  return {
    sprint: sprintState.sprint,
    phase: sprintState.phase,
    reason: `completed scorecard evidence has advanced to ${labelForSprint(latestScorecard, roadmap)}`,
  };
}

function configuredSprintCompletedByScorecards(
  currentSprint: number | undefined,
  latestScorecard: number,
  roadmap: RoadmapDefinition | null,
): InferredSprintContext['staleConfigSprint'] | null {
  if (!currentSprint || latestScorecard <= 0) return null;
  if (orderForSprint(currentSprint, roadmap) > orderForSprint(latestScorecard, roadmap)) return null;
  return {
    sprint: currentSprint,
    reason: `completed scorecard evidence has advanced to ${labelForSprint(latestScorecard, roadmap)}`,
  };
}

function choosePendingSprint(
  pendingSprints: RoadmapSprint[],
  latestScorecard: number,
  scorecardNext: number,
  roadmap: RoadmapDefinition | null,
  completedIds: Set<number>,
): RoadmapSprint | undefined {
  if (pendingSprints.length === 0) return undefined;
  if (latestScorecard === 0) return pendingSprints[0];

  const exactNext = pendingSprints.find(sprint => sprint.id === scorecardNext && dependenciesAreComplete(sprint, completedIds));
  if (exactNext) return exactNext;

  const nextOrder = orderForSprint(scorecardNext, roadmap);
  const insertedRecovery = pendingSprints.find(sprint =>
    isInsertedSprintId(sprint.id, roadmap)
    && orderForSprint(sprint.id, roadmap) <= nextOrder
    && dependenciesAreComplete(sprint, completedIds),
  );
  if (insertedRecovery) return insertedRecovery;

  const latestOrder = orderForSprint(latestScorecard, roadmap);
  const readySuccessor = pendingSprints.find(sprint =>
    orderForSprint(sprint.id, roadmap) > latestOrder && dependenciesAreComplete(sprint, completedIds),
  );
  if (readySuccessor) return readySuccessor;

  const readyHistorical = pendingSprints.find(sprint => dependenciesAreComplete(sprint, completedIds));
  if (readyHistorical) return readyHistorical;

  return pendingSprints[0];
}

function dependenciesAreComplete(sprint: RoadmapSprint, completedIds: Set<number>): boolean {
  return (sprint.depends_on ?? []).every(dep => completedIds.has(dep));
}

function isInsertedSprintId(id: number, roadmap: RoadmapDefinition | null): boolean {
  return !Number.isInteger(id) || orderForSprint(id, roadmap) !== id;
}

function labelForSprint(id: number, roadmap: RoadmapDefinition | null): string {
  if (id <= 0) return `S${id}`;
  return roadmap ? formatRoadmapSprintLabel(roadmap, id) : formatSprintLabel(id);
}

function orderForSprint(id: number, roadmap: RoadmapDefinition | null): number {
  return roadmap ? roadmapSprintOrderValue(roadmap, id) : sprintOrderValue(id);
}

function compareSprintIdsForRoadmap(a: number, b: number, roadmap: RoadmapDefinition | null): number {
  return roadmap ? compareRoadmapSprintIds(roadmap, a, b) : compareSprintIds(a, b);
}

export function maxSprintByOrder(ids: number[]): number {
  return ids.reduce((max, id) => sprintOrderValue(id) > sprintOrderValue(max) ? id : max, 0);
}
