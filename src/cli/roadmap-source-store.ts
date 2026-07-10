import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { stringify } from 'yaml';
import {
  compileRoadmapSources,
  normalizeDiagnosticPath,
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
  return resolvedPath;
}

export function resolveRoadmapSourceManifest(cwd: string, sourceFlag?: string): string {
  return resolve(cwd, sourceFlag || DEFAULT_ROADMAP_SOURCE_MANIFEST);
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
  const roadmap = compileRoadmapSources(project, sources);
  const projection = serializeRoadmapProjection(roadmap);
  return { cwd, manifestPath, sourceRoot, outputPath, project, sources, roadmap, projection };
}

export function writeRoadmapSourceProjection(store: RoadmapSourceStore): 'written' | 'unchanged' {
  return withFileLockSync(store.outputPath, () => {
    const existing = existsSync(store.outputPath) ? readFileSync(store.outputPath, 'utf8') : null;
    if (existing === store.projection) return 'unchanged';
    atomicWriteFileSync(store.outputPath, store.projection);
    return 'written';
  });
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
    } else if (readFileSync(store.outputPath, 'utf8') !== store.projection) {
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
  withFileLockSync(store.manifestPath, () => {
    for (const move of plan.moves) {
      mkdirSync(dirname(move.toAbsolute), { recursive: true });
      if (!existsSync(move.toAbsolute)) {
        atomicWriteFileSync(move.toAbsolute, readFileSync(move.fromAbsolute, 'utf8'));
      }
    }
    atomicWriteFileSync(store.manifestPath, plan.manifestYaml);
    for (const move of plan.moves) {
      if (existsSync(move.fromAbsolute) && move.fromAbsolute !== move.toAbsolute) unlinkSync(move.fromAbsolute);
    }
  });
}
