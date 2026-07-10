import { isAbsolute, posix } from 'node:path';
import { parseDocument } from 'yaml';
import { castRoadmapStructure, getRoadmapTicketKey, validateRoadmap } from './roadmap.js';
import { compareRoadmapSprintIds, roadmapSprintOrderValue } from './roadmap.js';
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

export interface RoadmapSourceValidationIssue {
  code: string;
  message: string;
  source?: string;
  sprint?: number;
  ticket?: string;
}

export interface RoadmapSourceValidationResult {
  valid: boolean;
  errors: RoadmapSourceValidationIssue[];
  warnings: RoadmapSourceValidationIssue[];
  roadmap: RoadmapDefinition;
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
  const normalized = posix.normalize(portable).replace(/^\.\//, '');
  if (!normalized.endsWith('.json')) {
    throw new RoadmapSourceError(`output must be a JSON compatibility artifact: ${portable}`);
  }
  const parentEscapes = normalized.split('/').filter(part => part === '..').length;
  if (parentEscapes > 1) {
    throw new RoadmapSourceError(`output escapes the roadmap compatibility area: ${portable}`);
  }
  return normalized;
}

function parseYamlMapping(yaml: string, sourcePath: string): Record<string, unknown> {
  const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new RoadmapSourceError(`YAML parse error: ${document.errors[0].message}`, sourcePath);
  }
  if (document.warnings.length > 0) {
    throw new RoadmapSourceError(`YAML warning: ${document.warnings[0].message}`, sourcePath);
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new RoadmapSourceError(`YAML expansion error: ${(error as Error).message}`, sourcePath);
  }
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
  const uniquePaths = new Set(sources.map(source => source.path));
  if (uniquePaths.size !== sources.length) {
    throw new RoadmapSourceError('sources contains duplicate paths', sourcePath);
  }

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
  for (const field of ['description', 'status', 'note'] as const) {
    if (phase[field] != null && typeof phase[field] !== 'string') {
      throw new RoadmapSourceError(`phase.${field} must be a string when present`, sourcePath);
    }
  }
  if (!Array.isArray(phase.sprints)
    || phase.sprints.some(id => typeof id !== 'number' || !Number.isFinite(id) || id <= 0)) {
    throw new RoadmapSourceError('phase.sprints must be a sequence of positive numeric sprint IDs', sourcePath);
  }
  if (!Array.isArray(raw.sprints)) {
    throw new RoadmapSourceError('sprints must be a sequence', sourcePath);
  }

  const validClubs = new Set(['driver', 'long_iron', 'short_iron', 'wedge', 'putter']);
  // Pre-schema compatibility values are deliberately bounded rather than
  // normalized: federation must reproduce accepted historical JSON exactly.
  const validComplexities = new Set([
    'trivial',
    'small',
    'standard',
    'moderate',
    'multi_package',
    'multi-package',
    'risky',
  ]);
  for (const [sprintIndex, value] of raw.sprints.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}] must be a mapping`, sourcePath);
    }
    const sprint = value as Record<string, unknown>;
    if (typeof sprint.id !== 'number' || !Number.isFinite(sprint.id) || sprint.id <= 0) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].id must be a positive number`, sourcePath);
    }
    if (typeof sprint.theme !== 'string' || !sprint.theme.trim()) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].theme must be a non-empty string`, sourcePath);
    }
    if (![3, 4, 5].includes(sprint.par as number)) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].par must be 3, 4, or 5`, sourcePath);
    }
    if (typeof sprint.slope !== 'number' || !Number.isFinite(sprint.slope)) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].slope must be numeric`, sourcePath);
    }
    if (typeof sprint.type !== 'string' || !sprint.type.trim()) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].type must be a non-empty string`, sourcePath);
    }
    if (sprint.depends_on != null
      && (!Array.isArray(sprint.depends_on)
        || sprint.depends_on.some(id => typeof id !== 'number' || !Number.isFinite(id) || id <= 0))) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].depends_on must contain numeric sprint IDs`, sourcePath);
    }
    for (const field of ['status', 'note', 'outcome', 'phase', 'wave'] as const) {
      if (sprint[field] != null && typeof sprint[field] !== 'string') {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].${field} must be a string when present`, sourcePath);
      }
    }
    for (const field of ['artifacts', 'expected_artifacts', 'research'] as const) {
      if (sprint[field] != null
        && (!Array.isArray(sprint[field]) || sprint[field].some(item => typeof item !== 'string'))) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].${field} must contain string paths`, sourcePath);
      }
    }
    if (!Array.isArray(sprint.tickets)) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets must be a sequence`, sourcePath);
    }
    for (const [ticketIndex, ticketValue] of sprint.tickets.entries()) {
      if (!ticketValue || typeof ticketValue !== 'object' || Array.isArray(ticketValue)) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}] must be a mapping`, sourcePath);
      }
      const ticket = ticketValue as Record<string, unknown>;
      const key = typeof ticket.key === 'string' && ticket.key.trim()
        ? ticket.key
        : typeof ticket.id === 'string' && ticket.id.trim() ? ticket.id : null;
      if (!key) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}] requires key or id`, sourcePath);
      }
      if (typeof ticket.title !== 'string' || !ticket.title.trim()) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}].title must be a non-empty string`, sourcePath);
      }
      if (!validClubs.has(String(ticket.club))) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}].club is invalid`, sourcePath);
      }
      if (!validComplexities.has(String(ticket.complexity))) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}].complexity is invalid`, sourcePath);
      }
      if (ticket.depends_on != null
        && (!Array.isArray(ticket.depends_on)
          || ticket.depends_on.some(id => typeof id !== 'string' || !id.trim()))) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}].depends_on must contain ticket keys`, sourcePath);
      }
      const issueValues = Array.isArray(ticket.github_issue) ? ticket.github_issue : [ticket.github_issue];
      if (ticket.github_issue != null
        && (issueValues.length === 0
          || issueValues.some(issue => typeof issue !== 'number' || !Number.isInteger(issue) || issue <= 0))) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}].github_issue must be a positive integer or non-empty sequence of positive integers`, sourcePath);
      }
      if (ticket.note != null && typeof ticket.note !== 'string') {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].tickets[${ticketIndex}].note must be a string`, sourcePath);
      }
    }
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
      if (!/^\d+(?:\.\d+)?$/.test(sprint) || Number(sprint) <= 0) {
        throw new RoadmapSourceError(`scorecards key must be a positive sprint ID: ${sprint}`, sourcePath);
      }
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
  const byPath = new Map<string, LoadedRoadmapSource>();
  for (const source of sources) {
    if (byPath.has(source.entry.path)) {
      throw new RoadmapSourceError(`Loaded source is duplicated: ${source.entry.path}`);
    }
    byPath.set(source.entry.path, source);
  }
  const manifestPaths = new Set(project.sources.map(source => source.path));
  const unexpected = sources.find(source => !manifestPaths.has(source.entry.path));
  if (unexpected) throw new RoadmapSourceError(`Loaded source is not declared by the manifest: ${unexpected.entry.path}`);
  const ordered = project.sources.map(entry => {
    const source = byPath.get(entry.path);
    if (!source) throw new RoadmapSourceError(`Manifest source was not loaded: ${entry.path}`);
    if (source.entry.kind !== entry.kind) {
      throw new RoadmapSourceError(`Source kind mismatch for ${entry.path}: expected ${entry.kind}, received ${source.entry.kind}`);
    }
    return source;
  });

  const roadmap: RoadmapDefinition = {
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    phases: ordered.map(source => clonePhase(source.document.phase)),
    sprints: ordered.flatMap(source => source.document.sprints.map(cloneSprint)),
  };
  roadmap.sprints.sort((a, b) => compareRoadmapSprintIds(roadmap, a.id, b.id));
  return roadmap;
}

export function serializeRoadmapProjection(roadmap: RoadmapDefinition): string {
  return `${JSON.stringify(roadmap, null, 2)}\n`;
}

function sourceLabel(source: LoadedRoadmapSource): string {
  return normalizeDiagnosticPath(source.entry.path);
}

/** Validate source federation invariants before any compatibility write. */
export function validateRoadmapSourceFederation(
  project: RoadmapSourceProject,
  sources: LoadedRoadmapSource[],
): RoadmapSourceValidationResult {
  const errors: RoadmapSourceValidationIssue[] = [];
  const warnings: RoadmapSourceValidationIssue[] = [];
  let roadmap: RoadmapDefinition;
  try {
    roadmap = compileRoadmapSources(project, sources);
  } catch (error) {
    roadmap = { name: project.name, phases: [], sprints: [] };
    errors.push({ code: 'manifest_fidelity', message: (error as Error).message });
    return { valid: false, errors, warnings, roadmap };
  }

  const sourcePaths = new Map<string, number>();
  for (const source of sources) {
    const prior = sourcePaths.get(source.entry.path);
    if (prior != null) {
      errors.push({
        code: 'duplicate_source_path',
        source: sourceLabel(source),
        message: `Source path is listed more than once (entries ${prior + 1} and ${sourcePaths.size + 1}).`,
      });
    } else {
      sourcePaths.set(source.entry.path, sourcePaths.size);
    }
  }

  const phaseNames = new Map<string, string>();
  const sprintDefinitions = new Map<number, string>();
  const sprintMemberships = new Map<number, string[]>();
  const ticketDefinitions = new Map<string, string>();

  for (const source of sources) {
    const label = sourceLabel(source);
    const priorPhase = phaseNames.get(source.document.phase.name);
    if (priorPhase) {
      errors.push({
        code: 'duplicate_phase',
        source: label,
        message: `Phase "${source.document.phase.name}" is also defined in ${priorPhase}.`,
      });
    } else {
      phaseNames.set(source.document.phase.name, label);
    }

    const localMembership = source.document.phase.sprints;
    const localDefinitions = source.document.sprints.map(sprint => sprint.id);
    const membershipSet = new Set(localMembership);
    const definitionSet = new Set(localDefinitions);
    for (const id of localMembership) {
      const memberships = sprintMemberships.get(id) ?? [];
      memberships.push(label);
      sprintMemberships.set(id, memberships);
      if (!definitionSet.has(id)) {
        errors.push({
          code: 'missing_sprint_definition',
          source: label,
          sprint: id,
          message: `Phase membership S${id} has no sprint definition in the same bundle.`,
        });
      }
    }
    for (const id of localDefinitions) {
      if (!membershipSet.has(id)) {
        errors.push({
          code: 'orphan_sprint_definition',
          source: label,
          sprint: id,
          message: `Sprint S${id} is defined but missing from phase.sprints in the same bundle.`,
        });
      }
    }
    if (membershipSet.size !== localMembership.length) {
      errors.push({ code: 'duplicate_phase_membership', source: label, message: 'phase.sprints contains duplicate IDs.' });
    }
    if (definitionSet.size !== localDefinitions.length) {
      errors.push({ code: 'duplicate_local_sprint', source: label, message: 'Bundle contains duplicate sprint definitions.' });
    }

    for (const sprint of source.document.sprints) {
      const priorSprint = sprintDefinitions.get(sprint.id);
      if (priorSprint) {
        errors.push({
          code: 'duplicate_sprint',
          source: label,
          sprint: sprint.id,
          message: `Sprint S${sprint.id} is also defined in ${priorSprint}.`,
        });
      } else {
        sprintDefinitions.set(sprint.id, label);
      }
      for (const ticket of sprint.tickets) {
        const key = getRoadmapTicketKey(ticket);
        if (!key) continue;
        const priorTicket = ticketDefinitions.get(key);
        if (priorTicket) {
          errors.push({
            code: 'duplicate_ticket',
            source: label,
            sprint: sprint.id,
            ticket: key,
            message: `Ticket ${key} is also defined in ${priorTicket}.`,
          });
        } else {
          ticketDefinitions.set(key, label);
        }
      }
    }
  }

  for (const [sprint, memberships] of sprintMemberships) {
    if (memberships.length > 1) {
      errors.push({
        code: 'multiple_phase_membership',
        sprint,
        message: `Sprint S${sprint} belongs to multiple phase bundles: ${memberships.join(', ')}.`,
      });
    }
  }

  const normalizedSprintIds = new Map<number, { id: number; source?: string }>();
  for (const sprint of roadmap.sprints) {
    const normalized = roadmapSprintOrderValue(roadmap, sprint.id);
    const prior = normalizedSprintIds.get(normalized);
    if (prior && prior.id !== sprint.id) {
      errors.push({
        code: 'logical_sprint_collision',
        source: sprintDefinitions.get(sprint.id),
        sprint: sprint.id,
        message: `Sprint S${sprint.id} and Sprint S${prior.id} resolve to the same roadmap identity (${normalized}); first defined in ${prior.source ?? 'unknown source'}.`,
      });
    } else {
      normalizedSprintIds.set(normalized, { id: sprint.id, source: sprintDefinitions.get(sprint.id) });
    }
  }

  const roadmapValidation = validateRoadmap(roadmap);
  for (const issue of roadmapValidation.errors) {
    errors.push({
      code: 'roadmap_validation',
      message: issue.message,
      ...(issue.sprint != null ? { sprint: issue.sprint, source: sprintDefinitions.get(issue.sprint) } : {}),
      ...(issue.ticket ? { ticket: issue.ticket } : {}),
    });
  }
  for (const issue of roadmapValidation.warnings) {
    warnings.push({
      code: 'roadmap_validation',
      message: issue.message,
      ...(issue.sprint != null ? { sprint: issue.sprint, source: sprintDefinitions.get(issue.sprint) } : {}),
      ...(issue.ticket ? { ticket: issue.ticket } : {}),
    });
  }

  return { valid: errors.length === 0, errors, warnings, roadmap };
}
