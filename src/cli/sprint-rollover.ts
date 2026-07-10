import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  castRoadmapStructure,
  formatRoadmapSprintLabel,
  isRoadmapSprintPending,
  isRoadmapSprintTerminal,
  parseRoadmap,
  roadmapSprintOrderValue,
  type RoadmapDefinition,
  type RoadmapSprint,
} from '../core/index.js';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';
import type { ResolvedActor } from './actor.js';
import { loadConfig } from './config.js';
import { loadScorecards } from './loader.js';
import {
  createSprintState,
  isSprintComplete,
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
  blocking_dependencies: number[];
  blocking_dependency_labels: string[];
  completion_evidence: {
    roadmap_complete: number[];
    scorecards: number[];
    local_terminal: number[];
  };
  issues: SprintRolloverIssue[];
  roadmap: RoadmapDefinition;
  roadmap_path: string;
  roadmap_sha256: string;
  from_sprint?: RoadmapSprint;
  to_sprint?: RoadmapSprint;
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
  forced: boolean;
  reason?: string;
  eligibility: {
    from_terminal: boolean;
    target_dependency_eligible: boolean;
    blocking_dependencies: number[];
    target_dependencies: number[];
    completion_evidence: SprintRolloverAssessment['completion_evidence'];
    expected_next: number;
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

function roadmapIdsEqual(roadmap: RoadmapDefinition, left: number, right: number): boolean {
  return roadmapSprintOrderValue(roadmap, left) === roadmapSprintOrderValue(roadmap, right);
}

function roadmapSprintById(roadmap: RoadmapDefinition, sprint: number): RoadmapSprint | undefined {
  return roadmapSprintsById(roadmap, sprint)[0];
}

function roadmapSprintsById(roadmap: RoadmapDefinition, sprint: number): RoadmapSprint[] {
  return roadmap.sprints.filter(candidate => roadmapIdsEqual(roadmap, candidate.id, sprint));
}

function loadRolloverRoadmap(cwd: string): { roadmap: RoadmapDefinition; path: string; sha256: string } {
  const config = loadConfig(cwd);
  const absolutePath = resolve(cwd, config.roadmapPath);
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
    const detail = parsed.validation.errors.map(issue => issue.message).join('; ');
    throw new SprintRolloverError(`Roadmap is not safe for rollover${detail ? `: ${detail}` : '.'}`);
  }
  return { roadmap, path, sha256: createHash('sha256').update(source).digest('hex') };
}

function effectiveCompletedOrders(
  roadmap: RoadmapDefinition,
  fromSprint: RoadmapSprint | undefined,
  fromTerminal: boolean,
  completionEvidence: number[],
): Set<number> {
  const completed = new Set(
    roadmap.sprints
      .filter(sprint => sprint.status === 'complete')
      .map(sprint => roadmapSprintOrderValue(roadmap, sprint.id)),
  );
  for (const sprint of completionEvidence) completed.add(roadmapSprintOrderValue(roadmap, sprint));
  if (fromTerminal && fromSprint) completed.add(roadmapSprintOrderValue(roadmap, fromSprint.id));
  return completed;
}

function dependencyBlockers(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint,
  completed: Set<number>,
): number[] {
  return (sprint.depends_on ?? []).filter(dependency =>
    !completed.has(roadmapSprintOrderValue(roadmap, dependency)));
}

export function assessSprintRollover(
  state: SprintState | null,
  roadmap: RoadmapDefinition,
  roadmapPath: string,
  input: SprintRolloverInput,
  completionEvidence: number[] = [],
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
    issues.push({ code: 'target_not_pending', message: `${toLabel} is not pending roadmap work (status: ${toSprint.status ?? 'unset'}).` });
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

  const completed = effectiveCompletedOrders(roadmap, fromSprint, terminal, completionEvidence);
  const roadmapComplete = roadmap.sprints
    .filter(sprint => sprint.status === 'complete')
    .map(sprint => roadmapSprintOrderValue(roadmap, sprint.id));
  const scorecardCompletions = [...new Set(completionEvidence.map(sprint => roadmapSprintOrderValue(roadmap, sprint)))];
  const fromOrder = fromSprint ? roadmapSprintOrderValue(roadmap, fromSprint.id) : Number.POSITIVE_INFINITY;
  const candidates = roadmap.sprints
    .filter(sprint => isRoadmapSprintPending(sprint) && roadmapSprintOrderValue(roadmap, sprint.id) > fromOrder)
    .filter(sprint => dependencyBlockers(roadmap, sprint, completed).length === 0);
  const expectedNext = candidates.find(sprint => sprint.status === 'active') ?? candidates[0];
  const blockers = toSprint ? dependencyBlockers(roadmap, toSprint, completed) : [];

  if (toSprint && blockers.length > 0) {
    issues.push({
      code: 'target_dependency_blocked',
      message: `${toLabel} is blocked by ${blockers.map(id => formatRoadmapSprintLabel(roadmap, id)).join(', ')}.`,
    });
  }
  if (fromSprint && !expectedNext) {
    issues.push({ code: 'no_eligible_successor', message: `No dependency-eligible pending sprint follows ${fromLabel}.` });
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
    blocking_dependencies: blockers.map(id => roadmapSprintOrderValue(roadmap, id)),
    blocking_dependency_labels: blockers.map(id => formatRoadmapSprintLabel(roadmap, id)),
    completion_evidence: {
      roadmap_complete: roadmapComplete,
      scorecards: scorecardCompletions,
      local_terminal: terminal && fromSprint ? [roadmapSprintOrderValue(roadmap, fromSprint.id)] : [],
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
  const completed = loadScorecards(loadConfig(cwd), cwd).map(card => card.sprint_number);
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

function transitionIdFromEvidence(
  priorState: SprintState,
  from: number,
  to: number,
  forced: boolean,
  reason?: string,
): string {
  return createHash('sha256').update(JSON.stringify({
    prior_state_sha256: stateDigest(priorState),
    from,
    to,
    forced,
    reason: reason ?? null,
  })).digest('hex').slice(0, 16);
}

function transitionId(assessment: SprintRolloverAssessment, priorState: SprintState): string {
  return transitionIdFromEvidence(
    priorState,
    assessment.from,
    assessment.to,
    assessment.forced,
    assessment.reason,
  );
}

function auditPathFor(cwd: string, assessment: SprintRolloverAssessment, id: string): string {
  const config = loadConfig(cwd);
  const auditRoot = ensureTrackedPath(cwd, resolve(cwd, config.scorecardDir, 'rollovers'));
  const from = assessment.from_label.slice(1);
  const to = assessment.to_label.slice(1);
  return ensureTrackedPath(cwd, join(auditRoot, `sprint-${from}-to-${to}-${id}.json`));
}

function readAudit(path: string): SprintRolloverAuditRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SprintRolloverError(`Existing rollover audit is unreadable: ${(error as Error).message}`);
  }
  const record = raw as Partial<SprintRolloverAuditRecord>;
  if (record.version !== 1 || record.kind !== 'sprint_rollover'
    || typeof record.transition_id !== 'string'
    || typeof record.from_sprint !== 'number' || typeof record.to_sprint !== 'number'
    || typeof record.from_label !== 'string' || typeof record.to_label !== 'string'
    || typeof record.recorded_at !== 'string'
    || !Number.isFinite(Date.parse(record.recorded_at))
    || !record.actor || typeof record.actor.name !== 'string' || record.actor.name.trim().length === 0
    || typeof record.actor.source !== 'string' || record.actor.source.trim().length === 0
    || typeof record.forced !== 'boolean'
    || (record.reason !== undefined && typeof record.reason !== 'string')
    || !record.eligibility || typeof record.eligibility.expected_next !== 'number'
    || typeof record.eligibility.from_terminal !== 'boolean'
    || typeof record.eligibility.target_dependency_eligible !== 'boolean'
    || !Array.isArray(record.eligibility.blocking_dependencies)
    || !Array.isArray(record.eligibility.target_dependencies)
    || !record.eligibility.completion_evidence
    || !Array.isArray(record.eligibility.completion_evidence.roadmap_complete)
    || !Array.isArray(record.eligibility.completion_evidence.scorecards)
    || !Array.isArray(record.eligibility.completion_evidence.local_terminal)
    || !record.roadmap || typeof record.roadmap.path !== 'string' || typeof record.roadmap.sha256 !== 'string'
    || typeof record.prior_state_sha256 !== 'string'
    || !isAuditSprintState(record.prior_state)
    || !isAuditSprintState(record.next_state)
    || record.claims_policy !== 'unchanged'
    || record.sessions_policy !== 'unchanged') {
    throw new SprintRolloverError('Existing rollover audit has an invalid shape; refusing to replace it.');
  }
  const complete = record as SprintRolloverAuditRecord;
  if (stateDigest(complete.prior_state) !== complete.prior_state_sha256
    || complete.transition_id !== transitionIdFromEvidence(
      complete.prior_state,
      complete.from_sprint,
      complete.to_sprint,
      complete.forced,
      complete.reason,
    )
    || complete.next_state.phase !== 'planning'
    || complete.next_state.sprint !== complete.to_sprint
    || complete.next_state.rollover?.transition_id !== complete.transition_id
    || complete.next_state.rollover?.from_sprint !== complete.from_sprint
    || complete.next_state.rollover?.recorded_at !== complete.recorded_at
    || complete.next_state.rollover?.forced !== complete.forced
    || (complete.next_state.rollover?.reason ?? '') !== (complete.reason ?? '')) {
    throw new SprintRolloverError('Existing rollover audit failed embedded state integrity checks.');
  }
  return complete;
}

function isAuditSprintState(value: unknown): value is SprintState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SprintState>;
  if (typeof state.sprint !== 'number' || typeof state.phase !== 'string'
    || typeof state.started_at !== 'string' || typeof state.updated_at !== 'string'
    || !state.gates || typeof state.gates !== 'object') return false;
  return ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md']
    .every(gate => typeof state.gates?.[gate as keyof SprintState['gates']] === 'boolean');
}

function assertAuditIdentity(
  record: SprintRolloverAuditRecord,
  assessment: SprintRolloverAssessment,
  priorState?: SprintState,
  currentTargetState?: SprintState,
): void {
  if (record.from_sprint !== assessment.from || record.to_sprint !== assessment.to) {
    throw new SprintRolloverError('Existing rollover audit records a different sprint transition.');
  }
  if (record.from_label !== assessment.from_label || record.to_label !== assessment.to_label) {
    throw new SprintRolloverError('Existing rollover audit records different sprint labels.');
  }
  if (record.forced !== assessment.forced || (record.reason ?? '') !== (assessment.reason ?? '')) {
    throw new SprintRolloverError('Existing rollover audit records different force or reason evidence.');
  }
  if (record.roadmap.path !== assessment.roadmap_path || record.roadmap.sha256 !== assessment.roadmap_sha256) {
    throw new SprintRolloverError('Existing rollover audit was prepared against different roadmap evidence.');
  }
  if (JSON.stringify(record.eligibility.completion_evidence) !== JSON.stringify(assessment.completion_evidence)
    || JSON.stringify(record.eligibility.blocking_dependencies) !== JSON.stringify(assessment.blocking_dependencies)
    || JSON.stringify(record.eligibility.target_dependencies) !== JSON.stringify(
      (assessment.to_sprint?.depends_on ?? []).map(id => roadmapSprintOrderValue(assessment.roadmap, id)),
    )
    || record.eligibility.from_terminal !== assessment.from_terminal
    || record.eligibility.target_dependency_eligible !== (assessment.blocking_dependencies.length === 0)
    || record.eligibility.expected_next !== assessment.expected_next) {
    throw new SprintRolloverError('Existing rollover audit records different dependency eligibility evidence.');
  }
  if (priorState && record.prior_state_sha256 !== stateDigest(priorState)) {
    throw new SprintRolloverError('Existing rollover audit does not match the current prior sprint state.');
  }
  if (currentTargetState && JSON.stringify(record.next_state) !== JSON.stringify(currentTargetState)) {
    throw new SprintRolloverError('Current target sprint state does not match the recorded rollover lineage.');
  }
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
  roadmap: RoadmapDefinition,
  record: SprintRolloverAuditRecord,
  currentScorecards: number[],
): void {
  const available = new Set(currentScorecards.map(id => roadmapSprintOrderValue(roadmap, id)));
  const missing = record.eligibility.completion_evidence.scorecards
    .filter(id => !available.has(roadmapSprintOrderValue(roadmap, id)));
  if (missing.length > 0) {
    throw new SprintRolloverError(`Existing rollover audit references missing scorecard evidence: ${missing.join(', ')}.`);
  }
}

function buildAuditRecord(
  assessment: SprintRolloverAssessment,
  priorState: SprintState,
  nextState: SprintState,
  actor: ResolvedActor,
  id: string,
  recordedAt: string,
): SprintRolloverAuditRecord {
  return {
    version: 1,
    kind: 'sprint_rollover',
    transition_id: id,
    from_sprint: assessment.from,
    to_sprint: assessment.to,
    from_label: assessment.from_label,
    to_label: assessment.to_label,
    recorded_at: recordedAt,
    actor: { name: actor.name, source: actor.source },
    forced: assessment.forced,
    ...(assessment.reason ? { reason: assessment.reason } : {}),
    eligibility: {
      from_terminal: assessment.from_terminal,
      target_dependency_eligible: assessment.blocking_dependencies.length === 0,
      blocking_dependencies: assessment.blocking_dependencies,
      target_dependencies: (assessment.to_sprint?.depends_on ?? [])
        .map(id => roadmapSprintOrderValue(assessment.roadmap, id)),
      completion_evidence: assessment.completion_evidence,
      expected_next: assessment.expected_next!,
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
}

export function performSprintRollover(
  cwd: string,
  input: SprintRolloverInput,
  actor: ResolvedActor,
): SprintRolloverResult {
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
    // Roadmap and completion evidence are intentionally reloaded under the
    // sprint-state lock so eligibility cannot drift between assessment and
    // replacement.
    const loaded = loadRolloverRoadmap(cwd);
    const completed = loadScorecards(loadConfig(cwd), cwd).map(card => card.sprint_number);
    const target = roadmapSprintById(loaded.roadmap, input.to);
    if (target && roadmapIdsEqual(loaded.roadmap, current.sprint, target.id)) {
      const lineage = current.rollover;
      if (!lineage || !roadmapIdsEqual(loaded.roadmap, lineage.from_sprint, input.from)) {
        throw new SprintRolloverError(`${formatRoadmapSprintLabel(loaded.roadmap, target.id)} state already exists but has no matching rollover lineage.`);
      }
      if (!lineage.audit_path || isAbsolute(lineage.audit_path)) {
        throw new SprintRolloverError('Current rollover lineage does not contain a repository-relative audit path.');
      }
      const lineageAuditPath = ensureTrackedPath(cwd, resolve(cwd, lineage.audit_path));
      if (!existsSync(lineageAuditPath)) {
        throw new SprintRolloverError(`${formatRoadmapSprintLabel(loaded.roadmap, target.id)} state already exists but its rollover audit is missing.`);
      }
      const recovered = readAudit(lineageAuditPath);
      assertAuditPathIdentity(cwd, lineageAuditPath, recovered);
      assertRecordedScorecardEvidenceAvailable(loaded.roadmap, recovered, completed);
      const assessment = assessSprintRollover(
        recovered.prior_state,
        loaded.roadmap,
        loaded.path,
        input,
        recovered.eligibility.completion_evidence.scorecards,
        loaded.sha256,
      );
      if (!assessment.valid) {
        throw new SprintRolloverError(
          `Existing rollover audit eligibility is invalid: ${assessment.issues.map(issue => issue.message).join(' ')}`,
          assessment,
        );
      }
      assertAuditIdentity(recovered, assessment, undefined, current);
      if (lineage.transition_id !== recovered.transition_id
        || lineage.recorded_at !== recovered.recorded_at
        || lineage.forced !== recovered.forced
        || (lineage.reason ?? '') !== (recovered.reason ?? '')
        || lineage.audit_path.replaceAll('\\', '/') !== relative(cwd, lineageAuditPath).replaceAll('\\', '/')) {
        throw new SprintRolloverError('Current rollover lineage does not match its tracked audit record.');
      }
      record = recovered;
      resolvedAuditPath = lineageAuditPath;
      alreadyApplied = true;
      return null;
    }

    const assessment = assessSprintRollover(
      current,
      loaded.roadmap,
      loaded.path,
      input,
      completed,
      loaded.sha256,
    );
    if (!assessment.valid) {
      throw new SprintRolloverError(assessment.issues.map(issue => issue.message).join('\n'), assessment);
    }
    const id = transitionId(assessment, current);
    const auditPath = auditPathFor(cwd, assessment, id);
    const auditRelativePath = relative(cwd, auditPath).replaceAll('\\', '/');
    resolvedAuditPath = auditPath;

    record = withFileLockSync(auditPath, () => {
      if (existsSync(auditPath)) {
        const existing = readAudit(auditPath);
        assertAuditPathIdentity(cwd, auditPath, existing);
        assertRecordedScorecardEvidenceAvailable(loaded.roadmap, existing, completed);
        const recordedAssessment = assessSprintRollover(
          current,
          loaded.roadmap,
          loaded.path,
          input,
          existing.eligibility.completion_evidence.scorecards,
          loaded.sha256,
        );
        if (!recordedAssessment.valid) {
          throw new SprintRolloverError(
            `Existing rollover audit eligibility is invalid: ${recordedAssessment.issues.map(issue => issue.message).join(' ')}`,
            recordedAssessment,
          );
        }
        assertAuditIdentity(existing, recordedAssessment, current);
        return existing;
      }

      const recordedAt = new Date().toISOString();
      const nextState = createSprintState(assessment.to, 'planning');
      const lineage: SprintRolloverLineage = {
        transition_id: id,
        from_sprint: assessment.from,
        audit_path: auditRelativePath,
        recorded_at: recordedAt,
        forced: assessment.forced,
        ...(assessment.reason ? { reason: assessment.reason } : {}),
      };
      nextState.rollover = lineage;
      const created = buildAuditRecord(assessment, current, nextState, actor, id, recordedAt);
      atomicWriteFileSync(auditPath, JSON.stringify(created, null, 2) + '\n');
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
