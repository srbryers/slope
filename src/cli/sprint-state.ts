import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { resolveRepoStatePath } from '../core/repo-state-scope.js';
import { sprintIdKey, sprintIdsEqual, type SprintId } from '../core/sprint-id.js';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';
import { listRepoWorktrees } from './session-scope.js';

/** Sprint lifecycle phases */
export const SPRINT_PHASES = ['planning', 'reviewing', 'implementing', 'scoring', 'complete'] as const;
export type SprintPhase = typeof SPRINT_PHASES[number];

/** Gate names that must be completed before PR */
export type GateName = 'tests' | 'code_review' | 'architect_review' | 'scorecard' | 'review_md';
export type ReviewGateName = Extract<GateName, 'code_review' | 'architect_review'>;
export type ReviewGateProvenance = 'pending' | 'self_review' | 'independent_review' | 'independent_review_waived' | 'manual_override' | 'pr_review';
export type ReviewGateCompletionProvenance = Exclude<ReviewGateProvenance, 'pending'>;
export type ReviewGatePriority = 'required' | 'recommended' | 'optional' | 'unspecified';
export type ReviewGateVerdict = 'pass' | 'changes_requested' | 'blocked';

export interface ReviewGateRequirement {
  priority: ReviewGatePriority;
  reason?: string;
  source?: string;
  updated_at?: string;
}

export interface ReviewGateRequirementInput {
  gate: ReviewGateName;
  priority: Exclude<ReviewGatePriority, 'unspecified'>;
  reason?: string;
  source?: string;
}

export interface ReviewGateState {
  provenance: ReviewGateProvenance;
  evidence: string[];
  reviewer?: string;
  notes?: string;
  verdict?: ReviewGateVerdict;
  packet?: string;
  reviewed_commit?: string;
  token_budget?: string;
  tokens_used?: number;
  over_budget_reason?: string;
  updated_at?: string;
}

export interface ReviewGateCompletionInput {
  provenance: ReviewGateCompletionProvenance;
  evidence?: string[];
  reviewer?: string;
  notes?: string;
  verdict?: ReviewGateVerdict;
  packet?: string;
  reviewed_commit?: string;
  token_budget?: string;
  tokens_used?: number;
  over_budget_reason?: string;
}

export interface UpdateGateOptions {
  review?: ReviewGateCompletionInput;
}

/** Human-readable labels for gates */
const GATE_LABELS: Record<GateName, string> = {
  tests: 'Tests passing',
  code_review: 'Code review',
  architect_review: 'Architect review',
  scorecard: 'Scorecard validated',
  review_md: 'Review markdown generated',
};

/** Sprint state persisted to .slope/sprint-state.json */
export interface SprintState {
  /** Canonical sprint key. Legacy numeric files normalize at load time. */
  sprint: string;
  phase: SprintPhase;
  gates: Record<GateName, boolean>;
  review_gates: Record<ReviewGateName, ReviewGateState>;
  review_requirements?: Record<ReviewGateName, ReviewGateRequirement>;
  started_at: string;
  updated_at: string;
  rollover?: SprintRolloverLineage;
}

export interface SprintRolloverLineage {
  transition_id: string;
  from_sprint: string;
  audit_path: string;
  recorded_at: string;
  forced: boolean;
  reason?: string;
}

export type SprintStateLoadResult =
  | { status: 'missing' }
  | { status: 'corrupt'; path: string }
  | { status: 'valid'; state: SprintState };

export type SprintStateInitializationResult =
  | { status: 'created'; state: SprintState }
  | { status: 'existing'; state: SprintState }
  | { status: 'corrupt'; path: string };

const SPRINT_STATE_FILE = '.slope/sprint-state.json';

const ALL_GATES: GateName[] = ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md'];
const REVIEW_GATES: ReviewGateName[] = ['code_review', 'architect_review'];
const REVIEW_GATE_PROVENANCES: readonly ReviewGateProvenance[] = [
  'pending',
  'self_review',
  'independent_review',
  'independent_review_waived',
  'manual_override',
  'pr_review',
];

/** Validate a user-provided sprint lifecycle phase. */
export function isSprintPhase(value: string): value is SprintPhase {
  return (SPRINT_PHASES as readonly string[]).includes(value);
}

export function isReviewGateName(value: string): value is ReviewGateName {
  return (REVIEW_GATES as readonly string[]).includes(value);
}

function createDefaultReviewGateState(): ReviewGateState {
  return { provenance: 'pending', evidence: [] };
}

export function createDefaultReviewGates(): Record<ReviewGateName, ReviewGateState> {
  return {
    code_review: createDefaultReviewGateState(),
    architect_review: createDefaultReviewGateState(),
  };
}

function createDefaultReviewGateRequirement(): ReviewGateRequirement {
  return { priority: 'unspecified' };
}

export function createDefaultReviewRequirements(): Record<ReviewGateName, ReviewGateRequirement> {
  return {
    code_review: createDefaultReviewGateRequirement(),
    architect_review: createDefaultReviewGateRequirement(),
  };
}

function normalizeReviewGateState(raw: unknown): ReviewGateState {
  if (!raw || typeof raw !== 'object') return createDefaultReviewGateState();
  const obj = raw as Partial<ReviewGateState>;
  const provenance = typeof obj.provenance === 'string' &&
    REVIEW_GATE_PROVENANCES.includes(obj.provenance as ReviewGateProvenance)
    ? obj.provenance as ReviewGateProvenance
    : 'pending';
  return {
    provenance,
    evidence: Array.isArray(obj.evidence) ? obj.evidence.filter((item): item is string => typeof item === 'string') : [],
    ...(typeof obj.reviewer === 'string' ? { reviewer: obj.reviewer } : {}),
    ...(typeof obj.notes === 'string' ? { notes: obj.notes } : {}),
    ...(isReviewGateVerdict(obj.verdict) ? { verdict: obj.verdict } : {}),
    ...(typeof obj.packet === 'string' ? { packet: obj.packet } : {}),
    ...(typeof obj.reviewed_commit === 'string' ? { reviewed_commit: obj.reviewed_commit } : {}),
    ...(typeof obj.token_budget === 'string' ? { token_budget: obj.token_budget } : {}),
    ...(typeof obj.tokens_used === 'number' && Number.isFinite(obj.tokens_used) ? { tokens_used: obj.tokens_used } : {}),
    ...(typeof obj.over_budget_reason === 'string' ? { over_budget_reason: obj.over_budget_reason } : {}),
    ...(typeof obj.updated_at === 'string' ? { updated_at: obj.updated_at } : {}),
  };
}

function normalizeReviewGates(raw: unknown): Record<ReviewGateName, ReviewGateState> {
  const reviewGates = createDefaultReviewGates();
  if (!raw || typeof raw !== 'object') return reviewGates;
  const obj = raw as Partial<Record<ReviewGateName, unknown>>;
  for (const gate of REVIEW_GATES) {
    reviewGates[gate] = normalizeReviewGateState(obj[gate]);
  }
  return reviewGates;
}

function normalizeReviewGateRequirement(raw: unknown): ReviewGateRequirement {
  if (!raw || typeof raw !== 'object') return createDefaultReviewGateRequirement();
  const obj = raw as Partial<ReviewGateRequirement>;
  const priority = obj.priority === 'required' || obj.priority === 'recommended' || obj.priority === 'optional'
    ? obj.priority
    : 'unspecified';
  return {
    priority,
    ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}),
    ...(typeof obj.source === 'string' ? { source: obj.source } : {}),
    ...(typeof obj.updated_at === 'string' ? { updated_at: obj.updated_at } : {}),
  };
}

function normalizeReviewRequirements(raw: unknown): Record<ReviewGateName, ReviewGateRequirement> {
  const requirements = createDefaultReviewRequirements();
  if (!raw || typeof raw !== 'object') return requirements;
  const obj = raw as Partial<Record<ReviewGateName, unknown>>;
  for (const gate of REVIEW_GATES) {
    requirements[gate] = normalizeReviewGateRequirement(obj[gate]);
  }
  return requirements;
}

function cleanEvidence(evidence: string[] | undefined): string[] {
  return (evidence ?? []).map(item => item.trim()).filter(Boolean);
}

export function isReviewGateVerdict(value: unknown): value is ReviewGateVerdict {
  return value === 'pass' || value === 'changes_requested' || value === 'blocked';
}

export function validateReviewGateCompletion(input: ReviewGateCompletionInput | undefined): string | null {
  if (!input) {
    return 'review gate requires explicit independent-review evidence, PR review evidence, or weaker-mode override';
  }

  const evidence = cleanEvidence(input.evidence);
  const reviewer = input.reviewer?.trim();
  const notes = input.notes?.trim();

  switch (input.provenance) {
    case 'independent_review':
      if (!reviewer) return 'independent review gates require --reviewer=<agent-or-person>';
      if (evidence.length === 0) return 'independent review gates require --evidence=<transcript-or-output>';
      if (input.verdict === 'changes_requested') return 'review gate evidence verdict is changes_requested; record a PASS re-review or use an explicit waiver/override';
      if (input.verdict === 'blocked') return 'review gate evidence verdict is blocked; resolve the blocker or use an explicit waiver/override';
      return null;
    case 'pr_review':
      if (evidence.length === 0) return 'PR review gates require --pr-review=<url-or-id>';
      if (input.verdict === 'changes_requested') return 'PR review evidence verdict is changes_requested; record a resolved PASS review or use an explicit waiver/override';
      if (input.verdict === 'blocked') return 'PR review evidence verdict is blocked; resolve the blocker or use an explicit waiver/override';
      return null;
    case 'self_review':
      if (!notes) return 'self-review gates require --reason=<why-self-review-is-acceptable>';
      return null;
    case 'independent_review_waived':
      if (!notes) return 'independent-review waivers require --reason=<why-the-downgrade-is-accepted>';
      return null;
    case 'manual_override':
      if (!notes) return 'manual review overrides require --override=<reason>';
      return null;
  }
}

function createReviewGateCompletionState(input: ReviewGateCompletionInput | undefined): ReviewGateState | null {
  if (validateReviewGateCompletion(input)) return null;
  if (!input) return null;
  const reviewer = input.reviewer?.trim();
  const notes = input.notes?.trim();
  return {
    provenance: input.provenance,
    evidence: cleanEvidence(input.evidence),
    ...(reviewer ? { reviewer } : {}),
    ...(notes ? { notes } : {}),
    ...(input.verdict ? { verdict: input.verdict } : {}),
    ...(input.packet?.trim() ? { packet: input.packet.trim() } : {}),
    ...(input.reviewed_commit?.trim() ? { reviewed_commit: input.reviewed_commit.trim() } : {}),
    ...(input.token_budget?.trim() ? { token_budget: input.token_budget.trim() } : {}),
    ...(typeof input.tokens_used === 'number' && Number.isFinite(input.tokens_used) ? { tokens_used: input.tokens_used } : {}),
    ...(input.over_budget_reason?.trim() ? { over_budget_reason: input.over_budget_reason.trim() } : {}),
    updated_at: new Date().toISOString(),
  };
}

export function isReviewGateSatisfied(state: SprintState, gate: ReviewGateName): boolean {
  if (!state.gates[gate]) return false;
  const review = state.review_gates?.[gate];
  if (!review || review.provenance === 'pending') return false;
  return validateReviewGateCompletion({
    provenance: review.provenance,
    evidence: review.evidence,
    reviewer: review.reviewer,
    notes: review.notes,
    verdict: review.verdict,
  }) === null;
}

export function isRequiredReviewGate(state: SprintState, gate: ReviewGateName): boolean {
  return state.review_requirements?.[gate]?.priority === 'required';
}

export function waivedReviewGateNames(state: SprintState): ReviewGateName[] {
  return REVIEW_GATES.filter(gate =>
    state.gates[gate] === true && state.review_gates?.[gate]?.provenance === 'independent_review_waived',
  );
}

/** Load sprint state from .slope/sprint-state.json. Returns null if missing or malformed. */
export function loadSprintState(cwd: string): SprintState | null {
  const statePath = sprintStatePath(cwd);
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    const sprint = sprintIdKey(raw.sprint as SprintId);
    if (sprint === null || typeof raw.phase !== 'string' || typeof raw.gates !== 'object') {
      return null;
    }
    // Validate all 5 gate keys exist and are booleans
    for (const gate of ALL_GATES) {
      if (typeof raw.gates[gate] !== 'boolean') {
        return null;
      }
    }
    return {
      ...raw,
      sprint,
      ...(raw.rollover ? {
        rollover: {
          ...raw.rollover,
          from_sprint: sprintIdKey(raw.rollover.from_sprint as SprintId),
        },
      } : {}),
      review_gates: normalizeReviewGates(raw.review_gates),
      review_requirements: normalizeReviewRequirements(raw.review_requirements),
    } as SprintState;
  } catch {
    return null;
  }
}

function validOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function validEvidenceTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

/** Strict persisted-state shape used at mutation and rollover trust boundaries. */
export function isValidSprintStateEvidence(value: unknown): value is SprintState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<SprintState>;
  if (typeof state.sprint !== 'string' || sprintIdKey(state.sprint) === null
    || typeof state.phase !== 'string' || !isSprintPhase(state.phase)
    || !validEvidenceTimestamp(state.started_at) || !validEvidenceTimestamp(state.updated_at)
    || !state.gates || typeof state.gates !== 'object') return false;
  if (!ALL_GATES.every(gate => typeof state.gates?.[gate] === 'boolean')) return false;

  if (state.review_gates !== undefined) {
    if (!state.review_gates || typeof state.review_gates !== 'object') return false;
    for (const gate of REVIEW_GATES) {
      const review = state.review_gates[gate];
      if (!review || typeof review !== 'object'
        || !REVIEW_GATE_PROVENANCES.includes(review.provenance)
        || !Array.isArray(review.evidence) || review.evidence.some(item => typeof item !== 'string')
        || !validOptionalString(review.reviewer) || !validOptionalString(review.notes)
        || (review.verdict !== undefined && !isReviewGateVerdict(review.verdict))
        || !validOptionalString(review.packet)
        || !validOptionalString(review.reviewed_commit)
        || !validOptionalString(review.token_budget)
        || (review.tokens_used !== undefined && (typeof review.tokens_used !== 'number' || !Number.isFinite(review.tokens_used)))
        || !validOptionalString(review.over_budget_reason)
        || (review.updated_at !== undefined && !validEvidenceTimestamp(review.updated_at))) return false;
    }
  }

  if (state.review_requirements !== undefined) {
    if (!state.review_requirements || typeof state.review_requirements !== 'object') return false;
    for (const gate of REVIEW_GATES) {
      const requirement = state.review_requirements[gate];
      if (!requirement || typeof requirement !== 'object'
        || !['required', 'recommended', 'optional', 'unspecified'].includes(requirement.priority)
        || !validOptionalString(requirement.reason) || !validOptionalString(requirement.source)
        || (requirement.updated_at !== undefined && !validEvidenceTimestamp(requirement.updated_at))) return false;
    }
  }

  if (state.rollover !== undefined) {
    const lineage = state.rollover;
    const portablePath = typeof lineage.audit_path === 'string' ? lineage.audit_path.replaceAll('\\', '/') : '';
    if (typeof lineage.transition_id !== 'string' || !/^[a-f0-9]{16}$/.test(lineage.transition_id)
      || typeof lineage.from_sprint !== 'string' || sprintIdKey(lineage.from_sprint) === null
      || !portablePath || isAbsolute(portablePath) || portablePath.split('/').includes('..')
      || !validEvidenceTimestamp(lineage.recorded_at)
      || typeof lineage.forced !== 'boolean'
      || !validOptionalString(lineage.reason)) return false;
  }
  return true;
}

/** Distinguish absent local state from corrupt evidence that must fail closed. */
export function loadSprintStateResult(cwd: string): SprintStateLoadResult {
  const path = sprintStatePath(cwd);
  if (!existsSync(path)) return { status: 'missing' };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const normalized = {
      ...raw,
      sprint: sprintIdKey(raw.sprint as SprintId),
      ...(raw.rollover ? {
        rollover: {
          ...raw.rollover,
          from_sprint: sprintIdKey(raw.rollover.from_sprint as SprintId),
        },
      } : {}),
    };
    if (!isValidSprintStateEvidence(normalized)) return { status: 'corrupt', path };
  } catch {
    return { status: 'corrupt', path };
  }
  const state = loadSprintState(cwd);
  return state ? { status: 'valid', state } : { status: 'corrupt', path };
}

/** True when sprint-state represents an active workflow sprint. */
export function isActiveSprintState(state: SprintState | null): state is SprintState {
  return Boolean(state && state.phase !== 'complete' && !isSprintComplete(state));
}

function sprintStatePath(cwd: string): string {
  return resolveRepoStatePath(cwd, SPRINT_STATE_FILE);
}

/** Where sprint state actually lives for this checkout, repo-relative where
 *  possible. In a linked worktree this resolves to the primary checkout, so a
 *  caller reporting the write must not hardcode the default path. */
export function sprintStateLocation(cwd: string): string {
  const path = sprintStatePath(cwd);
  const rel = relative(cwd, path);
  return rel.startsWith('..') ? path : rel.replace(/\\/g, '/');
}

function saveSprintStateUnlocked(filePath: string, state: SprintState, touchUpdatedAt = true): void {
  if (touchUpdatedAt) state.updated_at = new Date().toISOString();
  atomicWriteFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

/** Save sprint state atomically via unique tmp + rename. */
export function saveSprintState(cwd: string, state: SprintState): void {
  const filePath = sprintStatePath(cwd);
  withFileLockSync(filePath, () => saveSprintStateUnlocked(filePath, state));
}

/** Mutate sprint state while holding the state file lock. Returns null if missing/corrupt. */
export function mutateSprintState(cwd: string, mutator: (state: SprintState) => boolean): SprintState | null {
  const filePath = sprintStatePath(cwd);
  return withFileLockSync(filePath, () => {
    const loaded = loadSprintStateResult(cwd);
    if (loaded.status !== 'valid') return null;
    const state = loaded.state;
    if (mutator(state)) {
      saveSprintStateUnlocked(filePath, state);
    }
    return state;
  });
}

/** Update a single gate and save. Returns false when a review gate lacks required provenance. */
export function updateGate(cwd: string, gate: GateName, value: boolean, options: UpdateGateOptions = {}): boolean {
  let updated = false;
  const state = mutateSprintState(cwd, current => {
    if (isReviewGateName(gate)) {
      current.review_gates ??= createDefaultReviewGates();
      if (!value) {
        current.gates[gate] = false;
        current.review_gates[gate] = createDefaultReviewGateState();
        updated = true;
        return true;
      } else {
        const required = current.review_requirements?.[gate]?.priority === 'required';
        const provenance = options.review?.provenance;
        if (required && (provenance === 'self_review' || provenance === 'manual_override')) return false;
        if (!required && provenance === 'independent_review_waived') return false;
        const review = createReviewGateCompletionState(options.review);
        if (!review) return false;
        current.gates[gate] = true;
        current.review_gates[gate] = review;
        updated = true;
        return true;
      }
    }
    current.gates[gate] = value;
    updated = true;
    return true;
  });
  return Boolean(state && updated);
}

/** Create sprint state only when the tracked local slot is truly absent. */
export function initializeSprintState(
  cwd: string,
  state: SprintState,
): SprintStateInitializationResult {
  const filePath = sprintStatePath(cwd);
  return withFileLockSync(filePath, () => {
    const loaded = loadSprintStateResult(cwd);
    if (loaded.status === 'valid') return { status: 'existing', state: loaded.state };
    if (loaded.status === 'corrupt') return loaded;
    saveSprintStateUnlocked(filePath, state, false);
    return { status: 'created', state };
  });
}

export interface SprintStateReplacement {
  previous: SprintState;
  current: SprintState;
  replaced: boolean;
}

/**
 * Replace sprint state while holding the same lock used by ordinary mutations.
 * The replacer may persist prerequisite audit evidence before returning the
 * new state. Returning null leaves the current state untouched.
 */
export function replaceSprintState(
  cwd: string,
  replacer: (state: SprintState) => SprintState | null,
): SprintStateReplacement | null {
  const filePath = sprintStatePath(cwd);
  return withFileLockSync(filePath, () => {
    const loaded = loadSprintStateResult(cwd);
    if (loaded.status !== 'valid') {
      if (loaded.status === 'corrupt') throw new Error(`Sprint state is corrupt and was preserved at ${filePath}.`);
      return null;
    }
    const previous = loaded.state;
    const next = replacer(previous);
    if (!next) return { previous, current: previous, replaced: false };
    saveSprintStateUnlocked(filePath, next, false);
    return { previous, current: next, replaced: true };
  });
}

/** Persist review priorities inferred by `slope review recommend` for the matching active sprint. */
export function updateReviewRequirements(
  cwd: string,
  sprint: SprintId,
  inputs: ReviewGateRequirementInput[],
): boolean {
  let updated = false;
  const state = mutateSprintState(cwd, current => {
    if (!sprintIdsEqual(current.sprint, sprint)) return false;
    current.review_requirements ??= createDefaultReviewRequirements();
    const now = new Date().toISOString();
    for (const input of inputs) {
      current.review_requirements[input.gate] = {
        priority: input.priority,
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        source: input.source?.trim() || 'review_recommend',
        updated_at: now,
      };
    }
    updated = true;
    return true;
  });
  return Boolean(state && updated);
}

/** Update the current sprint lifecycle phase. */
export function updateSprintPhase(cwd: string, phase: SprintPhase): SprintState | null {
  return mutateSprintState(cwd, state => {
    state.phase = phase;
    return true;
  });
}

export interface ConditionalSprintPhaseUpdate {
  state: SprintState | null;
  matched: boolean;
  changed: boolean;
}

/** Update phase only if the state still represents the observed sprint. */
export function updateSprintPhaseForSprint(
  cwd: string,
  expectedSprint: SprintId,
  phase: SprintPhase,
): ConditionalSprintPhaseUpdate {
  let matched = false;
  let changed = false;
  const state = mutateSprintState(cwd, current => {
    if (!sprintIdsEqual(current.sprint, expectedSprint)) return false;
    matched = true;
    if (current.phase === phase) return false;
    current.phase = phase;
    changed = true;
    return true;
  });
  return { state, matched, changed };
}

export interface WorktreePhaseReconcile {
  /** Checkout root whose sprint state was inspected. */
  path: string;
  /** True when that checkout's state was for the expected sprint. */
  matched: boolean;
  /** True when the phase actually changed. */
  changed: boolean;
}

/**
 * Apply a conditional phase update to every checkout of this repository.
 *
 * Sprint state is per checkout, so reconciling only `cwd` left sibling worktrees
 * reporting an already-merged sprint as still in progress — agents then received
 * contradictory next actions and could restart completed work (GH #624).
 * Checkouts whose state is for a different sprint are reported as unmatched and
 * left untouched, so unrelated in-flight work is never clobbered.
 */
export function updateSprintPhaseForSprintAcrossWorktrees(
  cwd: string,
  expectedSprint: SprintId,
  phase: SprintPhase,
): WorktreePhaseReconcile[] {
  const results: WorktreePhaseReconcile[] = [];
  const inspected = new Set<string>();
  for (const root of listRepoWorktrees(cwd)) {
    const statePath = sprintStatePath(root);
    if (inspected.has(statePath)) continue;
    inspected.add(statePath);
    if (!existsSync(statePath)) continue;
    try {
      const { matched, changed } = updateSprintPhaseForSprint(root, expectedSprint, phase);
      results.push({ path: root, matched, changed });
    } catch {
      // A locked or unreadable sibling checkout must not fail the closeout.
      results.push({ path: root, matched: false, changed: false });
    }
  }
  return results;
}

/** Check if all gates are true. */
export function isSprintComplete(state: SprintState): boolean {
  return ALL_GATES.every(g => {
    if (state.gates[g] !== true) return false;
    return !isReviewGateName(g) || isReviewGateSatisfied(state, g);
  });
}

/** Return machine-readable names of incomplete gates. */
export function pendingGateNames(state: SprintState): GateName[] {
  return ALL_GATES
    .filter(g => state.gates[g] !== true || (isReviewGateName(g) && !isReviewGateSatisfied(state, g)));
}

/** Return human-readable list of incomplete gates. */
export function pendingGates(state: SprintState): string[] {
  return pendingGateNames(state).map(g => GATE_LABELS[g]);
}

/** Create a fresh sprint state with all gates false. */
export function createSprintState(sprint: SprintId, phase: SprintPhase = 'planning'): SprintState {
  const sprintKey = sprintIdKey(sprint);
  if (sprintKey === null) throw new Error(`Invalid sprint id: ${String(sprint)}`);
  const now = new Date().toISOString();
  return {
    sprint: sprintKey,
    phase,
    gates: {
      tests: false,
      code_review: false,
      architect_review: false,
      scorecard: false,
      review_md: false,
    },
    review_gates: createDefaultReviewGates(),
    review_requirements: createDefaultReviewRequirements(),
    started_at: now,
    updated_at: now,
  };
}

/** Delete the sprint state file. */
export function clearSprintState(cwd: string): void {
  const statePath = sprintStatePath(cwd);
  if (!existsSync(statePath)) return;
  withFileLockSync(statePath, () => {
    if (existsSync(statePath)) unlinkSync(statePath);
  });
}
