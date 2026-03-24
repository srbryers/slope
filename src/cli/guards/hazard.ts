import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import type { CommonIssuesFile } from '../../core/index.js';

// ── Disk state for compaction survival ──────────────

interface HazardStateEntry {
  area: string;
  warnings: string[];
  sprint: number;
  timestamp: number;
}

interface HazardState {
  entries: HazardStateEntry[];
}

const GUARD_STATE_DIR = '.slope/guard-state';
const STATE_FILE = 'hazard.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadHazardState(cwd: string): HazardState {
  try {
    const path = join(cwd, GUARD_STATE_DIR, STATE_FILE);
    if (!existsSync(path)) return { entries: [] };
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function saveHazardState(cwd: string, state: HazardState): void {
  try {
    const dir = join(cwd, GUARD_STATE_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  } catch { /* fail open — disk write failure should not break the guard */ }
}

/** Prune entries from old sprints or older than 7 days */
function pruneState(state: HazardState, currentSprint: number): HazardState {
  const cutoff = Date.now() - MAX_AGE_MS;
  return {
    entries: state.entries.filter(
      e => e.sprint === currentSprint && e.timestamp > cutoff,
    ),
  };
}

// ── Guard implementation ────────────────────────────

/**
 * Hazard guard: fires on Edit|Write (PreToolUse).
 * Warns about known issues in the file area being edited.
 * Writes state to disk so warnings survive context compaction.
 */
export async function hazardGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  const config = loadConfig();
  const recency = config.guidance?.hazardRecency ?? 5;
  const currentSprint = config.currentSprint ?? 0;

  // Determine the area from the file path (use directory)
  const area = dirname(filePath).replace(cwd + '/', '').replace(cwd, '');
  if (!area || area === '.') return {};

  // Load and prune disk state
  let state = loadHazardState(cwd);
  state = pruneState(state, currentSprint);

  // Compute fresh warnings from common issues
  const freshWarnings: string[] = [];

  try {
    const issuesPath = join(cwd, config.commonIssuesPath);
    if (existsSync(issuesPath)) {
      const issues: CommonIssuesFile = JSON.parse(readFileSync(issuesPath, 'utf8'));
      const areaLower = area.toLowerCase();

      for (const pattern of issues.recurring_patterns) {
        // Check if pattern is relevant to this area
        const text = `${pattern.title} ${pattern.description} ${pattern.prevention}`.toLowerCase();
        if (text.includes(areaLower) || areaLower.split('/').some(seg => text.includes(seg))) {
          const lastSprint = Math.max(...pattern.sprints_hit);
          freshWarnings.push(`[${pattern.category}] ${pattern.title} (last: S${lastSprint}) — ${pattern.prevention.slice(0, 100)}`);
        }
      }
    }
  } catch { /* skip — common issues are optional */ }

  // Merge fresh warnings with any disk-cached warnings for this area
  const cached = state.entries.find(e => e.area === area);
  const allWarnings = freshWarnings.length > 0 ? freshWarnings : (cached?.warnings ?? []);

  // Persist fresh warnings to disk (update or add entry)
  if (freshWarnings.length > 0) {
    const entry: HazardStateEntry = {
      area,
      warnings: freshWarnings,
      sprint: currentSprint,
      timestamp: Date.now(),
    };
    state.entries = state.entries.filter(e => e.area !== area);
    state.entries.push(entry);
    saveHazardState(cwd, state);
  }

  if (allWarnings.length === 0) return {};

  const header = `SLOPE hazard warning for ${area}:`;
  return {
    context: [header, ...allWarnings.map(w => `  ${w}`)].join('\n'),
  };
}
