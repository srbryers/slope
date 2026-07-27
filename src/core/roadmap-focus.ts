import {
  findRoadmapSprint,
  formatRoadmapSprintLabel,
  roadmapSprintKey,
  roadmapSprintKeyFromId,
  type RoadmapDefinition,
  type RoadmapSprint,
  type RoadmapTicket,
} from './roadmap.js';
import { sprintIdKey, type SprintId } from './sprint-id.js';

export const ROADMAP_FOCUS_LIMITS = Object.freeze({
  previous: 2,
  successors: 3,
  hazards: 8,
  evidence: 12,
});

export type RoadmapFocusRelation = 'dependency' | 'previous' | 'successor';

export interface RoadmapFocusSprintSummary {
  id: string;
  label: string;
  theme: string;
  par: number;
  slope: number;
  type: string;
  status: string;
  readiness: 'complete' | 'ready' | 'blocked';
  blocked_by: Array<{ id: string; label: string }>;
  note?: string;
}

export interface RoadmapFocusSprint extends RoadmapFocusSprintSummary {
  tickets: RoadmapTicket[];
}

export interface RoadmapFocusPhase {
  name: string;
  status?: string;
  note?: string;
  contract?: string;
  sprint_index: number;
  sprint_count: number;
}

export interface RoadmapFocusNeighbor {
  relation: RoadmapFocusRelation;
  direct: boolean;
  sprint: RoadmapFocusSprintSummary;
}

export interface RoadmapFocusHazard {
  sprint: SprintId;
  sprint_label: string;
  ticket?: string;
  type: string;
  severity?: string;
  description: string;
}

export interface RoadmapFocusEvidence {
  kind: 'roadmap' | 'scorecard' | 'review' | 'issue' | 'design' | 'other';
  label: string;
  ref: string;
  sprint?: SprintId;
}

export interface RoadmapFocusResult {
  version: 1;
  roadmap: {
    name: string;
  };
  sprint: RoadmapFocusSprint;
  phase: RoadmapFocusPhase | null;
  dependencies: RoadmapFocusNeighbor[];
  previous: RoadmapFocusNeighbor[];
  successors: RoadmapFocusNeighbor[];
  hazards: RoadmapFocusHazard[];
  evidence: RoadmapFocusEvidence[];
  bounds: {
    previous_limit: number;
    successor_limit: number;
    hazard_limit: number;
    evidence_limit: number;
  };
  omitted: {
    previous: number;
    successors: number;
    hazards: number;
    evidence: number;
  };
}

export interface RoadmapFocusOptions {
  completedSprintIds?: Iterable<SprintId>;
  hazards?: RoadmapFocusHazard[];
  scorecards?: Array<{
    sprint_number: SprintId;
    shots?: Array<{
      ticket_key?: string;
      hazards?: Array<{ type?: string; severity?: string; description?: string }>;
    }>;
    bunker_locations?: Array<string | { area?: string }>;
  }>;
  evidence?: RoadmapFocusEvidence[];
}

const TERMINAL_STATUSES = new Set([
  'complete',
  'superseded',
  'skipped',
  'cancelled',
  'cancelled-absorbed',
  'absorbed',
]);

function isComplete(roadmap: RoadmapDefinition, sprint: RoadmapSprint, completed: Set<string>): boolean {
  return completed.has(roadmapSprintKey(roadmap, sprint))
    || TERMINAL_STATUSES.has(sprint.status ?? '');
}

function summarizeSprint(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint,
  completed: Set<string>,
): RoadmapFocusSprintSummary {
  const complete = isComplete(roadmap, sprint, completed);
  const blockedBy = complete
    ? []
    : (sprint.depends_on ?? []).filter(dependencyId => {
      const dependency = findRoadmapSprint(roadmap, dependencyId);
      const dependencyKey = roadmapSprintKeyFromId(roadmap, dependencyId);
      return dependency
        ? !isComplete(roadmap, dependency, completed)
        : dependencyKey === null || !completed.has(dependencyKey);
    });
  const authoredStatus = sprint.status ?? 'planned';
  const projectedStatus = TERMINAL_STATUSES.has(authoredStatus)
    ? authoredStatus
    : complete ? 'complete' : authoredStatus;

  return {
    id: roadmapSprintKey(roadmap, sprint),
    label: formatRoadmapSprintLabel(roadmap, roadmapSprintKey(roadmap, sprint)),
    theme: sprint.theme,
    par: sprint.par,
    slope: sprint.slope,
    type: sprint.type,
    status: projectedStatus,
    readiness: complete ? 'complete' : blockedBy.length > 0 ? 'blocked' : 'ready',
    blocked_by: blockedBy.map(id => ({
      id: roadmapSprintKeyFromId(roadmap, id) ?? String(id),
      label: formatRoadmapSprintLabel(roadmap, id),
    })),
    ...(sprint.note ? { note: sprint.note } : {}),
  };
}

function cloneTickets(tickets: RoadmapTicket[]): RoadmapTicket[] {
  return tickets.map(ticket => ({
    ...ticket,
    ...(ticket.depends_on ? { depends_on: [...ticket.depends_on] } : {}),
    ...(Array.isArray(ticket.github_issue) ? { github_issue: [...ticket.github_issue] } : {}),
  }));
}

function uniqueHazards(hazards: RoadmapFocusHazard[]): RoadmapFocusHazard[] {
  const severityRank: Record<string, number> = { minor: 1, moderate: 2, major: 3, critical: 4 };
  const indexes = new Map<string, number>();
  const result: RoadmapFocusHazard[] = [];
  for (const hazard of hazards) {
    const key = [hazard.sprint, hazard.ticket ?? '', hazard.type, hazard.description].join('\u0000');
    const existingIndex = indexes.get(key);
    if (existingIndex == null) {
      indexes.set(key, result.length);
      result.push(hazard);
      continue;
    }
    const existing = result[existingIndex];
    if ((severityRank[hazard.severity ?? ''] ?? 0) > (severityRank[existing.severity ?? ''] ?? 0)) {
      result[existingIndex] = hazard;
    }
  }
  return result;
}

function uniqueEvidence(evidence: RoadmapFocusEvidence[]): RoadmapFocusEvidence[] {
  const seen = new Set<string>();
  return evidence.filter(item => {
    const key = `${item.kind}\u0000${item.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scorecardHazards(
  roadmap: RoadmapDefinition,
  contextSprintIds: string[],
  scorecards: RoadmapFocusOptions['scorecards'],
): RoadmapFocusHazard[] {
  if (!scorecards?.length) return [];
  const hazards: RoadmapFocusHazard[] = [];

  for (const roadmapSprintId of contextSprintIds) {
    const card = scorecards.find(candidate =>
      roadmapSprintKeyFromId(roadmap, candidate.sprint_number) === roadmapSprintId,
    );
    if (!card) continue;

    for (const shot of card.shots ?? []) {
      for (const hazard of shot.hazards ?? []) {
        const description = hazard.description?.trim();
        if (!description) continue;
        hazards.push({
          sprint: roadmapSprintId,
          sprint_label: formatRoadmapSprintLabel(roadmap, roadmapSprintId),
          ...(shot.ticket_key ? { ticket: shot.ticket_key } : {}),
          type: hazard.type ?? 'hazard',
          ...(hazard.severity ? { severity: hazard.severity } : {}),
          description,
        });
      }
    }
    for (const location of card.bunker_locations ?? []) {
      const description = typeof location === 'string' ? location.trim() : location.area?.trim();
      if (!description) continue;
      hazards.push({
        sprint: roadmapSprintId,
        sprint_label: formatRoadmapSprintLabel(roadmap, roadmapSprintId),
        type: 'bunker_location',
        description,
      });
    }
  }
  return hazards;
}

function sprintEvidence(roadmap: RoadmapDefinition, sprint: RoadmapSprint): RoadmapFocusEvidence[] {
  const evidence: RoadmapFocusEvidence[] = [];
  const sprintKey = roadmapSprintKey(roadmap, sprint);
  for (const ticket of sprint.tickets) {
    if (ticket.github_issue == null) continue;
    const issues = Array.isArray(ticket.github_issue) ? ticket.github_issue : [ticket.github_issue];
    for (const issue of issues) {
      evidence.push({
        kind: 'issue',
        label: `GitHub issue #${issue}`,
        ref: `#${issue}`,
        sprint: sprintKey,
      });
    }
  }
  for (const ref of sprint.artifacts ?? []) {
    evidence.push({ kind: 'other', label: 'Artifact', ref, sprint: sprintKey });
  }
  for (const ref of sprint.expected_artifacts ?? []) {
    evidence.push({ kind: 'other', label: 'Expected artifact', ref, sprint: sprintKey });
  }
  for (const ref of sprint.research ?? []) {
    evidence.push({ kind: 'design', label: 'Research', ref, sprint: sprintKey });
  }
  return evidence;
}

/** Build a deterministic, bounded sprint context from any roadmap definition. */
export function buildRoadmapFocus(
  roadmap: RoadmapDefinition,
  sprintId: SprintId,
  options: RoadmapFocusOptions = {},
): RoadmapFocusResult | null {
  const selected = findRoadmapSprint(roadmap, sprintId);
  if (!selected) return null;

  const completed = new Set(
    [...(options.completedSprintIds ?? [])]
      .map(id => roadmapSprintKeyFromId(roadmap, id) ?? sprintIdKey(id))
      .filter((id): id is string => id !== null),
  );
  const selectedKey = roadmapSprintKey(roadmap, selected);
  const phase = roadmap.phases.find(candidate => {
    const keys: SprintId[] = candidate.sprint_keys ?? candidate.sprints;
    return keys.some(id => roadmapSprintKeyFromId(roadmap, id) === selectedKey);
  });
  const phaseKeys = (phase?.sprint_keys ?? phase?.sprints ?? [])
    .map(id => roadmapSprintKeyFromId(roadmap, id))
    .filter((id): id is string => id !== null);
  const phaseIndex = phaseKeys.indexOf(selectedKey);
  const dependencies = (selected.depends_on ?? [])
    .map(id => findRoadmapSprint(roadmap, id))
    .filter((sprint): sprint is RoadmapSprint => sprint != null)
    .map(sprint => ({ relation: 'dependency' as const, direct: true, sprint: summarizeSprint(roadmap, sprint, completed) }));
  const dependencyIds = new Set(dependencies.map(dependency => dependency.sprint.id));

  const allPreviousIds = phaseIndex < 0
    ? []
    : phaseKeys.slice(0, phaseIndex).filter(id => !dependencyIds.has(id));
  const previousIds = allPreviousIds.slice(-ROADMAP_FOCUS_LIMITS.previous);
  const previous = previousIds
    .map(id => findRoadmapSprint(roadmap, id))
    .filter((sprint): sprint is RoadmapSprint => sprint != null)
    .map(sprint => ({ relation: 'previous' as const, direct: false, sprint: summarizeSprint(roadmap, sprint, completed) }));

  const allSuccessorIds = phaseIndex < 0 ? [] : phaseKeys.slice(phaseIndex + 1);
  const successorIds = allSuccessorIds.slice(0, ROADMAP_FOCUS_LIMITS.successors);
  const successors = successorIds
    .map(id => findRoadmapSprint(roadmap, id))
    .filter((sprint): sprint is RoadmapSprint => sprint != null)
    .map(sprint => ({
      relation: 'successor' as const,
      direct: (sprint.depends_on ?? []).some(
        id => roadmapSprintKeyFromId(roadmap, id) === selectedKey,
      ),
      sprint: summarizeSprint(roadmap, sprint, completed),
    }));

  const phaseHazards: RoadmapFocusHazard[] = phase ? [] : [{
    sprint: selectedKey,
    sprint_label: formatRoadmapSprintLabel(roadmap, selectedKey),
    type: 'roadmap_integrity',
    severity: 'moderate',
    description: 'Sprint is not assigned to a roadmap phase.',
  }];
  const hazardContextIds = [selectedKey, ...dependencies.map(item => item.sprint.id), ...previousIds];
  const historicalHazards = scorecardHazards(roadmap, hazardContextIds, options.scorecards);
  const allHazards = uniqueHazards([...phaseHazards, ...(options.hazards ?? []), ...historicalHazards]);
  const hazards = allHazards.slice(0, ROADMAP_FOCUS_LIMITS.hazards);
  const suppliedEvidence = options.evidence ?? [];
  const roadmapEvidence = suppliedEvidence.filter(item => item.kind === 'roadmap');
  const ancillaryEvidence = suppliedEvidence.filter(item => item.kind !== 'roadmap');
  const allEvidence = uniqueEvidence([
    ...roadmapEvidence,
    ...sprintEvidence(roadmap, selected),
    ...ancillaryEvidence,
  ]);
  const evidence = allEvidence.slice(0, ROADMAP_FOCUS_LIMITS.evidence);

  return {
    version: 1,
    roadmap: {
      name: roadmap.name,
    },
    sprint: {
      ...summarizeSprint(roadmap, selected, completed),
      tickets: cloneTickets(selected.tickets),
    },
    phase: phase ? {
      name: phase.name,
      ...(phase.status ? { status: phase.status } : {}),
      ...(phase.note ? { note: phase.note } : {}),
      ...(phase.description || phase.note ? { contract: phase.description ?? phase.note } : {}),
      sprint_index: phaseIndex + 1,
      sprint_count: phaseKeys.length,
    } : null,
    dependencies,
    previous,
    successors,
    hazards,
    evidence,
    bounds: {
      previous_limit: ROADMAP_FOCUS_LIMITS.previous,
      successor_limit: ROADMAP_FOCUS_LIMITS.successors,
      hazard_limit: ROADMAP_FOCUS_LIMITS.hazards,
      evidence_limit: ROADMAP_FOCUS_LIMITS.evidence,
    },
    omitted: {
      previous: Math.max(0, allPreviousIds.length - previous.length),
      successors: Math.max(0, allSuccessorIds.length - successors.length),
      hazards: Math.max(0, allHazards.length - hazards.length),
      evidence: Math.max(0, allEvidence.length - evidence.length),
    },
  };
}

function oneLine(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function formatNeighbors(items: RoadmapFocusNeighbor[]): string[] {
  if (items.length === 0) return ['- None'];
  return items.map(({ sprint, direct }) => {
    const blocked = sprint.blocked_by.length > 0
      ? `; blocked by ${sprint.blocked_by.map(item => item.label).join(', ')}`
      : '';
    return `- ${sprint.label}: ${oneLine(sprint.theme, 120)} (${sprint.readiness}${direct ? '; direct' : ''}${blocked})`;
  });
}

export function formatRoadmapFocus(focus: RoadmapFocusResult): string {
  const lines = [
    `# Focused Roadmap Context — ${focus.sprint.label}`,
    '',
    `Roadmap: ${focus.roadmap.name}`,
    `Readiness: ${focus.sprint.readiness}${focus.sprint.blocked_by.length ? ` (blocked by ${focus.sprint.blocked_by.map(item => item.label).join(', ')})` : ''}`,
    '',
    '## Phase Contract',
    '',
    focus.phase
      ? `${focus.phase.name} — sprint ${focus.phase.sprint_index}/${focus.phase.sprint_count}`
      : 'No phase membership recorded.',
  ];
  if (focus.phase?.contract) lines.push(oneLine(focus.phase.contract));

  lines.push('', '## Active Sprint', '');
  lines.push(`${focus.sprint.label}: ${oneLine(focus.sprint.theme)}`);
  lines.push(`Type: ${focus.sprint.type}; par ${focus.sprint.par}; slope ${focus.sprint.slope}; status ${focus.sprint.status}`);
  if (focus.sprint.note) lines.push(oneLine(focus.sprint.note));
  for (const ticket of focus.sprint.tickets) lines.push(`- ${ticket.key}: ${oneLine(ticket.title, 180)}`);

  lines.push('', '## Direct Dependencies', '', ...formatNeighbors(focus.dependencies));
  lines.push('', '## Recent Phase Context', '', ...formatNeighbors(focus.previous));
  lines.push('', '## Immediate Successors', '', ...formatNeighbors(focus.successors));
  lines.push('', '## Hazards', '');
  if (focus.hazards.length === 0) lines.push('- None');
  for (const hazard of focus.hazards) {
    lines.push(`- [${hazard.sprint_label}${hazard.ticket ? ` ${hazard.ticket}` : ''}] ${hazard.type}: ${oneLine(hazard.description)}`);
  }
  if (focus.omitted.hazards > 0) lines.push(`- … ${focus.omitted.hazards} additional hazard(s) omitted`);

  lines.push('', '## Evidence', '');
  if (focus.evidence.length === 0) lines.push('- None');
  for (const item of focus.evidence) lines.push(`- [${item.kind}] ${oneLine(item.label, 100)}: ${item.ref}`);
  if (focus.omitted.evidence > 0) lines.push(`- … ${focus.omitted.evidence} additional evidence record(s) omitted`);

  return `${lines.join('\n')}\n`;
}
