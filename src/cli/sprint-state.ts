import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';

/** Sprint lifecycle phases */
export const SPRINT_PHASES = ['planning', 'reviewing', 'implementing', 'scoring', 'complete'] as const;
export type SprintPhase = typeof SPRINT_PHASES[number];

/** Gate names that must be completed before PR */
export type GateName = 'tests' | 'code_review' | 'architect_review' | 'scorecard' | 'review_md';
export type ReviewGateName = Extract<GateName, 'code_review' | 'architect_review'>;
export type ReviewGateProvenance = 'pending' | 'self_review' | 'independent_review' | 'independent_review_waived' | 'manual_override' | 'pr_review';
export type ReviewGateCompletionProvenance = Exclude<ReviewGateProvenance, 'pending'>;
export type ReviewGatePriority = 'required' | 'recommended' | 'optional' | 'unspecified';

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
  updated_at?: string;
}

export interface ReviewGateCompletionInput {
  provenance: ReviewGateCompletionProvenance;
  evidence?: string[];
  reviewer?: string;
  notes?: string;
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
  sprint: number;
  phase: SprintPhase;
  gates: Record<GateName, boolean>;
  review_gates: Record<ReviewGateName, ReviewGateState>;
  review_requirements?: Record<ReviewGateName, ReviewGateRequirement>;
  started_at: string;
  updated_at: string;
}

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
      return null;
    case 'pr_review':
      if (evidence.length === 0) return 'PR review gates require --pr-review=<url-or-id>';
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
  const statePath = join(cwd, SPRINT_STATE_FILE);
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    // Validate shape
    if (typeof raw.sprint !== 'number' || typeof raw.phase !== 'string' || typeof raw.gates !== 'object') {
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
      review_gates: normalizeReviewGates(raw.review_gates),
      review_requirements: normalizeReviewRequirements(raw.review_requirements),
    } as SprintState;
  } catch {
    return null;
  }
}

/** True when sprint-state represents an active workflow sprint. */
export function isActiveSprintState(state: SprintState | null): state is SprintState {
  return Boolean(state && state.phase !== 'complete' && !isSprintComplete(state));
}

function sprintStatePath(cwd: string): string {
  return join(cwd, SPRINT_STATE_FILE);
}

function saveSprintStateUnlocked(filePath: string, state: SprintState): void {
  state.updated_at = new Date().toISOString();
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
    const state = loadSprintState(cwd);
    if (!state) return null;
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

/** Persist review priorities inferred by `slope review recommend` for the matching active sprint. */
export function updateReviewRequirements(
  cwd: string,
  sprint: number,
  inputs: ReviewGateRequirementInput[],
): boolean {
  let updated = false;
  const state = mutateSprintState(cwd, current => {
    if (current.sprint !== sprint) return false;
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
export function createSprintState(sprint: number, phase: SprintPhase = 'planning'): SprintState {
  const now = new Date().toISOString();
  return {
    sprint,
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
