import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import {
  compileRoadmapSources,
  compareRoadmapSprintIds,
  formatRoadmapSprintLabel,
  normalizeDiagnosticPath,
  normalizeRoadmapSourcePath,
  parseRoadmapSourceDocument,
  parseRoadmapSourceProject,
  roadmapSprintKey,
  roadmapSprintKeyFromId,
  RoadmapSourceError,
  serializeRoadmapProjection,
  findRoadmapProjectionDivergence,
  withRoadmapProjectionMarker,
  stripRoadmapProjectionMarker,
  validateRoadmapSourceFederation,
  type LoadedRoadmapSource,
  type RoadmapDefinition,
  type SprintId,
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

/** Mark a sprint complete by editing the parsed document rather than
 *  re-serialising a plain object.
 *
 *  The yaml package's Document keeps comments through an edit, so this is the
 *  fallback for shapes the surgical text patcher declines. Serialising a fresh
 *  object instead discards every comment in the bundle, which silently deleted
 *  an authored history note from a phase file (#706).
 *
 *  Returns null when the document is not the shape this can safely edit, so
 *  the caller keeps its existing behaviour rather than writing something
 *  unexpected.
 */
function rewriteSprintStatusPreservingComments(
  originalText: string,
  sprintIndex: number,
  scorecard: { scorecardKey?: string; scorecardPath?: string },
): string | null {
  if (sprintIndex < 0) return null;
  let doc;
  try {
    doc = parseDocument(originalText);
  } catch {
    return null;
  }
  if (doc.errors.length > 0) return null;
  // Only edit a sprint entry that is already a mapping; anything else means
  // the shape is not what this expects and the caller should fall back.
  if (doc.getIn(['sprints', sprintIndex]) == null) return null;

  doc.setIn(['sprints', sprintIndex, 'status'], 'complete');
  if (scorecard.scorecardKey && scorecard.scorecardPath) {
    doc.setIn(['scorecards', scorecard.scorecardKey], scorecard.scorecardPath);
  }
  return String(doc);
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

export interface WriteRoadmapProjectionOptions {
  /** Overwrite even when the on-disk projection holds content no source produces. */
  force?: boolean;
}

export function writeRoadmapSourceProjection(
  store: RoadmapSourceStore,
  options: WriteRoadmapProjectionOptions = {},
): 'written' | 'unchanged' {
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
    const desired = projectionBytesForWrite(fresh);
    // Compare the exact bytes we would write, not marker-stripped content. A file
    // whose content is current but whose marker is missing — one written by the
    // migration path, or before the marker existed — must still be rewritten so
    // it gains the warning (GH #644).
    if (existing != null && existing.replace(/\r\n/g, '\n') === desired.replace(/\r\n/g, '\n')) {
      return 'unchanged';
    }
    if (existing != null && !options.force) assertNoProjectionContentLoss(fresh, existing);
    atomicWriteFileSync(fresh.outputPath, desired);
    return 'written';
  });
}

/**
 * Refuse to silently discard authored content that exists only in the projection.
 *
 * `slope validate` regenerated the projection as a side effect and reported
 * success, so a phase, six sprints and 26 tickets edited into the generated file
 * vanished with no error, no warning and no diff — and it reproduced across
 * operators, because nothing in the file said it was generated (GH #637).
 */
export function assertNoProjectionContentLoss(store: RoadmapSourceStore, existing: string): void {
  const divergence = findRoadmapProjectionDivergence(existing, store.roadmap);
  if (!divergence) return;

  const target = normalizeDiagnosticPath(relative(store.cwd, store.outputPath));
  const manifest = normalizeDiagnosticPath(relative(store.cwd, store.manifestPath));
  const lines = [
    `Refusing to overwrite ${target}: it contains planning work that no roadmap source produces.`,
    `${target} is a GENERATED projection of ${manifest}. Rewriting it would discard:`,
  ];
  if (divergence.phases.length > 0) {
    lines.push(`  phases: ${divergence.phases.join(', ')}`);
  }
  if (divergence.sprints.length > 0) {
    lines.push(`  sprints: ${divergence.sprints.map(id => `S${id}`).join(', ')}`);
  }
  lines.push(
    '',
    'Move this work into the modular sources under docs/roadmap/, then re-run',
    '`slope roadmap compile`. To discard it deliberately, re-run with --force.',
  );
  const error = new RoadmapSourceError(lines.join('\n'));
  error.projectionContentLoss = true;
  throw error;
}

export interface CompleteRoadmapSourceSprintResult {
  source: string;
  projection: 'written' | 'unchanged';
  /** Repo-relative path of the compiled projection, so callers can name the
   *  tracked file they rewrote rather than only its status (#706). */
  projectionPath?: string;
  changed: boolean;
  /** True when the source could not be patched surgically and was rewritten in canonical style. */
  reformatted?: boolean;
  /**
   * Set when the sprint holds a scorecard but its authored status is a deliberate
   * non-complete disposition (absorbed, blocked, ...). Reconciliation refuses to
   * overwrite it — a scorecard records how a sprint was played, not whether it
   * completed (GH #660). The authored status is reported so the caller can surface
   * the mismatch; nothing is written.
   */
  skipped?: 'status_conflict';
  /** The authored status that blocked auto-promotion, when skipped. */
  authoredStatus?: string;
}

/**
 * Statuses from which a scorecard legitimately means "now complete" — the normal
 * closeout path (a planned/active sprint gets run and scored). Every other status
 * is a deliberate disposition (absorbed, blocked, deferred, superseded, cancelled,
 * skipped) that a scorecard must never override (GH #660).
 */
const PROMOTABLE_TO_COMPLETE = new Set(['', 'planned', 'active', 'in_progress', 'ready_for_pr']);

interface RoadmapSourceSprintMatch {
  source: LoadedRoadmapSource;
  /** Canonical roadmap identity, preserving exact suffixes such as ".10". */
  storedKey: string;
  /** Exact authored scalar used to target the owning YAML entry surgically. */
  authoredId: string;
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
 * Resolve a sprint number to the single source entry that owns it. Source rows
 * retain their canonical key while the numeric input remains a compatibility
 * lookup until scorecard/state callers migrate to SprintId. (#618, #659)
 */
function findRoadmapSourceSprint(store: RoadmapSourceStore, sprint: SprintId): RoadmapSourceSprintMatch {
  const targetKey = roadmapSprintKeyFromId(store.roadmap, sprint);
  const targetLabel = formatRoadmapSprintLabel(store.roadmap, sprint);
  const matches: RoadmapSourceSprintMatch[] = [];
  for (const source of store.sources) {
    for (const item of source.document.sprints) {
      const storedKey = roadmapSprintKey(store.roadmap, item);
      if (targetKey !== null && storedKey === targetKey) {
        matches.push({
          source,
          storedKey,
          authoredId: item.id_key ?? String(item.id),
          status: item.status,
        });
      }
    }
  }
  if (matches.length === 0) {
    // Name the cause: the projection is generated, so a sprint present only there
    // is invisible to reconciliation and will be dropped on the next compile. The
    // bare "not found" wording read as a per-sprint nit rather than a data warning
    // (GH #644, #637 fix 4).
    throw new RoadmapSourceError(
      `Sprint ${targetLabel} was not found in modular roadmap sources. `
      + 'The compiled roadmap projection is generated from these sources, so a sprint that exists only in the projection is not tracked and will be dropped on the next compile. Add it under docs/roadmap/.',
      store.manifestPath,
    );
  }
  if (matches.length > 1) {
    const locations = matches.map(match => `${match.source.entry.path} (id: ${match.authoredId})`).join(', ');
    throw new RoadmapSourceError(
      `Sprint ${targetLabel} resolves to ${matches.length} roadmap source entries (${locations}); refusing to reconcile an ambiguous identity.`,
      store.manifestPath,
    );
  }
  return matches[0];
}

export function completeRoadmapSourceSprint(
  cwd: string,
  sprint: SprintId,
  options: { sourceFlag?: string; scorecardPath?: string; dryRun?: boolean; force?: boolean } = {},
): CompleteRoadmapSourceSprintResult {
  const initial = loadRoadmapSourceStore(cwd, options.sourceFlag);
  const initialMatch = findRoadmapSourceSprint(initial, sprint);
  const owner = initialMatch.source;
  const sourceLabel = normalizeDiagnosticPath(relative(cwd, owner.absolutePath ?? owner.entry.path));
  const authoredStatus = initialMatch.status ?? '';

  // A scorecard records how a sprint was played, not whether it should be marked
  // complete. Auto-promotion is only legitimate from an in-flight status; every
  // other status is a deliberate disposition (absorbed, blocked, deferred,
  // superseded, cancelled, skipped) that reconciliation must never overwrite
  // (GH #660). `slope roadmap complete` passes force to intentionally override.
  if (!options.force
    && authoredStatus !== 'complete'
    && !PROMOTABLE_TO_COMPLETE.has(authoredStatus)) {
    return {
      source: sourceLabel,
      projection: 'unchanged',
      changed: false,
      skipped: 'status_conflict',
      authoredStatus,
    };
  }

  const changed = authoredStatus !== 'complete'
    || Boolean(options.scorecardPath
      && owner.document.scorecards?.[initialMatch.storedKey] !== normalizeScorecardRef(options.scorecardPath));

  if (options.dryRun) {
    return { source: sourceLabel, projection: 'unchanged', changed };
  }

  const federationLock = join(initial.sourceRoot, '.federation');
  return withFileLockSync(federationLock, () => {
    const fresh = loadRoadmapSourceStore(cwd, options.sourceFlag);
    const freshMatch = findRoadmapSourceSprint(fresh, sprint);
    const freshOwner = freshMatch.source;
    if (!freshOwner.absolutePath) {
      throw new RoadmapSourceError(
        `Sprint S${sprint} was not found in modular roadmap sources. `
        + 'The compiled roadmap projection is generated from these sources, so a sprint that exists only in the projection is not tracked and will be dropped on the next compile. Add it under docs/roadmap/.',
        fresh.manifestPath,
      );
    }

    // Re-check under the lock: a concurrent edit could have moved the authored
    // status into a deliberate disposition after the pre-lock read. Re-derive
    // the conflict from the freshly-loaded state rather than trusting the stale
    // snapshot (GH #660).
    const freshStatus = freshMatch.status ?? '';
    if (!options.force
      && freshStatus !== 'complete'
      && !PROMOTABLE_TO_COMPLETE.has(freshStatus)) {
      return {
        source: sourceLabel,
        projection: 'unchanged' as const,
        changed: false,
        skipped: 'status_conflict' as const,
        authoredStatus: freshStatus,
      };
    }

    const storedKey = freshMatch.storedKey;
    const scorecardKey = storedKey;
    const normalizedScorecard = options.scorecardPath ? normalizeScorecardRef(options.scorecardPath) : undefined;
    const originalText = readFileSync(freshOwner.absolutePath, 'utf8');
    const patchedText = patchRoadmapSourceSprintText(originalText, freshMatch.authoredId, {
      status: 'complete',
      ...(normalizedScorecard ? { scorecardKey, scorecardPath: normalizedScorecard } : {}),
    });
    const expectedDocument = {
      version: freshOwner.document.version,
      phase: freshOwner.document.phase,
      sprints: freshOwner.document.sprints.map(item =>
        roadmapSprintKey(fresh.roadmap, item) === storedKey ? { ...item, status: 'complete' } : item,
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
      // entries, mixed EOLs). Apply the same targeted change to the parsed
      // document instead of serialising expectedDocument from scratch: the
      // change is known exactly, and a full stringify discards every comment
      // in the bundle, which silently deleted authored history (#706).
      // Still marked reformatted, because node-level formatting can shift.
      reformatted = true;
      const sprintIndex = freshOwner.document.sprints.findIndex(
        item => roadmapSprintKey(fresh.roadmap, item) === storedKey,
      );
      nextText = rewriteSprintStatusPreservingComments(originalText, sprintIndex, {
        ...(normalizedScorecard ? { scorecardKey, scorecardPath: normalizedScorecard } : {}),
      }) ?? stringify(expectedDocument);
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
    // Closeout reconciliation runs from `slope validate`, which is where the
    // silent projection rewrite destroyed authored planning work (GH #637).
    if (projection === 'written' && existing != null) assertNoProjectionContentLoss(reloaded, existing);
    if (projection === 'written') atomicWriteFileSync(reloaded.outputPath, projectionBytesForWrite(reloaded));
    // Carry the projection's path so callers can name the file they rewrote
    // rather than saying "projection written" and leaving the reader to guess
    // which tracked file just changed (#706).
    return {
      source: sourceLabel,
      projection,
      projectionPath: normalizeDiagnosticPath(relative(reloaded.cwd, reloaded.outputPath)),
      changed: true,
      reformatted,
    };
  });
}

/**
 * Compare a checked-out generated projection with canonical generated bytes.
 * Git may materialize tracked LF files as CRLF on Windows; normalize only that
 * checkout representation so every other formatting or semantic difference
 * remains observable drift.
 */
export function roadmapProjectionMatches(actual: string, expected: string): boolean {
  // `actual` is on-disk bytes, which carry the generated-file marker; `expected`
  // is canonical marker-free bytes. Strip before comparing so a marked file is
  // not mistaken for drift, and so projections written before the marker existed
  // still compare equal (GH #644).
  return stripRoadmapProjectionMarker(actual).replace(/\r\n/g, '\n')
    === stripRoadmapProjectionMarker(expected).replace(/\r\n/g, '\n');
}

/** Projection bytes to write: canonical content plus the generated-file marker. */
function projectionBytesForWrite(store: RoadmapSourceStore): string {
  const manifestLabel = normalizeDiagnosticPath(relative(store.cwd, store.manifestPath));
  return withRoadmapProjectionMarker(store.projection, manifestLabel);
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
        const sprintKey = roadmapSprintKey(store.roadmap, sprint);
        const scorecardRef = source.document.scorecards?.[sprintKey];
        if (!scorecardRef) {
          result.errors.push({
            code: 'archive_scorecard_missing',
            source: source.entry.path,
            sprint: sprintKey,
            message: `Archived complete Sprint S${sprintKey} has no scorecard link.`,
          });
          continue;
        }
        let scorecardPath: string;
        try {
          scorecardPath = ensureWithin(
            store.cwd,
            resolve(store.cwd, ...scorecardRef.split('/')),
            `scorecard path for S${sprintKey}`,
          );
        } catch (error) {
          result.errors.push({
            code: 'archive_scorecard_unsafe',
            source: source.entry.path,
            sprint: sprintKey,
            message: (error as Error).message,
          });
          continue;
        }
        if (!existsSync(scorecardPath)) {
          result.errors.push({
            code: 'archive_scorecard_not_found',
            source: source.entry.path,
            sprint: sprintKey,
            message: `Archived scorecard does not exist: ${normalizeDiagnosticPath(scorecardRef)}.`,
          });
          continue;
        }
        try {
          const raw = JSON.parse(readFileSync(scorecardPath, 'utf8')) as { sprint_number?: unknown };
          const scorecardSprint = typeof raw.sprint_number === 'string' || typeof raw.sprint_number === 'number'
            ? roadmapSprintKeyFromId(store.roadmap, raw.sprint_number)
            : null;
          if (scorecardSprint !== sprintKey) {
            result.errors.push({
              code: 'archive_scorecard_mismatch',
              source: source.entry.path,
              sprint: sprintKey,
              message: `Scorecard ${normalizeDiagnosticPath(scorecardRef)} records ${String(raw.sprint_number)} instead of Sprint S${sprintKey}.`,
            });
          }
        } catch (error) {
          result.errors.push({
            code: 'archive_scorecard_invalid',
            source: source.entry.path,
            sprint: sprintKey,
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
  through: SprintId;
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
  through: SprintId,
): RoadmapSourceArchivePlan {
  const moves: RoadmapSourceArchiveMove[] = [];
  const nextEntries = store.project.sources.map(entry => ({ ...entry }));

  for (const [index, source] of store.sources.entries()) {
    if (source.entry.kind !== 'phase') continue;
    const sprintIds = source.document.phase.sprint_keys
      ?? source.document.phase.sprints;
    const comparisons = sprintIds.map(id => compareRoadmapSprintIds(store.roadmap, id, through));
    const includesAtOrBefore = comparisons.some(comparison => comparison <= 0);
    const includesAfter = comparisons.some(comparison => comparison > 0);
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
    manifestYaml: rewriteManifestSourcesPreservingComments(store.manifestPath, nextEntries)
      ?? stringify(project, { lineWidth: 0 }),
  };
}

/** Rewrite only the `sources` list in the manifest, keeping the rest of the
 *  document as authored.
 *
 *  Archiving changes nothing but which directory each source lives in, yet the
 *  previous full stringify discarded every comment in project.yaml, including
 *  the long authored description block (#706). This has no surgical text
 *  patcher to fall back on, so the Document API is the only path that keeps
 *  them. Comments written inside the sources list itself do not survive, since
 *  that node is replaced wholesale; comments anywhere else do.
 *
 *  Returns null when the manifest cannot be read or parsed, so the caller
 *  keeps its previous behaviour.
 */
function rewriteManifestSourcesPreservingComments(
  manifestPath: string,
  nextEntries: RoadmapSourceProject['sources'],
): string | null {
  let doc;
  try {
    doc = parseDocument(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  if (doc.errors.length > 0) return null;
  if (doc.getIn(['sources']) == null) return null;

  doc.setIn(['sources'], nextEntries);
  return String(doc);
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
