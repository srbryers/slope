import { isAbsolute, posix } from 'node:path';
import { parseDocument } from 'yaml';
import { castRoadmapStructure, getRoadmapTicketKey, validateRoadmap } from './roadmap.js';
import { compareRoadmapSprintIds, describeSprintIdAmbiguity, roadmapSprintKey, roadmapSprintOrderValue } from './roadmap.js';
import { sprintIdKey } from './sprint-id.js';
import type { RoadmapDefinition, RoadmapPhase, RoadmapSprint } from './roadmap.js';
import type { SprintId } from './sprint-id.js';

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
  sprint?: SprintId;
  ticket?: string;
}

export interface RoadmapSourceValidationResult {
  valid: boolean;
  errors: RoadmapSourceValidationIssue[];
  warnings: RoadmapSourceValidationIssue[];
  roadmap: RoadmapDefinition;
}

export class RoadmapSourceError extends Error {
  /**
   * True when the failure is a refusal to discard authored content that exists
   * only in the generated projection. Callers must treat this as fatal rather
   * than downgrading it to a warning — reporting success while planning work is
   * destroyed is the whole defect (GH #637).
   */
  projectionContentLoss?: boolean;

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

/**
 * Reject sprint ids written with a trailing zero in the fraction before YAML
 * parsing collapses them.
 *
 * `458.10` parses to the number 458.1, so by the time any validator sees the
 * document the id has already silently become an existing sprint — the text is the
 * only place the ambiguity is still visible (GH #635).
 *
 * Scans only the two positions a sprint id is written: a `- <number>` item under
 * `phase.sprints`, and an `id: <number>` key on a sprint mapping. Other decimals in
 * the file (par, slope, version) are left alone.
 */
function assertNoAmbiguousWrittenSprintIds(yaml: string, sourcePath: string): void {
  const lines = yaml.split(/\r?\n/);
  let inPhaseSprints = false;

  for (const [index, line] of lines.entries()) {
    if (/^\s*sprints:\s*$/.test(line)) {
      // `phase.sprints` is indented; the top-level `sprints:` list is not.
      inPhaseSprints = /^\s+sprints:\s*$/.test(line);
      continue;
    }

    const idMatch = line.match(/^\s*-?\s*id:\s*([0-9]+\.[0-9]+)\s*(?:#.*)?$/);
    const itemMatch = inPhaseSprints
      ? line.match(/^\s*-\s*([0-9]+\.[0-9]+)\s*(?:#.*)?$/)
      : null;
    const written = idMatch?.[1] ?? itemMatch?.[1];
    if (!written) {
      // Any non-list, non-blank line ends the phase.sprints block.
      if (inPhaseSprints && line.trim() && !/^\s*-/.test(line)) inPhaseSprints = false;
      continue;
    }

    const problem = describeSprintIdAmbiguity(written);
    if (problem) {
      throw new RoadmapSourceError(`line ${index + 1}: ${problem}`, sourcePath);
    }
  }
}

export function parseRoadmapSourceDocument(
  yaml: string,
  sourcePath: string,
): RoadmapSourceDocument {
  assertNoAmbiguousWrittenSprintIds(yaml, sourcePath);
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
  // Accept string-authored membership ids (e.g. "458.10") alongside numbers.
  // Record the canonical keys and coerce the numeric mirror (GH #635).
  if (!Array.isArray(phase.sprints)) {
    throw new RoadmapSourceError('phase.sprints must be a sequence of sprint IDs', sourcePath);
  }
  const memberKeys: string[] = [];
  let anyStringMember = false;
  for (const [i, member] of phase.sprints.entries()) {
    if (typeof member === 'string') anyStringMember = true;
    const key = typeof member === 'number' || typeof member === 'string' ? sprintIdKey(member) : null;
    if (key === null) {
      throw new RoadmapSourceError(`phase.sprints[${i}] is not a valid sprint id`, sourcePath);
    }
    memberKeys.push(key);
    phase.sprints[i] = Number(key);
  }
  if (anyStringMember) phase.sprint_keys = memberKeys;
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
    // Accept a string-authored id to preserve an exact suffix a number cannot
    // hold (e.g. "458.10"). Record the canonical id_key and coerce id to its
    // numeric mirror for ordering and the store (GH #635).
    if (typeof sprint.id === 'string') {
      const key = sprintIdKey(sprint.id);
      if (key === null) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].id is not a valid sprint id: ${sprint.id}`, sourcePath);
      }
      sprint.id_key = key;
      sprint.id = Number(key);
    } else if (typeof sprint.id !== 'number' || !Number.isFinite(sprint.id) || sprint.id <= 0) {
      throw new RoadmapSourceError(`sprints[${sprintIndex}].id must be a positive number or a quoted sprint id`, sourcePath);
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
    // Dependencies retain their canonical key so coexisting 458.1 and 458.10
    // remain distinct throughout source validation and the compiled projection.
    if (sprint.depends_on != null) {
      if (!Array.isArray(sprint.depends_on)) {
        throw new RoadmapSourceError(`sprints[${sprintIndex}].depends_on must be a sequence of sprint IDs`, sourcePath);
      }
      for (const [i, dep] of sprint.depends_on.entries()) {
        const key = typeof dep === 'number' || typeof dep === 'string' ? sprintIdKey(dep) : null;
        if (key === null) {
          throw new RoadmapSourceError(`sprints[${sprintIndex}].depends_on[${i}] is not a valid sprint id`, sourcePath);
        }
        sprint.depends_on[i] = key;
      }
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
    // The strict checks above accept `id` as a legacy ticket-key alias. Keep
    // the authored record intact here: `castRoadmapStructure` normalizes that
    // alias by materializing `key`, which would introduce compatibility
    // projection drift during a storage-only migration.
    sprints: raw.sprints as RoadmapSprint[],
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
      ...(Array.isArray(ticket.github_issue) ? { github_issue: [...ticket.github_issue] } : {}),
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

/**
 * Key of the generated-file marker written into the compiled projection.
 *
 * The marker exists only in the bytes on disk. `serializeRoadmapProjection`
 * stays canonical and marker-free, because projection bytes are compared in four
 * places — compile write, closeout reconciliation, archive planning, and the
 * migration planner/applier `expected_projection_sha256` pair. Stamping the
 * marker into those canonical bytes broke migration receipt binding (seven
 * tests), so it is applied at the write boundary and stripped again on read
 * (GH #644, deferred from #637).
 */
export const ROADMAP_PROJECTION_MARKER_KEY = '_generated';

/** Add the generated-file marker to projection bytes about to be written. */
export function withRoadmapProjectionMarker(projection: string, sourcePath: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(projection);
  } catch {
    return projection;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return projection;

  const marked = {
    [ROADMAP_PROJECTION_MARKER_KEY]: {
      by: 'slope roadmap compile',
      source: sourcePath,
      warning: `GENERATED FILE — do not edit. Edit the modular sources under docs/roadmap/ and re-run \`slope roadmap compile\`. Edits here are refused or discarded.`,
    },
    ...(parsed as Record<string, unknown>),
  };
  return `${JSON.stringify(marked, null, 2)}\n`;
}

/**
 * Remove the generated-file marker so on-disk bytes can be compared against
 * canonical projection bytes. Returns the input unchanged when no marker exists,
 * so projections written before this change still compare correctly.
 */
export function stripRoadmapProjectionMarker(projection: string): string {
  if (!projection.includes(`"${ROADMAP_PROJECTION_MARKER_KEY}"`)) return projection;

  let parsed: unknown;
  try {
    parsed = JSON.parse(projection);
  } catch {
    return projection;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return projection;

  const rest = { ...(parsed as Record<string, unknown>) };
  if (!(ROADMAP_PROJECTION_MARKER_KEY in rest)) return projection;
  delete rest[ROADMAP_PROJECTION_MARKER_KEY];
  return `${JSON.stringify(rest, null, 2)}\n`;
}

export interface RoadmapProjectionDivergence {
  /** Sprint ids present in the on-disk projection but produced by no source. */
  sprints: string[];
  /** Phase names present in the on-disk projection but produced by no source. */
  phases: string[];
}

/**
 * Find content that exists only in the checked-out projection.
 *
 * A projection that merely lags its sources contains nothing the sources do not
 * produce, so it is safe to overwrite. Content present *only* on disk is
 * authored planning work that a blind rewrite would destroy — which is exactly
 * how a phase, six sprints and 26 tickets were lost on a success exit (GH #637).
 *
 * Returns null when nothing would be lost.
 */
export function findRoadmapProjectionDivergence(
  existing: string,
  compiled: RoadmapDefinition,
): RoadmapProjectionDivergence | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    // Unparseable projections carry no recoverable authored content.
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const disk = parsed as { phases?: unknown; sprints?: unknown };

  const compiledSprints = new Set(
    (compiled.sprints ?? []).map(sprint => roadmapSprintKey(compiled, sprint)),
  );
  const diskSprints = Array.isArray(disk.sprints) ? disk.sprints : [];
  const sprints = diskSprints
    .map(sprint => {
      if (!sprint || typeof sprint !== 'object') return null;
      const row = sprint as { id?: unknown; id_key?: unknown };
      if (typeof row.id_key === 'string') return sprintIdKey(row.id_key);
      return typeof row.id === 'string' || typeof row.id === 'number'
        ? sprintIdKey(row.id)
        : null;
    })
    .filter((id): id is string => id !== null)
    .filter(id => !compiledSprints.has(id));

  const compiledPhases = new Set((compiled.phases ?? []).map(phase => phase.name));
  const diskPhases = Array.isArray(disk.phases) ? disk.phases : [];
  const phases = diskPhases
    .filter((phase): phase is { name?: unknown; sprints?: unknown } =>
      !!phase && typeof phase === 'object')
    .filter(phase => typeof phase.name === 'string' && !compiledPhases.has(phase.name))
    // A phase whose sprints all still compile was renamed or reorganised, not
    // lost. Reporting it as content loss made every phase rename look destructive
    // and blocked the compile — the original #637 case lost the phase *and* its
    // six sprints, so requiring an orphaned sprint keeps that caught.
    .filter(phase => {
      const ids = Array.isArray(phase.sprints) ? phase.sprints : [];
      if (ids.length === 0) return true;
      return ids.some(id => {
        if (id == null || (typeof id !== 'string' && typeof id !== 'number')) return false;
        const key = sprintIdKey(id);
        return key !== null && !compiledSprints.has(key);
      });
    })
    .map(phase => phase.name as string);

  if (sprints.length === 0 && phases.length === 0) return null;
  return { sprints: [...new Set(sprints)], phases: [...new Set(phases)] };
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
  const sprintDefinitions = new Map<string, string>();
  const sprintMemberships = new Map<string, string[]>();
  const ticketDefinitions = new Map<string, string>();

  // Identity is the canonical key so 458.10 and 458.1 stay distinct through the
  // uniqueness and membership checks (GH #635). No roadmap-aware legacy decode is
  // needed here — within a source, id_key is set for string-authored ids and a
  // numeric id is its own consistent key.
  const defKey = (sprint: RoadmapSprint): string => sprint.id_key ?? String(sprint.id);
  const membershipKeys = (phase: RoadmapPhase): string[] => phase.sprint_keys ?? phase.sprints.map(String);

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

    const localMembership = membershipKeys(source.document.phase);
    const localDefinitions = source.document.sprints.map(defKey);
    const membershipSet = new Set(localMembership);
    const definitionSet = new Set(localDefinitions);
    for (const key of localMembership) {
      const memberships = sprintMemberships.get(key) ?? [];
      memberships.push(label);
      sprintMemberships.set(key, memberships);
      if (!definitionSet.has(key)) {
        errors.push({
          code: 'missing_sprint_definition',
          source: label,
          sprint: Number(key),
          message: `Phase membership S${key} has no sprint definition in the same bundle.`,
        });
      }
    }
    for (const key of localDefinitions) {
      if (!membershipSet.has(key)) {
        errors.push({
          code: 'orphan_sprint_definition',
          source: label,
          sprint: Number(key),
          message: `Sprint S${key} is defined but missing from phase.sprints in the same bundle.`,
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
      const key = defKey(sprint);
      const priorSprint = sprintDefinitions.get(key);
      if (priorSprint) {
        errors.push({
          code: 'duplicate_sprint',
          source: label,
          sprint: sprint.id,
          message: `Sprint S${key} is also defined in ${priorSprint}.`,
        });
      } else {
        sprintDefinitions.set(key, label);
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

  for (const [key, memberships] of sprintMemberships) {
    if (memberships.length > 1) {
      errors.push({
        code: 'multiple_phase_membership',
        sprint: Number(key),
        message: `Sprint S${key} belongs to multiple phase bundles: ${memberships.join(', ')}.`,
      });
    }
  }

  // Collision is by canonical identity, not the float order value: 458.1 and
  // 458.10 are legitimately distinct (their id_keys differ), while a legacy 435
  // and an explicit 43.5 still resolve to the same key "43.5" and collide (GH #635).
  const canonicalIds = new Map<string, { key: string; source?: string }>();
  for (const sprint of roadmap.sprints) {
    const key = roadmapSprintKey(roadmap, sprint);
    const prior = canonicalIds.get(key);
    if (prior) {
      errors.push({
        code: 'logical_sprint_collision',
        source: sprintDefinitions.get(defKey(sprint)),
        sprint: sprint.id,
        message: `Sprint S${key} and Sprint S${prior.key} resolve to the same roadmap identity (${key}); first defined in ${prior.source ?? 'unknown source'}.`,
      });
    } else {
      canonicalIds.set(key, { key, source: sprintDefinitions.get(defKey(sprint)) });
    }
  }

  const roadmapValidation = validateRoadmap(roadmap);
  for (const issue of roadmapValidation.errors) {
    errors.push({
      code: 'roadmap_validation',
      message: issue.message,
      ...(issue.sprint != null ? { sprint: issue.sprint, source: sprintDefinitions.get(String(issue.sprint)) } : {}),
      ...(issue.ticket ? { ticket: issue.ticket } : {}),
    });
  }
  for (const issue of roadmapValidation.warnings) {
    warnings.push({
      code: 'roadmap_validation',
      message: issue.message,
      ...(issue.sprint != null ? { sprint: issue.sprint, source: sprintDefinitions.get(String(issue.sprint)) } : {}),
      ...(issue.ticket ? { ticket: issue.ticket } : {}),
    });
  }

  return { valid: errors.length === 0, errors, warnings, roadmap };
}
