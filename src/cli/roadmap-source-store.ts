import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { stringify } from 'yaml';
import {
  compileRoadmapSources,
  formatRoadmapSprintLabel,
  normalizeDiagnosticPath,
  normalizeRoadmapSourcePath,
  parseRoadmapSourceDocument,
  parseRoadmapSourceProject,
  parseSprintNumber,
  roadmapSprintOrderValue,
  RoadmapSourceError,
  serializeRoadmapProjection,
  validateRoadmapSourceFederation,
  type LoadedRoadmapSource,
  type RoadmapDefinition,
  type RoadmapSourceProject,
  type RoadmapSourceValidationResult,
} from '../core/index.js';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';
import { loadConfig } from './config.js';
import { patchRoadmapSourceSprintText } from '../core/roadmap-source-patch.js';

/** Deterministic JSON with sorted keys, for order-insensitive semantic comparison. */
function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

export const DEFAULT_ROADMAP_SOURCE_MANIFEST = 'docs/roadmap/project.yaml';

export interface RoadmapSourceStore {
  cwd: string;
  manifestPath: string;
  sourceRoot: string;
  outputPath: string;
  project: RoadmapSourceProject;
  sources: LoadedRoadmapSource[];
  roadmap: RoadmapDefinition;
  projection: string;
}

function ensureWithin(root: string, path: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new RoadmapSourceError(`${label} escapes ${normalizeDiagnosticPath(resolvedRoot)}: ${normalizeDiagnosticPath(resolvedPath)}`);
  }
  const realRoot = realpathSync(resolvedRoot);
  let existing = resolvedPath;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const realExisting = realpathSync(existing);
  const realRel = relative(realRoot, realExisting);
  if (realRel === '..'
    || realRel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(realRel)) {
    throw new RoadmapSourceError(`${label} resolves outside ${normalizeDiagnosticPath(realRoot)}: ${normalizeDiagnosticPath(realExisting)}`);
  }
  return resolvedPath;
}

export function resolveRoadmapSourceManifest(cwd: string, sourceFlag?: string): string {
  return ensureWithin(cwd, resolve(cwd, sourceFlag || DEFAULT_ROADMAP_SOURCE_MANIFEST), 'manifest path');
}

export function hasModularRoadmapSources(cwd: string, sourceFlag?: string): boolean {
  return existsSync(resolveRoadmapSourceManifest(cwd, sourceFlag));
}

export function loadRoadmapSourceStore(cwd: string, sourceFlag?: string): RoadmapSourceStore {
  const manifestPath = resolveRoadmapSourceManifest(cwd, sourceFlag);
  if (!existsSync(manifestPath)) {
    throw new RoadmapSourceError(
      `modular roadmap manifest not found at ${normalizeDiagnosticPath(relative(cwd, manifestPath))}; single-file projects should use slope roadmap validate`,
    );
  }
  const sourceRoot = dirname(manifestPath);
  const project = parseRoadmapSourceProject(readFileSync(manifestPath, 'utf8'), manifestPath);
  const sources: LoadedRoadmapSource[] = project.sources.map(entry => {
    const absolutePath = ensureWithin(sourceRoot, join(sourceRoot, ...entry.path.split('/')), 'source path');
    if (!existsSync(absolutePath)) {
      throw new RoadmapSourceError('source file does not exist', absolutePath);
    }
    return {
      entry,
      document: parseRoadmapSourceDocument(readFileSync(absolutePath, 'utf8'), absolutePath),
      absolutePath,
    };
  });
  const outputPath = ensureWithin(cwd, resolve(sourceRoot, ...project.output.split('/')), 'output path');
  const configuredOutput = resolve(cwd, loadConfig(cwd).roadmapPath);
  if (outputPath !== configuredOutput) {
    throw new RoadmapSourceError(
      `manifest output must match configured roadmapPath ${normalizeDiagnosticPath(relative(cwd, configuredOutput))}`,
      manifestPath,
    );
  }
  if (outputPath === manifestPath || sources.some(source => source.absolutePath === outputPath)) {
    throw new RoadmapSourceError('compiled output overlaps an authored roadmap source', manifestPath);
  }
  const roadmap = compileRoadmapSources(project, sources);
  const projection = serializeRoadmapProjection(roadmap);
  return { cwd, manifestPath, sourceRoot, outputPath, project, sources, roadmap, projection };
}

export function writeRoadmapSourceProjection(store: RoadmapSourceStore): 'written' | 'unchanged' {
  const federationLock = join(store.sourceRoot, '.federation');
  return withFileLockSync(federationLock, () => {
    const fresh = loadRoadmapSourceStore(store.cwd, relative(store.cwd, store.manifestPath));
    const validation = validateRoadmapSourceStore(fresh, { checkProjection: false });
    if (!validation.valid) {
      throw new RoadmapSourceError([
        'Modular roadmap sources changed before compile write:',
        ...validation.errors.map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
      ].join('\n'));
    }
    const existing = existsSync(fresh.outputPath) ? readFileSync(fresh.outputPath, 'utf8') : null;
    if (existing != null && roadmapProjectionMatches(existing, fresh.projection)) return 'unchanged';
    atomicWriteFileSync(fresh.outputPath, fresh.projection);
    return 'written';
  });
}

export interface CompleteRoadmapSourceSprintResult {
  source: string;
  projection: 'written' | 'unchanged';
  changed: boolean;
  /** True when the source could not be patched surgically and was rewritten in canonical style. */
  reformatted?: boolean;
}

interface RoadmapSourceSprintMatch {
  source: LoadedRoadmapSource;
  /** The sprint id exactly as stored in the owning source (may be a legacy encoded id). */
  storedId: number;
  status?: string;
}

/**
 * Normalize a scorecard reference the same way the source parser will, so the
 * post-patch invariant compares like with like (e.g. `./docs/x.json` becomes
 * `docs/x.json` on reparse). Paths the parser would reject keep their
 * diagnostic form; post-write federation validation reports them.
 */
function normalizeScorecardRef(path: string): string {
  const diagnostic = normalizeDiagnosticPath(path);
  try {
    return normalizeRoadmapSourcePath(diagnostic, 'scorecard path');
  } catch {
    return diagnostic;
  }
}

/**
 * Resolve a sprint number to the single source entry that owns it, comparing
 * by canonical sprint label so legacy encoded ids (235 ~ S23.5) still match
 * while decimal neighbours (458.1 vs 458.2) never do. Label comparison is
 * string-exact, so float representation drift cannot widen the match. (#618)
 */
function findRoadmapSourceSprint(store: RoadmapSourceStore, sprint: number): RoadmapSourceSprintMatch {
  const targetLabel = formatRoadmapSprintLabel(store.roadmap, sprint);
  const matches: RoadmapSourceSprintMatch[] = [];
  for (const source of store.sources) {
    for (const item of source.document.sprints) {
      if (formatRoadmapSprintLabel(store.roadmap, item.id) === targetLabel) {
        matches.push({ source, storedId: item.id, status: item.status });
      }
    }
  }
  if (matches.length === 0) {
    throw new RoadmapSourceError(`Sprint ${targetLabel} was not found in modular roadmap sources.`, store.manifestPath);
  }
  if (matches.length > 1) {
    const locations = matches.map(match => `${match.source.entry.path} (id: ${match.storedId})`).join(', ');
    throw new RoadmapSourceError(
      `Sprint ${targetLabel} resolves to ${matches.length} roadmap source entries (${locations}); refusing to reconcile an ambiguous identity.`,
      store.manifestPath,
    );
  }
  return matches[0];
}

export function completeRoadmapSourceSprint(
  cwd: string,
  sprint: number,
  options: { sourceFlag?: string; scorecardPath?: string; dryRun?: boolean } = {},
): CompleteRoadmapSourceSprintResult {
  const initial = loadRoadmapSourceStore(cwd, options.sourceFlag);
  const initialMatch = findRoadmapSourceSprint(initial, sprint);
  const owner = initialMatch.source;
  const sourceLabel = normalizeDiagnosticPath(relative(cwd, owner.absolutePath ?? owner.entry.path));
  const changed = initialMatch.status !== 'complete'
    || Boolean(options.scorecardPath
      && owner.document.scorecards?.[String(initialMatch.storedId)] !== normalizeScorecardRef(options.scorecardPath));

  if (options.dryRun) {
    return { source: sourceLabel, projection: 'unchanged', changed };
  }

  const federationLock = join(initial.sourceRoot, '.federation');
  return withFileLockSync(federationLock, () => {
    const fresh = loadRoadmapSourceStore(cwd, options.sourceFlag);
    const freshMatch = findRoadmapSourceSprint(fresh, sprint);
    const freshOwner = freshMatch.source;
    if (!freshOwner.absolutePath) {
      throw new RoadmapSourceError(`Sprint S${sprint} was not found in modular roadmap sources.`, fresh.manifestPath);
    }

    const storedId = freshMatch.storedId;
    const scorecardKey = String(storedId);
    const normalizedScorecard = options.scorecardPath ? normalizeScorecardRef(options.scorecardPath) : undefined;
    const originalText = readFileSync(freshOwner.absolutePath, 'utf8');
    const patchedText = patchRoadmapSourceSprintText(originalText, storedId, {
      status: 'complete',
      ...(normalizedScorecard ? { scorecardKey, scorecardPath: normalizedScorecard } : {}),
    });
    const expectedDocument = {
      version: freshOwner.document.version,
      phase: freshOwner.document.phase,
      sprints: freshOwner.document.sprints.map(item =>
        item.id === storedId ? { ...item, status: 'complete' } : item,
      ),
      ...(freshOwner.document.scorecards || normalizedScorecard ? {
        scorecards: {
          ...(freshOwner.document.scorecards ?? {}),
          ...(normalizedScorecard ? { [scorecardKey]: normalizedScorecard } : {}),
        },
      } : {}),
    };
    let reformatted = false;
    let nextText: string | null = null;
    if (patchedText != null) {
      // Refuse a surgical patch that changed anything beyond the targeted
      // sprint's status and scorecard link — the invariant that makes an
      // adjacent-sprint mutation (#618) structurally impossible. A patched
      // text that no longer parses means the document shape defeated the
      // patcher (e.g. column-0 comments inside an entry); treat that like an
      // undetectable shape and fall back rather than surfacing a raw parse
      // error.
      let reparsed: unknown = null;
      try {
        reparsed = parseRoadmapSourceDocument(patchedText, freshOwner.absolutePath);
      } catch {
        reparsed = null;
      }
      if (reparsed != null) {
        if (stableJson(reparsed) !== stableJson(expectedDocument)) {
          throw new RoadmapSourceError(
            `Reconciling Sprint ${formatRoadmapSprintLabel(fresh.roadmap, sprint)} would change more than the targeted sprint entry; refusing to write.`,
            freshOwner.absolutePath,
          );
        }
        nextText = patchedText;
      }
    }
    if (nextText == null) {
      // The document shape prevents a confidently surgical edit (flow-style
      // entries, mixed EOLs). Fall back to the legacy full rewrite, which
      // reformats the bundle; post-write federation validation still runs.
      reformatted = true;
      nextText = stringify(expectedDocument);
    }
    atomicWriteFileSync(freshOwner.absolutePath, nextText);
    const reloaded = loadRoadmapSourceStore(cwd, options.sourceFlag);
    const validation = validateRoadmapSourceStore(reloaded, { checkProjection: false });
    if (!validation.valid) {
      throw new RoadmapSourceError([
        'Modular roadmap sources became invalid after sprint completion update:',
        ...validation.errors.map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
      ].join('\n'), freshOwner.absolutePath);
    }
    const existing = existsSync(reloaded.outputPath) ? readFileSync(reloaded.outputPath, 'utf8') : null;
    const projection = existing != null && roadmapProjectionMatches(existing, reloaded.projection)
      ? 'unchanged'
      : 'written';
    if (projection === 'written') atomicWriteFileSync(reloaded.outputPath, reloaded.projection);
    return { source: sourceLabel, projection, changed: true, reformatted };
  });
}

/**
 * Compare a checked-out generated projection with canonical generated bytes.
 * Git may materialize tracked LF files as CRLF on Windows; normalize only that
 * checkout representation so every other formatting or semantic difference
 * remains observable drift.
 */
export function roadmapProjectionMatches(actual: string, expected: string): boolean {
  return actual.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n');
}

export interface RoadmapSourceStoreValidationOptions {
  checkProjection?: boolean;
  checkArchiveEvidence?: boolean;
}

export function validateRoadmapSourceStore(
  store: RoadmapSourceStore,
  options: RoadmapSourceStoreValidationOptions = {},
): RoadmapSourceValidationResult {
  const result = validateRoadmapSourceFederation(store.project, store.sources);
  const checkProjection = options.checkProjection ?? true;
  const checkArchiveEvidence = options.checkArchiveEvidence ?? true;

  if (checkProjection) {
    if (!existsSync(store.outputPath)) {
      result.errors.push({
        code: 'projection_missing',
        message: `Compiled projection is missing: ${normalizeDiagnosticPath(relative(store.cwd, store.outputPath))}. Run slope roadmap compile.`,
      });
    } else if (!roadmapProjectionMatches(readFileSync(store.outputPath, 'utf8'), store.projection)) {
      result.errors.push({
        code: 'projection_drift',
        message: `Compiled projection has drifted: ${normalizeDiagnosticPath(relative(store.cwd, store.outputPath))}. Run slope roadmap compile.`,
      });
    }
  }

  if (checkArchiveEvidence) {
    for (const source of store.sources.filter(candidate => candidate.entry.kind === 'archive')) {
      for (const sprint of source.document.sprints.filter(candidate => candidate.status === 'complete')) {
        const scorecardRef = source.document.scorecards?.[String(sprint.id)];
        if (!scorecardRef) {
          result.errors.push({
            code: 'archive_scorecard_missing',
            source: source.entry.path,
            sprint: sprint.id,
            message: `Archived complete Sprint S${sprint.id} has no scorecard link.`,
          });
          continue;
        }
        let scorecardPath: string;
        try {
          scorecardPath = ensureWithin(
            store.cwd,
            resolve(store.cwd, ...scorecardRef.split('/')),
            `scorecard path for S${sprint.id}`,
          );
        } catch (error) {
          result.errors.push({
            code: 'archive_scorecard_unsafe',
            source: source.entry.path,
            sprint: sprint.id,
            message: (error as Error).message,
          });
          continue;
        }
        if (!existsSync(scorecardPath)) {
          result.errors.push({
            code: 'archive_scorecard_not_found',
            source: source.entry.path,
            sprint: sprint.id,
            message: `Archived scorecard does not exist: ${normalizeDiagnosticPath(scorecardRef)}.`,
          });
          continue;
        }
        try {
          const raw = JSON.parse(readFileSync(scorecardPath, 'utf8')) as { sprint_number?: unknown };
          const scorecardSprint = parseSprintNumber(raw.sprint_number as string | number);
          const expected = roadmapSprintOrderValue(store.roadmap, sprint.id);
          const actual = scorecardSprint == null
            ? null
            : roadmapSprintOrderValue(store.roadmap, scorecardSprint);
          if (actual !== expected) {
            result.errors.push({
              code: 'archive_scorecard_mismatch',
              source: source.entry.path,
              sprint: sprint.id,
              message: `Scorecard ${normalizeDiagnosticPath(scorecardRef)} records ${String(raw.sprint_number)} instead of Sprint S${sprint.id}.`,
            });
          }
        } catch (error) {
          result.errors.push({
            code: 'archive_scorecard_invalid',
            source: source.entry.path,
            sprint: sprint.id,
            message: `Could not parse ${normalizeDiagnosticPath(scorecardRef)}: ${(error as Error).message}`,
          });
        }
      }
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

const ARCHIVABLE_STATUSES = new Set([
  'complete',
  'superseded',
  'skipped',
  'cancelled',
  'cancelled-absorbed',
  'absorbed',
]);

export interface RoadmapSourceArchiveMove {
  sourceId: string;
  from: string;
  to: string;
  fromAbsolute: string;
  toAbsolute: string;
}

export interface RoadmapSourceArchivePlan {
  through: number;
  moves: RoadmapSourceArchiveMove[];
  project: RoadmapSourceProject;
  manifestYaml: string;
}

function assertIndependentArchiveDestination(fromAbsolute: string, toAbsolute: string, label: string): void {
  const linkStat = lstatSync(toAbsolute);
  if (linkStat.isSymbolicLink()) {
    throw new RoadmapSourceError(`archive destination must be an independent regular file, not a symlink: ${label}`);
  }
  const sourceStat = statSync(fromAbsolute);
  const destinationStat = statSync(toAbsolute);
  const sameInode = sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino;
  const sameRealPath = realpathSync(fromAbsolute) === realpathSync(toAbsolute);
  if (!destinationStat.isFile() || sameInode || sameRealPath) {
    throw new RoadmapSourceError(`archive destination aliases the live source instead of preserving a copy: ${label}`);
  }
}

export function planRoadmapSourceArchive(
  store: RoadmapSourceStore,
  through: number,
): RoadmapSourceArchivePlan {
  const throughOrder = roadmapSprintOrderValue(store.roadmap, through);
  const moves: RoadmapSourceArchiveMove[] = [];
  const nextEntries = store.project.sources.map(entry => ({ ...entry }));

  for (const [index, source] of store.sources.entries()) {
    if (source.entry.kind !== 'phase') continue;
    const sprintOrders = source.document.phase.sprints.map(id => roadmapSprintOrderValue(store.roadmap, id));
    const includesAtOrBefore = sprintOrders.some(order => order <= throughOrder);
    const includesAfter = sprintOrders.some(order => order > throughOrder);
    if (includesAtOrBefore && includesAfter) {
      throw new RoadmapSourceError(
        `--through would split phase "${source.document.phase.name}"; archive whole phases only`,
        source.entry.path,
      );
    }
    if (!includesAtOrBefore || includesAfter) continue;

    const phaseStatus = source.document.phase.status ?? '';
    const incomplete = source.document.sprints.filter(sprint => !ARCHIVABLE_STATUSES.has(sprint.status ?? ''));
    if (!ARCHIVABLE_STATUSES.has(phaseStatus) || incomplete.length > 0) {
      throw new RoadmapSourceError(
        `phase "${source.document.phase.name}" is not fully terminal through Sprint ${through}`,
        source.entry.path,
      );
    }

    const to = `archive/${basename(source.entry.path)}`;
    const toAbsolute = ensureWithin(store.sourceRoot, join(store.sourceRoot, 'archive', basename(source.entry.path)), 'archive path');
    if (existsSync(toAbsolute) && source.absolutePath !== toAbsolute) {
      assertIndependentArchiveDestination(source.absolutePath!, toAbsolute, to);
      const sourceBytes = readFileSync(source.absolutePath!, 'utf8');
      const destinationBytes = readFileSync(toAbsolute, 'utf8');
      if (sourceBytes !== destinationBytes) {
        throw new RoadmapSourceError(`archive destination already exists with different content: ${to}`);
      }
    }
    nextEntries[index] = { path: to, kind: 'archive' };
    moves.push({
      sourceId: source.document.phase.name,
      from: source.entry.path,
      to,
      fromAbsolute: source.absolutePath!,
      toAbsolute,
    });
  }

  const project: RoadmapSourceProject = { ...store.project, sources: nextEntries };
  const plannedSources = store.sources.map((source, index) => ({
    ...source,
    entry: nextEntries[index],
    absolutePath: moves.find(move => move.from === source.entry.path)?.toAbsolute ?? source.absolutePath,
  }));
  const plannedRoadmap = compileRoadmapSources(project, plannedSources);
  if (serializeRoadmapProjection(plannedRoadmap) !== store.projection) {
    throw new RoadmapSourceError('archive plan would change the compiled compatibility projection');
  }
  const simulated: RoadmapSourceStore = {
    ...store,
    project,
    sources: plannedSources,
    roadmap: plannedRoadmap,
    projection: store.projection,
  };
  const validation = validateRoadmapSourceStore(simulated, { checkProjection: true, checkArchiveEvidence: true });
  if (!validation.valid) {
    throw new RoadmapSourceError([
      'archive plan is invalid:',
      ...validation.errors.map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
    ].join('\n'));
  }

  return {
    through,
    moves,
    project,
    manifestYaml: stringify(project, { lineWidth: 0 }),
  };
}

export function applyRoadmapSourceArchive(
  store: RoadmapSourceStore,
  plan: RoadmapSourceArchivePlan,
): void {
  if (plan.moves.length === 0) return;
  const federationLock = join(store.sourceRoot, '.federation');
  withFileLockSync(federationLock, () => {
    const fresh = loadRoadmapSourceStore(store.cwd, relative(store.cwd, store.manifestPath));
    const freshPlan = planRoadmapSourceArchive(fresh, plan.through);
    const captured = new Map<string, string>();
    for (const move of freshPlan.moves) {
      const sourceBytes = readFileSync(move.fromAbsolute, 'utf8');
      captured.set(move.fromAbsolute, sourceBytes);
      mkdirSync(dirname(move.toAbsolute), { recursive: true });
      ensureWithin(fresh.sourceRoot, move.toAbsolute, 'archive destination');
      if (existsSync(move.toAbsolute)) {
        assertIndependentArchiveDestination(move.fromAbsolute, move.toAbsolute, move.to);
        if (readFileSync(move.toAbsolute, 'utf8') !== sourceBytes) {
          throw new RoadmapSourceError(`archive destination changed before commit: ${move.to}`);
        }
      } else {
        atomicWriteFileSync(move.toAbsolute, sourceBytes);
      }
    }
    for (const move of freshPlan.moves) {
      assertIndependentArchiveDestination(move.fromAbsolute, move.toAbsolute, move.to);
      if (readFileSync(move.fromAbsolute, 'utf8') !== captured.get(move.fromAbsolute)) {
        throw new RoadmapSourceError(`source changed during archive planning: ${move.from}`);
      }
      if (readFileSync(move.toAbsolute, 'utf8') !== captured.get(move.fromAbsolute)) {
        throw new RoadmapSourceError(`archive copy verification failed: ${move.to}`);
      }
    }
    atomicWriteFileSync(fresh.manifestPath, freshPlan.manifestYaml);
    for (const move of freshPlan.moves) {
      if (existsSync(move.fromAbsolute)
        && move.fromAbsolute !== move.toAbsolute
        && readFileSync(move.fromAbsolute, 'utf8') === captured.get(move.fromAbsolute)) {
        unlinkSync(move.fromAbsolute);
      }
    }
  });
}
