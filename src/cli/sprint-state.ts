import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Sprint lifecycle phases */
export type SprintPhase = 'planning' | 'reviewing' | 'implementing' | 'scoring' | 'complete';

/** Gate names that must be completed before PR */
export type GateName = 'tests' | 'code_review' | 'architect_review' | 'scorecard' | 'review_md';

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
  started_at: string;
  updated_at: string;
}

const SPRINT_STATE_FILE = '.slope/sprint-state.json';

const ALL_GATES: GateName[] = ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md'];

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
    return raw as SprintState;
  } catch {
    return null;
  }
}

/** Save sprint state atomically via tmp + rename. */
export function saveSprintState(cwd: string, state: SprintState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });

  state.updated_at = new Date().toISOString();

  const filePath = join(cwd, SPRINT_STATE_FILE);
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmpPath, filePath);
}

/** Update a single gate and save. */
export function updateGate(cwd: string, gate: GateName, value: boolean): void {
  const state = loadSprintState(cwd);
  if (!state) return;
  state.gates[gate] = value;
  saveSprintState(cwd, state);
}

/** Check if all gates are true. */
export function isSprintComplete(state: SprintState): boolean {
  return ALL_GATES.every(g => state.gates[g] === true);
}

/** Return human-readable list of incomplete gates. */
export function pendingGates(state: SprintState): string[] {
  return ALL_GATES
    .filter(g => !state.gates[g])
    .map(g => GATE_LABELS[g]);
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
    started_at: now,
    updated_at: now,
  };
}

/** Delete the sprint state file. */
export function clearSprintState(cwd: string): void {
  const statePath = join(cwd, SPRINT_STATE_FILE);
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}
