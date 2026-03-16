import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const PHASE_CLEANUP_FILE = '.slope/phase-cleanup.json';

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

/** Get incomplete gates for a phase. Returns human-readable list. */
export function pendingPhaseGates(cwd: string, phase: number): string[] {
  const state = loadPhaseCleanup(cwd);
  const gates = state.phases[String(phase)] ?? DEFAULT_GATES;
  const labels: Record<keyof PhaseCleanupGates, string> = {
    completed_at: '',
    scorecards_verified: 'Scorecards verified (`slope validate` for all phase sprints)',
    handicap_generated: 'Handicap card generated (`slope card`)',
    map_refreshed: 'Codebase map refreshed (`slope map`)',
    findings_audited: 'Deferred findings audited (`slope phase audit`)',
    regression_passed: 'Regression passed (`bun test`)',
  };
  const pending: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (key === 'completed_at') continue;
    if (!gates[key as keyof PhaseCleanupGates]) {
      pending.push(label);
    }
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
