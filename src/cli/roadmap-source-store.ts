import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
