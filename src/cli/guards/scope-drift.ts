import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { resolveStore } from '../store.js';

// ── Disk state for compaction survival ──────────────

interface DriftStateEntry {
  file: string;
  claimedAreas: string;
  sprint: number;
  timestamp: number;
}

interface DriftState {
  entries: DriftStateEntry[];
}

const GUARD_STATE_DIR = '.slope/guard-state';
const STATE_FILE = 'scope-drift.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours — fail-open if older

function loadDriftState(cwd: string): DriftState {
  try {
    const path = join(cwd, GUARD_STATE_DIR, STATE_FILE);
    if (!existsSync(path)) return { entries: [] };
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function saveDriftState(cwd: string, state: DriftState): void {
  try {
    const dir = join(cwd, GUARD_STATE_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  } catch { /* fail open */ }
}

/** Prune entries from old sprints, older than 7 days */
function pruneState(state: DriftState, currentSprint: number): DriftState {
  const cutoff = Date.now() - MAX_AGE_MS;
  return {
    entries: state.entries.filter(
      e => e.sprint === currentSprint && e.timestamp > cutoff,
    ),
  };
}

// ── Guard implementation ────────────────────────────

/**
 * Scope drift guard: fires PreToolUse on Edit|Write.
 * Warns when editing files outside the claimed ticket's scope.
 * Writes state to disk so warnings survive context compaction.
 */
export async function scopeDriftGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig();
  if (config.guidance?.scopeDrift === false) return {};

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  // Normalize file path relative to cwd
  const relativePath = filePath.startsWith(cwd)
    ? filePath.slice(cwd.length + 1)
    : filePath;

  // Look up active claims for the current sprint
  const sprintNumber = config.currentSprint;
  if (!sprintNumber) return {}; // Can't check without a sprint

  // Load and prune disk state
  let state = loadDriftState(cwd);
  state = pruneState(state, sprintNumber);

  try {
    const store = await resolveStore(cwd);
    const claims = await store.list(sprintNumber);
    store.close();

    if (claims.length === 0) return {}; // No claims — can't check

    // Check if the file is within any claimed area
    const areaClaims = claims.filter(c => c.scope === 'area');
    if (areaClaims.length === 0) return {}; // No area claims — ticket-only claims don't restrict files

    const inScope = areaClaims.some(c => relativePath.startsWith(c.target));

    if (inScope) {
      // File is in scope — clear any cached drift entry for this file
      state.entries = state.entries.filter(e => e.file !== relativePath);
      saveDriftState(cwd, state);
      return {};
    }

    // Out of scope — cache drift violation to disk
    const claimedAreas = areaClaims.map(c => c.target).join(', ');
    const entry: DriftStateEntry = {
      file: relativePath,
      claimedAreas,
      sprint: sprintNumber,
      timestamp: Date.now(),
    };
    state.entries = state.entries.filter(e => e.file !== relativePath);
    state.entries.push(entry);
    saveDriftState(cwd, state);

    return {
      context: `SLOPE scope drift: ${relativePath} is outside claimed areas (${claimedAreas}). Intentional?`,
    };
  } catch {
    // Store not available — fall back to disk state (advisory, not blocking)
    const cached = state.entries.find(e => e.file === relativePath);
    if (cached && (Date.now() - cached.timestamp) < STALE_MS) {
      return {
        context: `SLOPE scope drift: ${relativePath} is outside claimed areas (${cached.claimedAreas}). Intentional?`,
      };
    }
    return {}; // No cached state or too stale — fail open
  }
}
