import { isAbsolute, posix } from 'node:path';
import { parseDocument } from 'yaml';
import { castRoadmapStructure } from './roadmap.js';
import { compareRoadmapSprintIds } from './roadmap.js';
import type { RoadmapDefinition, RoadmapPhase, RoadmapSprint } from './roadmap.js';

export type RoadmapSourceKind = 'phase' | 'backlog' | 'archive';

export interface RoadmapSourceEntry {
  path: string;
  kind: RoadmapSourceKind;
}

export interface RoadmapSourceProject {
  version: '1';
  name: string;
  description?: string;
  output: string;
  sources: RoadmapSourceEntry[];
}

export interface RoadmapSourceDocument {
  version: '1';
  phase: RoadmapPhase;
  sprints: RoadmapSprint[];
  scorecards?: Record<string, string>;
}

export interface LoadedRoadmapSource {
  entry: RoadmapSourceEntry;
  document: RoadmapSourceDocument;
  absolutePath?: string;
}

export class RoadmapSourceError extends Error {
  constructor(
    message: string,
    readonly sourcePath?: string,
  ) {
    super(sourcePath ? `${normalizeDiagnosticPath(sourcePath)}: ${message}` : message);
    this.name = 'RoadmapSourceError';
  }
}

export function normalizeDiagnosticPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function normalizeRoadmapSourcePath(path: string, label = 'source path'): string {
  const portable = normalizeDiagnosticPath(path).trim();
  if (!portable) throw new RoadmapSourceError(`${label} must not be empty`);
  if (isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new RoadmapSourceError(`${label} must be relative: ${portable}`);
  }
  const normalized = posix.normalize(portable).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new RoadmapSourceError(`${label} escapes its allowed root: ${portable}`);
  }
  return normalized;
}

function normalizeOutputPath(path: string): string {
  const portable = normalizeDiagnosticPath(path).trim();
  if (!portable) throw new RoadmapSourceError('output must not be empty');
  if (isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new RoadmapSourceError(`output must be relative: ${portable}`);
  }
  return posix.normalize(portable).replace(/^\.\//, '');
}

function parseYamlMapping(yaml: string, sourcePath: string): Record<string, unknown> {
  const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new RoadmapSourceError(`YAML parse error: ${document.errors[0].message}`, sourcePath);
  }
  const value = document.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RoadmapSourceError('document must be a YAML mapping', sourcePath);
  }
  return value as Record<string, unknown>;
}

function parseVersion(value: unknown, sourcePath: string): '1' {
  if (value !== 1 && value !== '1') {
    throw new RoadmapSourceError('version must be 1', sourcePath);
  }
  return '1';
}

function parseSourceKind(value: unknown, sourcePath: string, index: number): RoadmapSourceKind {
  if (value === 'phase' || value === 'backlog' || value === 'archive') return value;
  throw new RoadmapSourceError(`sources[${index}].kind must be phase, backlog, or archive`, sourcePath);
}

export function parseRoadmapSourceProject(
  yaml: string,
  sourcePath = 'docs/roadmap/project.yaml',
): RoadmapSourceProject {
  const raw = parseYamlMapping(yaml, sourcePath);
  const version = parseVersion(raw.version, sourcePath);
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new RoadmapSourceError('name must be a non-empty string', sourcePath);
  }
  if (raw.description != null && typeof raw.description !== 'string') {
    throw new RoadmapSourceError('description must be a string when present', sourcePath);
  }
  if (typeof raw.output !== 'string') {
    throw new RoadmapSourceError('output must be a relative path', sourcePath);
  }
  const output = normalizeOutputPath(raw.output);
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new RoadmapSourceError('sources must be a non-empty sequence', sourcePath);
  }

  const sources = raw.sources.map((value, index): RoadmapSourceEntry => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new RoadmapSourceError(`sources[${index}] must be a mapping`, sourcePath);
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.path !== 'string') {
      throw new RoadmapSourceError(`sources[${index}].path must be a string`, sourcePath);
    }
    const path = normalizeRoadmapSourcePath(entry.path, `sources[${index}].path`);
    const kind = parseSourceKind(entry.kind, sourcePath, index);
    const expectedPrefix = kind === 'phase' ? 'phases/' : `${kind}/`;
    if (!path.startsWith(expectedPrefix)) {
      throw new RoadmapSourceError(
        `sources[${index}] kind ${kind} must use ${expectedPrefix} (received ${path})`,
        sourcePath,
      );
    }
    return { path, kind };
  });

  return {
    version,
    name: raw.name.trim(),
    ...(raw.description ? { description: raw.description } : {}),
    output,
    sources,
  };
}

export function parseRoadmapSourceDocument(
  yaml: string,
  sourcePath: string,
): RoadmapSourceDocument {
  const raw = parseYamlMapping(yaml, sourcePath);
  const version = parseVersion(raw.version, sourcePath);
  if (!raw.phase || typeof raw.phase !== 'object' || Array.isArray(raw.phase)) {
    throw new RoadmapSourceError('phase must be a mapping', sourcePath);
  }
  const phase = raw.phase as Record<string, unknown>;
  if (typeof phase.name !== 'string' || !phase.name.trim()) {
    throw new RoadmapSourceError('phase.name must be a non-empty string', sourcePath);
  }
  if (!Array.isArray(phase.sprints) || phase.sprints.some(id => typeof id !== 'number')) {
    throw new RoadmapSourceError('phase.sprints must be a sequence of numeric sprint IDs', sourcePath);
  }
  if (!Array.isArray(raw.sprints)) {
    throw new RoadmapSourceError('sprints must be a sequence', sourcePath);
  }

  const structural = castRoadmapStructure({
    name: phase.name,
    phases: [phase],
    sprints: raw.sprints,
  });
  if (!structural) {
    throw new RoadmapSourceError('sprints could not be read as roadmap definitions', sourcePath);
  }
  for (const [index, sprint] of structural.sprints.entries()) {
    if (typeof sprint.id !== 'number' || !Number.isFinite(sprint.id)) {
      throw new RoadmapSourceError(`sprints[${index}].id must be numeric`, sourcePath);
    }
    if (!Array.isArray(sprint.tickets)) {
      throw new RoadmapSourceError(`sprints[${index}].tickets must be a sequence`, sourcePath);
    }
  }

  let scorecards: Record<string, string> | undefined;
  if (raw.scorecards != null) {
    if (typeof raw.scorecards !== 'object' || Array.isArray(raw.scorecards)) {
      throw new RoadmapSourceError('scorecards must be a mapping of sprint ID to repo-relative path', sourcePath);
    }
    scorecards = {};
    for (const [sprint, value] of Object.entries(raw.scorecards as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new RoadmapSourceError(`scorecards.${sprint} must be a string path`, sourcePath);
      }
      scorecards[sprint] = normalizeRoadmapSourcePath(value, `scorecards.${sprint}`);
    }
  }

  return {
    version,
    phase: structural.phases[0],
    sprints: structural.sprints,
    ...(scorecards ? { scorecards } : {}),
  };
}

export function sourceProjectToRoadmap(project: RoadmapSourceProject): Pick<RoadmapDefinition, 'name' | 'description'> {
  return {
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
  };
}

function clonePhase(phase: RoadmapPhase): RoadmapPhase {
  return { ...phase, sprints: [...phase.sprints] };
}

function cloneSprint(sprint: RoadmapSprint): RoadmapSprint {
  return {
    ...sprint,
    ...(sprint.depends_on ? { depends_on: [...sprint.depends_on] } : {}),
    tickets: sprint.tickets.map(ticket => ({
      ...ticket,
      ...(ticket.depends_on ? { depends_on: [...ticket.depends_on] } : {}),
    })),
    ...(sprint.artifacts ? { artifacts: [...sprint.artifacts] } : {}),
    ...(sprint.expected_artifacts ? { expected_artifacts: [...sprint.expected_artifacts] } : {}),
    ...(sprint.research ? { research: [...sprint.research] } : {}),
  };
}

/** Compile ordered authoring bundles into the existing roadmap compatibility shape. */
export function compileRoadmapSources(
  project: RoadmapSourceProject,
  sources: LoadedRoadmapSource[],
): RoadmapDefinition {
  const roadmap: RoadmapDefinition = {
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    phases: sources.map(source => clonePhase(source.document.phase)),
    sprints: sources.flatMap(source => source.document.sprints.map(cloneSprint)),
  };
  roadmap.sprints.sort((a, b) => compareRoadmapSprintIds(roadmap, a.id, b.id));
  return roadmap;
}

export function serializeRoadmapProjection(roadmap: RoadmapDefinition): string {
  return `${JSON.stringify(roadmap, null, 2)}\n`;
}
