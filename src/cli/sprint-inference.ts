import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  castRoadmapStructure,
  compareSprintIds,
  detectLatestSprint,
  formatSprintLabel,
  isEncodedInsertedSprintId,
  isRoadmapSprintPending,
  loadScorecards,
  nextCanonicalSprintId,
  parseRoadmap,
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
  roadmapSprint?: RoadmapSprint;
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
  const sprintState = loadSprintState(cwd);
  if (isActiveSprintState(sprintState)) {
    return {
      sprint: sprintState.sprint,
      label: formatSprintLabel(sprintState.sprint),
      source: 'sprint-state',
      latestScorecard,
    };
  }

  if (config.currentSprint) {
    return {
      sprint: config.currentSprint,
      label: formatSprintLabel(config.currentSprint),
      source: 'config',
      latestScorecard,
    };
  }

  const roadmap = loadRoadmapForInference(cwd, config);
  const scorecards = loadScorecards(config, cwd);
  const completedIds = new Set<number>(scorecards.map(card => card.sprint_number));
  const pendingSprints = roadmap?.sprints
    .filter(sprint => {
      return isRoadmapSprintPending(sprint) && !completedIds.has(sprint.id);
    })
    .sort((a, b) => compareSprintIds(a.id, b.id)) ?? [];

  const scorecardNext = latestScorecard > 0 ? nextCanonicalSprintId(latestScorecard) : 1;
  const pending = choosePendingSprint(pendingSprints, latestScorecard, scorecardNext);

  if (pending) {
    return {
      sprint: pending.id,
      label: formatSprintLabel(pending.id),
      source: 'roadmap',
      latestScorecard,
      roadmapSprint: pending,
    };
  }

  if (latestScorecard > 0) {
    const sprint = scorecardNext;
    return {
      sprint,
      label: formatSprintLabel(sprint),
      source: 'scorecards',
      latestScorecard,
    };
  }

  return {
    sprint: 1,
    label: 'S1',
    source: 'initial',
    latestScorecard: 0,
  };
}

function choosePendingSprint(
  pendingSprints: RoadmapSprint[],
  latestScorecard: number,
  scorecardNext: number,
): RoadmapSprint | undefined {
  if (pendingSprints.length === 0) return undefined;
  if (latestScorecard === 0) return pendingSprints[0];

  const exactNext = pendingSprints.find(sprint => sprint.id === scorecardNext);
  if (exactNext) return exactNext;

  const nextOrder = sprintOrderValue(scorecardNext);
  const insertedRecovery = pendingSprints.find(sprint =>
    isInsertedSprintId(sprint.id) && sprintOrderValue(sprint.id) <= nextOrder,
  );
  if (insertedRecovery) return insertedRecovery;

  return pendingSprints[0];
}

function isInsertedSprintId(id: number): boolean {
  return !Number.isInteger(id) || isEncodedInsertedSprintId(id);
}

export function maxSprintByOrder(ids: number[]): number {
  return ids.reduce((max, id) => sprintOrderValue(id) > sprintOrderValue(max) ? id : max, 0);
}
