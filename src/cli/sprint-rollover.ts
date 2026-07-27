import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  castRoadmapStructure,
  discoverScorecardFiles,
  formatRoadmapSprintLabel,
  isRoadmapSprintPending,
  isRoadmapSprintTerminal,
  parseRoadmap,
  roadmapSprintKey,
  roadmapSprintKeyFromId,
  roadmapSprintOrderValue,
  sprintNumberFromScorecardFile,
  sprintIdKey,
  validateScorecard,
  type RoadmapDefinition,
  type RoadmapSprint,
  type SprintId,
} from '../core/index.js';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';
import type { ResolvedActor } from './actor.js';
import { loadConfig } from './config.js';
import {
  createSprintState,
  isSprintComplete,
  isValidSprintStateEvidence,
  loadSprintStateResult,
  replaceSprintState,
  type SprintRolloverLineage,
  type SprintState,
} from './sprint-state.js';

export type SprintRolloverIssueCode =
  | 'state_missing'
  | 'from_state_mismatch'
  | 'from_roadmap_missing'
  | 'from_roadmap_ambiguous'
  | 'target_roadmap_missing'
  | 'target_roadmap_ambiguous'
  | 'target_not_later'
  | 'target_not_pending'
  | 'from_not_terminal'
  | 'force_reason_required'
  | 'reason_without_force'
  | 'target_dependency_blocked'
  | 'no_eligible_successor'
  | 'target_not_next_eligible';

export interface SprintRolloverIssue {
  code: SprintRolloverIssueCode;
  message: string;
}

export interface SprintRolloverAssessment {
  valid: boolean;
  from: number;
  to: number;
  from_label: string;
  to_label: string;
  from_terminal: boolean;
  forced: boolean;
  reason?: string;
  expected_next?: number;
  expected_next_label?: string;
  blocking_dependencies: string[];
  blocking_dependency_labels: string[];
  completion_evidence: {
    roadmap_complete: SprintId[];
    scorecards: SprintId[];
    local_terminal: SprintId[];
  };
  issues: SprintRolloverIssue[];
  roadmap: RoadmapDefinition;
  roadmap_path: string;
  roadmap_sha256: string;
  from_sprint?: RoadmapSprint;
  to_sprint?: RoadmapSprint;
}

export interface SprintRolloverScorecardEvidence {
  sprint: SprintId;
  path: string;
  sha256: string;
}

export interface SprintRolloverInput {
  from: number;
  to: number;
  force?: boolean;
  reason?: string;
}

export interface SprintRolloverAuditRecord {
  version: 1;
  kind: 'sprint_rollover';
  transition_id: string;
  from_sprint: number;
  to_sprint: number;
  from_label: string;
  to_label: string;
  recorded_at: string;
  actor: {
    name: string;
    source: string;
  };
  request: {
    from: number;
    to: number;
    force: boolean;
    reason?: string;
  };
  forced: boolean;
  reason?: string;
  eligibility: {
    from_terminal: boolean;
    target_dependency_eligible: boolean;
    blocking_dependencies: string[];
    target_dependencies: string[];
    completion_evidence: SprintRolloverAssessment['completion_evidence'];
    scorecard_artifacts: SprintRolloverScorecardEvidence[];
    /** Absent when no pending successor exists — e.g. an explicit rollover into
     *  the last sprint of a phase that closeout already marked complete. */
    expected_next?: number;
  };
  roadmap: {
    path: string;
    sha256: string;
    from_status?: string;
    to_status?: string;
  };
  prior_state_sha256: string;
  prior_state: SprintState;
  next_state: SprintState;
  claims_policy: 'unchanged';
  sessions_policy: 'unchanged';
}

export interface SprintRolloverResult {
  audit_path: string;
  record: SprintRolloverAuditRecord;
  state: SprintState;
  already_applied: boolean;
}

export class SprintRolloverError extends Error {
  constructor(message: string, readonly assessment?: SprintRolloverAssessment) {
    super(message);
    this.name = 'SprintRolloverError';
  }
}

interface LoadedCompletionEvidence {
  sprintIds: SprintId[];
  scorecards: SprintRolloverScorecardEvidence[];
}

/**
 * Hash a tracked text file's content with line endings normalized to LF.
 *
 * Raw-byte hashing made every rollover audit single-use on Windows: with
 * `core.autocrlf` any checkout, merge or branch switch renormalizes tracked text
 * to CRLF, changing the bytes without changing the content, so verification
 * reported "scorecard evidence changed" for a file nobody had touched — and the
 * lifecycle could not advance (GH #649). Normalizing matches what git stores, so
 * the digest is reproducible across platforms and checkouts.
 */
export function hashTrackedContent(content: Buffer | string): string {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** True when a digest matches, accepting legacy raw-byte digests written before
 *  normalization so existing audits keep verifying. */
export function trackedContentMatches(content: Buffer, expected: string): boolean {
  if (hashTrackedContent(content) === expected) return true;
  return createHash('sha256').update(content).digest('hex') === expected;
}

function roadmapIdsEqual(roadmap: RoadmapDefinition, left: number, right: number): boolean {
  return roadmapSprintOrderValue(roadmap, left) === roadmapSprintOrderValue(roadmap, right);
}

function roadmapSprintsById(roadmap: RoadmapDefinition, sprint: number): RoadmapSprint[] {
  return roadmap.sprints.filter(candidate => roadmapIdsEqual(roadmap, candidate.id, sprint));
}

function loadRolloverRoadmap(cwd: string): { roadmap: RoadmapDefinition; path: string; sha256: string } {
  const config = loadConfig(cwd);
  const absolutePath = ensureTrackedPath(cwd, resolve(cwd, config.roadmapPath));
  const path = relative(cwd, absolutePath).replaceAll('\\', '/');
  if (!existsSync(absolutePath)) {
    throw new SprintRolloverError(`Roadmap not found at ${path}; safe rollover requires dependency evidence.`);
  }
  let raw: unknown;
  let source: string;
  try {
    source = readFileSync(absolutePath, 'utf8');
    raw = JSON.parse(source);
  } catch (error) {
    throw new SprintRolloverError(`Could not parse roadmap at ${path}: ${(error as Error).message}`);
  }
  const parsed = parseRoadmap(raw);
  const roadmap = parsed.roadmap ?? castRoadmapStructure(raw);
  if (!roadmap || parsed.validation.errors.length > 0) {
    const detail = boundedMessages(parsed.validation.errors.map(issue => issue.message));
    throw new SprintRolloverError(`Roadmap is not safe for rollover${detail ? `: ${detail}` : '.'}`);
  }
  return { roadmap, path, sha256: hashTrackedContent(source) };
}

function loadCompletionEvidence(cwd: string): LoadedCompletionEvidence {
  const config = loadConfig(cwd);
  const scorecards: SprintRolloverScorecardEvidence[] = [];
  const recorded = new Set<string>();
  for (const discovered of discoverScorecardFiles(config, cwd)) {
    const fileSprint = sprintNumberFromScorecardFile(discovered, config);
    const fileSprintKey = fileSprint == null ? null : sprintIdKey(fileSprint);
    if (fileSprintKey == null || recorded.has(fileSprintKey)) continue;
    const absolutePath = ensureTrackedPath(cwd, resolve(cwd, discovered));
    const source = readFileSync(absolutePath);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(source.toString('utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const sprint = raw.sprint_number ?? raw.sprint;
    if (sprintIdKey(sprint as SprintId) !== fileSprintKey
      || !validateScorecard(raw as unknown as Parameters<typeof validateScorecard>[0]).valid) continue;
    scorecards.push({
      sprint: fileSprintKey,
      path: relative(cwd, absolutePath).replaceAll('\\', '/'),
      sha256: hashTrackedContent(source),
    });
    recorded.add(fileSprintKey);
  }
  return { sprintIds: [...recorded], scorecards };
}

function effectiveCompletedOrders(
  roadmap: RoadmapDefinition,
  fromSprint: RoadmapSprint | undefined,
  fromTerminal: boolean,
  completionEvidence: SprintId[],
): Set<string> {
  const fromKey = fromSprint ? roadmapSprintKey(roadmap, fromSprint) : null;
  const completed = new Set(
    roadmap.sprints
      .filter(sprint => sprint.status === 'complete'
        && (fromTerminal || roadmapSprintKey(roadmap, sprint) !== fromKey))
      .map(sprint => roadmapSprintKey(roadmap, sprint)),
  );
  for (const sprint of completionEvidence) {
    const key = roadmapSprintKeyFromId(roadmap, sprint);
    if (key !== null && (fromTerminal || key !== fromKey)) completed.add(key);
  }
  if (fromTerminal && fromSprint) completed.add(roadmapSprintKey(roadmap, fromSprint));
  return completed;
}

function boundedMessages(messages: string[], limit = 5): string {
  const shown = messages.slice(0, limit);
  const omitted = messages.length - shown.length;
  return `${shown.join('; ')}${omitted > 0 ? `; … ${omitted} additional issue(s) omitted` : ''}`;
}

function boundedSprintLabels(roadmap: RoadmapDefinition, ids: SprintId[], limit = 5): string {
  const shown = ids.slice(0, limit).map(id => formatRoadmapSprintLabel(roadmap, id));
  const omitted = ids.length - shown.length;
  return `${shown.join(', ')}${omitted > 0 ? `, … ${omitted} additional sprint(s)` : ''}`;
}

function dependencyBlockers(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint,
  completed: Set<string>,
): string[] {
  return (sprint.depends_on ?? [])
    .map(dependency => roadmapSprintKeyFromId(roadmap, dependency))
    .filter((dependency): dependency is string =>
      dependency !== null && !completed.has(dependency));
}

export function assessSprintRollover(
  state: SprintState | null,
  roadmap: RoadmapDefinition,
  roadmapPath: string,
  input: SprintRolloverInput,
  completionEvidence: SprintId[] = [],
  roadmapSha256 = '',
): SprintRolloverAssessment {
  const force = input.force === true;
  const reason = input.reason?.trim();
  const fromMatches = roadmapSprintsById(roadmap, input.from);
  const toMatches = roadmapSprintsById(roadmap, input.to);
  const fromSprint = fromMatches.length === 1 ? fromMatches[0] : undefined;
  const toSprint = toMatches.length === 1 ? toMatches[0] : undefined;
  const fromLabel = fromSprint ? formatRoadmapSprintLabel(roadmap, fromSprint.id) : `S${input.from}`;
  const toLabel = toSprint ? formatRoadmapSprintLabel(roadmap, toSprint.id) : `S${input.to}`;
  const terminal = Boolean(state && isSprintComplete(state));
  const issues: SprintRolloverIssue[] = [];

  if (!state) issues.push({ code: 'state_missing', message: 'No sprint state exists to roll over.' });
  if (fromMatches.length === 0) issues.push({ code: 'from_roadmap_missing', message: `${fromLabel} is not present in the roadmap.` });
  if (fromMatches.length > 1) issues.push({ code: 'from_roadmap_ambiguous', message: `${fromLabel} resolves to multiple roadmap rows.` });
  if (toMatches.length === 0) issues.push({ code: 'target_roadmap_missing', message: `${toLabel} is not present in the roadmap.` });
  if (toMatches.length > 1) issues.push({ code: 'target_roadmap_ambiguous', message: `${toLabel} resolves to multiple roadmap rows.` });
  if (state && fromSprint && !roadmapIdsEqual(roadmap, state.sprint, fromSprint.id)) {
    issues.push({
      code: 'from_state_mismatch',
      message: `sprint-state.json is for ${formatRoadmapSprintLabel(roadmap, state.sprint)}, not ${fromLabel}.`,
    });
  }
  if (fromSprint && toSprint
    && roadmapSprintOrderValue(roadmap, toSprint.id) <= roadmapSprintOrderValue(roadmap, fromSprint.id)) {
    issues.push({ code: 'target_not_later', message: `${toLabel} is not later than ${fromLabel}.` });
  }
  if (toSprint && isRoadmapSprintTerminal(toSprint)) {
    // A sprint that is terminal in the roadmap *and* has completion evidence is
    // finished work being recorded, not finished work being restarted: closeout
    // still needs local state for it to run gates and open its PR. Blocking that
    // made the last sprint of a phase permanently un-PR-able once `slope validate`
    // had reconciled it to complete, and `--force` did not help because this check
    // ignored it (GH #641).
    const toOrder = roadmapSprintOrderValue(roadmap, toSprint.id);
    const toHasEvidence = completionEvidence
      .some(id => roadmapSprintOrderValue(roadmap, id) === toOrder);
    if (!toHasEvidence && !force) {
      issues.push({
        code: 'target_not_pending',
        message: `${toLabel} is not pending roadmap work (status: ${toSprint.status ?? 'unset'}) and has no completion evidence. Re-run with --force --reason=<why> to record state for it anyway.`,
      });
    }
  }
  if (state && !terminal && !force) {
    issues.push({
      code: 'from_not_terminal',
      message: `${fromLabel} is still in progress (phase: ${state.phase}; pending gates: ${Object.entries(state.gates).filter(([, done]) => !done).map(([gate]) => gate).join(', ') || 'review evidence'}).`,
    });
  }
  if (force && !reason) {
    issues.push({ code: 'force_reason_required', message: '--force requires --reason=<why the in-progress rollover is intentional>.' });
  }
  if (!force && reason) {
    issues.push({ code: 'reason_without_force', message: '--reason is only valid with --force.' });
  }

  const fromOrderForEvidence = fromSprint ? roadmapSprintOrderValue(roadmap, fromSprint.id) : Number.NEGATIVE_INFINITY;
  const relevantDependencyKeys = new Set(roadmap.sprints
    .filter(sprint => roadmapSprintOrderValue(roadmap, sprint.id) > fromOrderForEvidence)
    .flatMap(sprint => sprint.depends_on ?? [])
    .map(id => roadmapSprintKeyFromId(roadmap, id))
    .filter((id): id is string => id !== null));
  const relevantCompletionEvidence = completionEvidence
    .filter(id => {
      const key = roadmapSprintKeyFromId(roadmap, id);
      return key !== null && relevantDependencyKeys.has(key);
    });
  const completed = effectiveCompletedOrders(roadmap, fromSprint, terminal, relevantCompletionEvidence);
  const roadmapComplete = roadmap.sprints
    .filter(sprint => sprint.status === 'complete'
      && (terminal || !fromSprint
        || roadmapSprintOrderValue(roadmap, sprint.id) !== roadmapSprintOrderValue(roadmap, fromSprint.id)))
    .map(sprint => roadmapSprintKey(roadmap, sprint));
  const scorecardCompletions = [...new Set(
    relevantCompletionEvidence
      .map(sprint => roadmapSprintKeyFromId(roadmap, sprint))
      .filter((sprint): sprint is string => sprint !== null),
  )];
  const fromOrder = fromSprint ? roadmapSprintOrderValue(roadmap, fromSprint.id) : Number.POSITIVE_INFINITY;
  const candidates = roadmap.sprints
    .filter(sprint => isRoadmapSprintPending(sprint) && roadmapSprintOrderValue(roadmap, sprint.id) > fromOrder)
    .filter(sprint => dependencyBlockers(roadmap, sprint, completed).length === 0);
  const expectedNext = candidates.find(sprint => sprint.status === 'active') ?? candidates[0];
  const blockers = toSprint ? dependencyBlockers(roadmap, toSprint, completed) : [];

  if (toSprint && blockers.length > 0) {
    issues.push({
      code: 'target_dependency_blocked',
      message: `${toLabel} is blocked by ${boundedSprintLabels(roadmap, blockers)}.`,
    });
  }
  // Only relevant when there is no usable explicit target: it answers "where do I
  // go next?", not "may I go where I said?". Raising it for a resolvable,
  // dependency-clear target meant that once closeout marked a whole phase
  // complete, no pending successor existed and rollover stayed blocked even after
  // target_not_pending was fixed — the same deadlock one check further on
  // (GH #641).
  if (fromSprint && !expectedNext && (!toSprint || blockers.length > 0)) {
    issues.push({
      code: 'no_eligible_successor',
      message: `No dependency-eligible pending sprint follows ${fromLabel}.`,
    });
  } else if (toSprint && expectedNext && !roadmapIdsEqual(roadmap, toSprint.id, expectedNext.id)) {
    issues.push({
      code: 'target_not_next_eligible',
      message: `${toLabel} is not the next dependency-eligible sprint; use ${formatRoadmapSprintLabel(roadmap, expectedNext.id)}.`,
    });
  }

  return {
    valid: issues.length === 0,
    from: fromSprint ? roadmapSprintOrderValue(roadmap, fromSprint.id) : input.from,
    to: toSprint ? roadmapSprintOrderValue(roadmap, toSprint.id) : input.to,
    from_label: fromLabel,
    to_label: toLabel,
    from_terminal: terminal,
    forced: force,
    ...(reason ? { reason } : {}),
    ...(expectedNext ? {
      expected_next: roadmapSprintOrderValue(roadmap, expectedNext.id),
      expected_next_label: formatRoadmapSprintLabel(roadmap, expectedNext.id),
    } : {}),
    blocking_dependencies: blockers,
    blocking_dependency_labels: blockers.map(id => formatRoadmapSprintLabel(roadmap, id)),
    completion_evidence: {
      roadmap_complete: roadmapComplete,
      scorecards: scorecardCompletions,
      local_terminal: terminal && fromSprint ? [roadmapSprintKey(roadmap, fromSprint)] : [],
    },
    issues,
    roadmap,
    roadmap_path: roadmapPath,
    roadmap_sha256: roadmapSha256,
    from_sprint: fromSprint,
    to_sprint: toSprint,
  };
}

export function inspectSprintRollover(cwd: string, input: SprintRolloverInput): SprintRolloverAssessment {
  const loaded = loadRolloverRoadmap(cwd);
  const stateResult = loadSprintStateResult(cwd);
  if (stateResult.status === 'corrupt') {
    throw new SprintRolloverError(`Sprint state is corrupt and was preserved at ${relative(cwd, stateResult.path)}.`);
  }
  const completed = loadCompletionEvidence(cwd).sprintIds;
  return assessSprintRollover(
    stateResult.status === 'valid' ? stateResult.state : null,
    loaded.roadmap,
    loaded.path,
    input,
    completed,
    loaded.sha256,
  );
}

function stateDigest(state: SprintState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function ensureTrackedPath(cwd: string, path: string): string {
  const root = resolve(cwd);
  const resolvedPath = resolve(path);
  const lexical = relative(root, resolvedPath);
  if (lexical === '..' || lexical.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(lexical)) {
    throw new SprintRolloverError(`Tracked rollover audit path escapes the repository: ${resolvedPath}`);
  }
  const realRoot = realpathSync(root);
  let existing = resolvedPath;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const realExisting = realpathSync(existing);
  const realRel = relative(realRoot, realExisting);
  if (realRel === '..' || realRel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(realRel)) {
    throw new SprintRolloverError(`Tracked rollover audit path resolves outside the repository: ${realExisting}`);
  }
  return resolvedPath;
}

function transactionKey(priorState: SprintState, input: SprintRolloverInput): string {
  return createHash('sha256').update(JSON.stringify({
    prior_state_sha256: stateDigest(priorState),
    requested_from: input.from,
    requested_to: input.to,
    force: input.force === true,
    reason: input.reason?.trim() || null,
  })).digest('hex').slice(0, 16);
}

function auditPathFor(cwd: string, input: SprintRolloverInput, key: string): string {
  const config = loadConfig(cwd);
  const auditRoot = ensureTrackedPath(cwd, resolve(cwd, config.scorecardDir, 'rollovers'));
  return ensureTrackedPath(cwd, join(auditRoot, `sprint-${input.from}-to-${input.to}-${key}.json`));
}

function auditIntegrityPayload(record: SprintRolloverAuditRecord): unknown {
  const rollover = record.next_state.rollover;
  return {
    version: record.version,
    kind: record.kind,
    from_sprint: record.from_sprint,
    to_sprint: record.to_sprint,
    from_label: record.from_label,
    to_label: record.to_label,
    recorded_at: record.recorded_at,
    actor: record.actor,
    request: record.request,
    forced: record.forced,
    reason: record.reason ?? null,
    eligibility: record.eligibility,
    roadmap: record.roadmap,
    prior_state_sha256: record.prior_state_sha256,
    prior_state: record.prior_state,
    next_state: {
      ...record.next_state,
      ...(rollover ? { rollover: { ...rollover, transition_id: null } } : {}),
    },
    claims_policy: record.claims_policy,
    sessions_policy: record.sessions_policy,
  };
}

function auditTransitionId(record: SprintRolloverAuditRecord): string {
  return createHash('sha256').update(JSON.stringify(auditIntegrityPayload(record))).digest('hex').slice(0, 16);
}

function isCanonicalRolloverNextState(state: SprintState): boolean {
  const allowedKeys = new Set([
    'sprint', 'phase', 'gates', 'review_gates', 'review_requirements',
    'started_at', 'updated_at', 'rollover',
  ]);
  if (Object.keys(state).some(key => !allowedKeys.has(key))) return false;
  if (state.phase !== 'planning' || state.started_at !== state.updated_at) return false;
  if (Object.values(state.gates).some(Boolean)) return false;
  if (!state.review_gates || !state.review_requirements) return false;
  for (const gate of ['code_review', 'architect_review'] as const) {
    const review = state.review_gates[gate];
    if (!review || review.provenance !== 'pending' || review.evidence.length !== 0
      || review.reviewer !== undefined || review.notes !== undefined || review.updated_at !== undefined) return false;
    const requirement = state.review_requirements[gate];
    if (!requirement || requirement.priority !== 'unspecified'
      || requirement.reason !== undefined || requirement.source !== undefined || requirement.updated_at !== undefined) return false;
  }
  return true;
}

function validScorecardArtifact(value: unknown): value is SprintRolloverScorecardEvidence {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<SprintRolloverScorecardEvidence>;
  return sprintIdKey(artifact.sprint as SprintId) !== null
    && typeof artifact.path === 'string' && artifact.path.length > 0 && !isAbsolute(artifact.path)
    && typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256);
}

function readAudit(cwd: string, path: string): SprintRolloverAuditRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SprintRolloverError(`Existing rollover audit is unreadable: ${(error as Error).message}`);
  }
  const record = raw as Partial<SprintRolloverAuditRecord>;
  const shapeProblem = describeAuditShapeProblem(record);
  if (shapeProblem) {
    throw new SprintRolloverError(
      `Existing rollover audit is not valid: ${shapeProblem}. Refusing to replace it.`,
    );
  }
  const complete = record as SprintRolloverAuditRecord;
  ensureTrackedPath(cwd, resolve(cwd, complete.roadmap.path));
  if (stateDigest(complete.prior_state) !== complete.prior_state_sha256
    || complete.transition_id !== auditTransitionId(complete)
    || !isCanonicalRolloverNextState(complete.next_state)
    || complete.next_state.sprint !== complete.to_sprint
    || complete.next_state.rollover?.transition_id !== complete.transition_id
    || complete.next_state.rollover?.from_sprint !== complete.from_sprint
    || complete.next_state.rollover?.recorded_at !== complete.recorded_at
    || complete.next_state.rollover?.forced !== complete.forced
    || (complete.next_state.rollover?.reason ?? '') !== (complete.reason ?? '')
    || complete.request.force !== complete.forced
    || (complete.request.reason?.trim() ?? '') !== (complete.reason ?? '')
    || JSON.stringify(complete.eligibility.scorecard_artifacts.map(item => item.sprint))
      !== JSON.stringify(complete.eligibility.completion_evidence.scorecards)) {
    throw new SprintRolloverError('Existing rollover audit failed embedded state integrity checks.');
  }
  return complete;
}

function auditRequestMatches(record: SprintRolloverAuditRecord, input: SprintRolloverInput): boolean {
  return record.request.from === input.from
    && record.request.to === input.to
    && record.request.force === (input.force === true)
    && (record.request.reason?.trim() ?? '') === (input.reason?.trim() ?? '');
}

function assertAuditPathIdentity(
  cwd: string,
  path: string,
  record: SprintRolloverAuditRecord,
): void {
  const recordedPath = record.next_state.rollover?.audit_path;
  const expectedPath = relative(cwd, path).replaceAll('\\', '/');
  if (!recordedPath || isAbsolute(recordedPath) || recordedPath.replaceAll('\\', '/') !== expectedPath) {
    throw new SprintRolloverError('Existing rollover audit does not match its recorded tracked path.');
  }
}

function assertRecordedScorecardEvidenceAvailable(
  cwd: string,
  record: SprintRolloverAuditRecord,
): void {
  for (const artifact of record.eligibility.scorecard_artifacts) {
    const path = ensureTrackedPath(cwd, resolve(cwd, artifact.path));
    if (!existsSync(path)) {
      throw new SprintRolloverError(`Existing rollover audit references missing scorecard evidence: ${artifact.path}.`);
    }
    if (!trackedContentMatches(readFileSync(path), artifact.sha256)) {
      throw new SprintRolloverError(
        `Existing rollover audit scorecard evidence changed: ${artifact.path}.`
        + ' Content differs from what the audit recorded (line endings are normalized before hashing,'
        + ' so this is a real content change).',
      );
    }
  }
}

function buildAuditRecord(
  assessment: SprintRolloverAssessment,
  priorState: SprintState,
  nextState: SprintState,
  actor: ResolvedActor,
  recordedAt: string,
  input: SprintRolloverInput,
  scorecards: SprintRolloverScorecardEvidence[],
): SprintRolloverAuditRecord {
  const record: SprintRolloverAuditRecord = {
    version: 1,
    kind: 'sprint_rollover',
    transition_id: '',
    from_sprint: assessment.from,
    to_sprint: assessment.to,
    from_label: assessment.from_label,
    to_label: assessment.to_label,
    recorded_at: recordedAt,
    actor: { name: actor.name, source: actor.source },
    request: {
      from: input.from,
      to: input.to,
      force: input.force === true,
      ...(assessment.reason ? { reason: assessment.reason } : {}),
    },
    forced: assessment.forced,
    ...(assessment.reason ? { reason: assessment.reason } : {}),
    eligibility: {
      from_terminal: assessment.from_terminal,
      target_dependency_eligible: assessment.blocking_dependencies.length === 0,
      blocking_dependencies: assessment.blocking_dependencies,
      target_dependencies: (assessment.to_sprint?.depends_on ?? [])
        .map(id => roadmapSprintKeyFromId(assessment.roadmap, id))
        .filter((id): id is string => id !== null),
      completion_evidence: assessment.completion_evidence,
      scorecard_artifacts: scorecards,
      ...(assessment.expected_next != null ? { expected_next: assessment.expected_next } : {}),
    },
    roadmap: {
      path: assessment.roadmap_path,
      sha256: assessment.roadmap_sha256,
      ...(assessment.from_sprint?.status ? { from_status: assessment.from_sprint.status } : {}),
      ...(assessment.to_sprint?.status ? { to_status: assessment.to_sprint.status } : {}),
    },
    prior_state_sha256: stateDigest(priorState),
    prior_state: priorState,
    next_state: nextState,
    claims_policy: 'unchanged',
    sessions_policy: 'unchanged',
  };
  record.transition_id = auditTransitionId(record);
  record.next_state.rollover!.transition_id = record.transition_id;
  return record;
}

/** Verify that a rollover-linked state still has exact tracked audit evidence. */
/**
 * Return the first structural problem with a persisted audit, or null when it is
 * valid.
 *
 * Replaces a single 40-term boolean chain that threw "invalid shape" naming no
 * field. Diagnosing a refusal meant reading this function — and the actual cause
 * turned out to be a field that was *absent* rather than malformed, which the
 * message gave no way to guess (GH #646).
 */
function describeAuditShapeProblem(record: Partial<SprintRolloverAuditRecord>): string | null {
  const nonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

  if (record.version !== 1) return 'version must be 1';
  if (record.kind !== 'sprint_rollover') return "kind must be 'sprint_rollover'";
  if (typeof record.transition_id !== 'string') return 'transition_id must be a string';
  if (typeof record.from_sprint !== 'number') return 'from_sprint must be a number';
  if (typeof record.to_sprint !== 'number') return 'to_sprint must be a number';
  if (typeof record.from_label !== 'string') return 'from_label must be a string';
  if (typeof record.to_label !== 'string') return 'to_label must be a string';
  if (typeof record.recorded_at !== 'string') return 'recorded_at must be a string';
  if (!Number.isFinite(Date.parse(record.recorded_at))) return 'recorded_at must be a parseable timestamp';

  if (!record.actor) return 'actor is missing';
  if (!nonEmptyString(record.actor.name)) return 'actor.name must be a non-empty string';
  if (!nonEmptyString(record.actor.source)) return 'actor.source must be a non-empty string';

  if (!record.request) return 'request is missing';
  if (typeof record.request.from !== 'number') return 'request.from must be a number';
  if (typeof record.request.to !== 'number') return 'request.to must be a number';
  if (typeof record.request.force !== 'boolean') return 'request.force must be a boolean';
  if (record.request.reason !== undefined && typeof record.request.reason !== 'string') {
    return 'request.reason must be a string when present';
  }

  if (typeof record.forced !== 'boolean') return 'forced must be a boolean';
  if (record.reason !== undefined && typeof record.reason !== 'string') {
    return 'reason must be a string when present';
  }

  const eligibility = record.eligibility;
  if (!eligibility) return 'eligibility is missing';
  // Absent is valid: no pending successor exists once a phase is fully complete.
  if (eligibility.expected_next !== undefined && typeof eligibility.expected_next !== 'number') {
    return 'eligibility.expected_next must be a number when present';
  }
  if (typeof eligibility.from_terminal !== 'boolean') return 'eligibility.from_terminal must be a boolean';
  if (typeof eligibility.target_dependency_eligible !== 'boolean') {
    return 'eligibility.target_dependency_eligible must be a boolean';
  }
  if (!Array.isArray(eligibility.blocking_dependencies)) {
    return 'eligibility.blocking_dependencies must be an array';
  }
  if (!Array.isArray(eligibility.target_dependencies)) {
    return 'eligibility.target_dependencies must be an array';
  }

  const evidence = eligibility.completion_evidence;
  if (!evidence) return 'eligibility.completion_evidence is missing';
  if (!Array.isArray(evidence.roadmap_complete)) {
    return 'eligibility.completion_evidence.roadmap_complete must be an array';
  }
  if (!Array.isArray(evidence.scorecards)) {
    return 'eligibility.completion_evidence.scorecards must be an array';
  }
  if (!Array.isArray(evidence.local_terminal)) {
    return 'eligibility.completion_evidence.local_terminal must be an array';
  }

  if (!Array.isArray(eligibility.scorecard_artifacts)) {
    return 'eligibility.scorecard_artifacts must be an array';
  }
  const badArtifact = eligibility.scorecard_artifacts.findIndex(artifact => !validScorecardArtifact(artifact));
  if (badArtifact >= 0) {
    return `eligibility.scorecard_artifacts[${badArtifact}] must have sprint, path and sha256`;
  }

  if (!record.roadmap) return 'roadmap is missing';
  if (typeof record.roadmap.path !== 'string') return 'roadmap.path must be a string';
  if (typeof record.roadmap.sha256 !== 'string') return 'roadmap.sha256 must be a string';

  if (typeof record.prior_state_sha256 !== 'string') return 'prior_state_sha256 must be a string';
  if (!isValidSprintStateEvidence(record.prior_state)) return 'prior_state is not valid sprint state';
  if (!isValidSprintStateEvidence(record.next_state)) return 'next_state is not valid sprint state';
  if (record.claims_policy !== 'unchanged') return "claims_policy must be 'unchanged'";
  if (record.sessions_policy !== 'unchanged') return "sessions_policy must be 'unchanged'";

  return null;
}

export function verifySprintRolloverLineage(cwd: string, state: SprintState): SprintRolloverAuditRecord | null {
  const lineage = state.rollover;
  if (!lineage) return null;
  if (!lineage.audit_path || isAbsolute(lineage.audit_path)) {
    throw new SprintRolloverError('Current rollover lineage does not contain a repository-relative audit path.');
  }
  const path = ensureTrackedPath(cwd, resolve(cwd, lineage.audit_path));
  if (!existsSync(path)) throw new SprintRolloverError('Current rollover lineage audit is missing.');
  const record = readAudit(cwd, path);
  assertAuditPathIdentity(cwd, path, record);
  assertRecordedScorecardEvidenceAvailable(cwd, record);
  if (state.sprint !== record.next_state.sprint
    || state.started_at !== record.next_state.started_at
    || lineage.transition_id !== record.transition_id
    || lineage.from_sprint !== record.from_sprint
    || lineage.recorded_at !== record.recorded_at
    || lineage.forced !== record.forced
    || (lineage.reason ?? '') !== (record.reason ?? '')) {
    throw new SprintRolloverError('Current rollover lineage does not match its tracked audit record.');
  }
  return record;
}

export function performSprintRollover(
  cwd: string,
  input: SprintRolloverInput,
  actor: ResolvedActor,
): SprintRolloverResult {
  if (!Number.isFinite(input.from) || input.from <= 0 || !Number.isFinite(input.to) || input.to <= 0) {
    throw new SprintRolloverError('Rollover sprint ids must be positive finite numbers.');
  }
  if (input.reason?.trim() && input.force !== true) {
    throw new SprintRolloverError('--reason is only valid with --force.');
  }
  const initialState = loadSprintStateResult(cwd);
  if (initialState.status === 'missing') {
    throw new SprintRolloverError('No sprint state exists to roll over.');
  }
  if (initialState.status === 'corrupt') {
    throw new SprintRolloverError(`Sprint state is corrupt and was preserved at ${relative(cwd, initialState.path)}.`);
  }

  let record: SprintRolloverAuditRecord | undefined;
  let alreadyApplied = false;
  let resolvedAuditPath: string | undefined;

  const replacement = replaceSprintState(cwd, current => {
    const lineageRecord = verifySprintRolloverLineage(cwd, current);
    if (lineageRecord && auditRequestMatches(lineageRecord, input)) {
      record = lineageRecord;
      resolvedAuditPath = ensureTrackedPath(cwd, resolve(cwd, current.rollover!.audit_path));
      alreadyApplied = true;
      return null;
    }

    const key = transactionKey(current, input);
    const auditPath = auditPathFor(cwd, input, key);
    const auditRelativePath = relative(cwd, auditPath).replaceAll('\\', '/');
    resolvedAuditPath = auditPath;

    record = withFileLockSync(auditPath, () => {
      if (existsSync(auditPath)) {
        const existing = readAudit(cwd, auditPath);
        assertAuditPathIdentity(cwd, auditPath, existing);
        if (!auditRequestMatches(existing, input)) {
          throw new SprintRolloverError('Existing rollover audit records different request evidence.');
        }
        if (existing.prior_state_sha256 !== stateDigest(current)) {
          throw new SprintRolloverError('Existing rollover audit does not match the current prior sprint state.');
        }
        assertRecordedScorecardEvidenceAvailable(cwd, existing);
        return existing;
      }

      // New transitions reload all mutable eligibility evidence under both the
      // state and audit locks. Existing audited transitions recover from their
      // immutable record even when the roadmap has since advanced.
      const loaded = loadRolloverRoadmap(cwd);
      const completion = loadCompletionEvidence(cwd);
      const assessment = assessSprintRollover(
        current,
        loaded.roadmap,
        loaded.path,
        input,
        completion.sprintIds,
        loaded.sha256,
      );
      if (!assessment.valid) {
        throw new SprintRolloverError(boundedMessages(assessment.issues.map(issue => issue.message)), assessment);
      }

      const recordedAt = new Date().toISOString();
      const nextState = createSprintState(assessment.to, 'planning');
      const usedScorecardKeys = new Set(
        assessment.completion_evidence.scorecards
          .map(sprint => roadmapSprintKeyFromId(loaded.roadmap, sprint))
          .filter((sprint): sprint is string => sprint !== null),
      );
      const usedScorecards = completion.scorecards.filter(item =>
        usedScorecardKeys.has(roadmapSprintKeyFromId(loaded.roadmap, item.sprint) ?? ''));
      const lineage: SprintRolloverLineage = {
        transition_id: '',
        from_sprint: assessment.from,
        audit_path: auditRelativePath,
        recorded_at: recordedAt,
        forced: assessment.forced,
        ...(assessment.reason ? { reason: assessment.reason } : {}),
      };
      nextState.rollover = lineage;
      const created = buildAuditRecord(
        assessment,
        current,
        nextState,
        actor,
        recordedAt,
        input,
        usedScorecards,
      );
      atomicWriteFileSync(auditPath, JSON.stringify(created, null, 2) + '\n');
      assertRecordedScorecardEvidenceAvailable(cwd, created);
      return created;
    });
    return record.next_state;
  });

  if (!replacement) throw new SprintRolloverError('No sprint state exists to roll over.');
  if (!record) throw new SprintRolloverError('Rollover audit was not created or recovered.');
  if (!resolvedAuditPath) throw new SprintRolloverError('Rollover audit path was not resolved.');
  return {
    audit_path: relative(cwd, resolvedAuditPath).replaceAll('\\', '/'),
    record,
    state: replacement.current,
    already_applied: alreadyApplied,
  };
}
