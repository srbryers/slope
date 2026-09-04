import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { detectPackageManager } from '../core/analyzers/stack.js';

const PHASE_CLEANUP_FILE = '.slope/phase-cleanup.json';

/** Gate names, without the bookkeeping field. */
export type PhaseGateName = 'scorecards_verified'
  | 'handicap_generated'
  | 'map_refreshed'
  | 'findings_audited'
  | 'regression_passed';

export const PHASE_GATE_NAMES: readonly PhaseGateName[] = [
  'scorecards_verified',
  'handicap_generated',
  'map_refreshed',
  'findings_audited',
  'regression_passed',
];

/**
 * The regression command for this project.
 *
 * Was hardcoded to `bun test` in the gate label, so a pnpm project was told to
 * run a tool it does not have, and the reporter's passing test run could not
 * satisfy the gate it had just earned (#696). `test` is the script name in
 * every one of these package managers, so only the runner differs.
 */
export function regressionCommand(cwd: string): string {
  const pm = detectPackageManager(cwd);
  if (!pm) return 'npm test';
  return pm === 'bun' ? 'bun test' : `${pm} test`;
}

export interface PhaseCleanupGates {
  completed_at?: string;
  scorecards_verified: boolean;
  handicap_generated: boolean;
  map_refreshed: boolean;
  findings_audited: boolean;
  regression_passed: boolean;
}

interface PhaseCleanupState {
  phases: Record<string, PhaseCleanupGates>;
}

const DEFAULT_GATES: PhaseCleanupGates = {
  scorecards_verified: false,
  handicap_generated: false,
  map_refreshed: false,
  findings_audited: false,
  regression_passed: false,
};

/** Load phase cleanup state. Returns empty state if missing/corrupt. */
export function loadPhaseCleanup(cwd: string): PhaseCleanupState {
  const statePath = join(cwd, PHASE_CLEANUP_FILE);
  if (!existsSync(statePath)) return { phases: {} };
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    if (raw && typeof raw.phases === 'object') return raw as PhaseCleanupState;
    return { phases: {} };
  } catch {
    return { phases: {} };
  }
}

/** Save phase cleanup state atomically via tmp + rename. */
export function savePhaseCleanup(cwd: string, state: PhaseCleanupState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });

  const filePath = join(cwd, PHASE_CLEANUP_FILE);
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmpPath, filePath);
}

/** Check if a phase has all cleanup gates complete. */
export function isPhaseComplete(cwd: string, phase: number): boolean {
  const state = loadPhaseCleanup(cwd);
  const gates = state.phases[String(phase)];
  if (!gates) return false;
  return gates.scorecards_verified &&
    gates.handicap_generated &&
    gates.map_refreshed &&
    gates.findings_audited &&
    gates.regression_passed;
}

/**
 * Gate labels, each naming the command that records it.
 *
 * Every label points at a command that now writes its own gate, so the
 * documented workflow reaches the boundary without `phase complete` (#696).
 */
export function phaseGateLabels(cwd: string): Record<PhaseGateName, string> {
  return {
    scorecards_verified: 'Scorecards verified (`slope validate`)',
    handicap_generated: 'Handicap card generated (`slope card`)',
    map_refreshed: 'Codebase map refreshed (`slope map`)',
    findings_audited: 'Deferred findings audited (`slope phase audit`)',
    regression_passed: `Regression passed (\`slope phase regression\`, runs \`${regressionCommand(cwd)}\`)`,
  };
}

/** Get incomplete gates for a phase. Returns human-readable list. */
export function pendingPhaseGates(cwd: string, phase: number): string[] {
  const state = loadPhaseCleanup(cwd);
  const gates = state.phases[String(phase)] ?? DEFAULT_GATES;
  const labels = phaseGateLabels(cwd);
  const pending: string[] = [];
  for (const key of PHASE_GATE_NAMES) {
    if (!gates[key]) pending.push(labels[key]);
  }
  return pending;
}

/** Mark a specific gate for a phase. */
export function markPhaseGate(
  cwd: string,
  phase: number,
  gate: keyof Omit<PhaseCleanupGates, 'completed_at'>,
  value: boolean,
): void {
  const state = loadPhaseCleanup(cwd);
  if (!state.phases[String(phase)]) {
    state.phases[String(phase)] = { ...DEFAULT_GATES };
  }
  state.phases[String(phase)][gate] = value;

  // Auto-set completed_at when all gates pass
  const gates = state.phases[String(phase)];
  const allComplete = gates.scorecards_verified &&
    gates.handicap_generated &&
    gates.map_refreshed &&
    gates.findings_audited &&
    gates.regression_passed;
  if (allComplete && !gates.completed_at) {
    gates.completed_at = new Date().toISOString();
  }
  savePhaseCleanup(cwd, state);
}

/**
 * Phase number from a phase name like "Phase 7 — Helmsman 3D", falling back to
 * position. Shared with the phase-boundary guard so both derive the number the
 * same way; two copies would let the guard block on a phase no command could
 * record against.
 */
export function extractPhaseNumber(name: string, index: number): number {
  const match = name.match(/Phase\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : index + 1;
}

/**
 * The phase a sprint belongs to, or null when the roadmap does not place it.
 *
 * The gate writers need this: `slope validate`, `card` and `map` are told
 * nothing about phases, so each has to find the phase that owns the sprint it
 * is working on before it can record anything (#696).
 */
export function phaseNumberForSprint(
  roadmap: { phases?: Array<{ name: string; sprints: Array<string | number>; sprint_keys?: string[] }> } | null,
  sprintKey: string,
  normalise: (id: string | number) => string | null,
): number | null {
  if (!roadmap?.phases) return null;
  for (let i = 0; i < roadmap.phases.length; i++) {
    const phase = roadmap.phases[i];
    const members = phase.sprint_keys ?? phase.sprints;
    if (members.some(id => normalise(id) === sprintKey)) {
      return extractPhaseNumber(phase.name, i);
    }
  }
  return null;
}

/**
 * Record a gate against the phase owning `sprintKey`, and say what happened.
 *
 * Returns null when the phase cannot be resolved, so a caller can stay quiet
 * rather than claim it recorded something. Recording against a guessed phase
 * would be worse than recording nothing: the boundary would open on evidence
 * that belongs to a different phase.
 */
export function recordPhaseGateForSprint(
  cwd: string,
  roadmap: Parameters<typeof phaseNumberForSprint>[0],
  sprintKey: string,
  normalise: (id: string | number) => string | null,
  gate: PhaseGateName,
): number | null {
  const phase = phaseNumberForSprint(roadmap, sprintKey, normalise);
  if (phase == null) return null;
  markPhaseGate(cwd, phase, gate, true);
  return phase;
}

/** Mark all gates complete for a phase (manual override). */
export function completePhase(cwd: string, phase: number): void {
  const state = loadPhaseCleanup(cwd);
  state.phases[String(phase)] = {
    completed_at: new Date().toISOString(),
    scorecards_verified: true,
    handicap_generated: true,
    map_refreshed: true,
    findings_audited: true,
    regression_passed: true,
  };
  savePhaseCleanup(cwd, state);
}
