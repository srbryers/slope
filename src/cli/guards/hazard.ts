import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import type { CommonIssuesFile } from '../../core/index.js';
import { dedupGuardContext } from '../session-state.js';

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

/** Prune entries from old sprints AND older than 7 days */
function pruneState(state: HazardState, currentSprint: number): HazardState {
  const cutoff = Date.now() - MAX_AGE_MS;
  return {
    entries: state.entries.filter(
      e => e.sprint === currentSprint || e.timestamp > cutoff,
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

  // Compute fresh warnings from common issues (ranked by recency)
  const MAX_HAZARDS = 3;
  const freshWarnings: Array<{ lastSprint: number; text: string }> = [];

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
          freshWarnings.push({ lastSprint, text: `[${pattern.category}] ${pattern.title} (S${lastSprint}) — ${pattern.prevention.slice(0, 80)}` });
        }
      }
    }
  } catch { /* skip — common issues are optional */ }

  // Sort by recency (most recent first) and cap at top N
  freshWarnings.sort((a, b) => b.lastSprint - a.lastSprint);
  const freshTexts = freshWarnings.map(w => w.text);

  // Merge fresh warnings with any disk-cached warnings for this area
  const cached = state.entries.find(e => e.area === area);
  const allWarnings = freshTexts.length > 0 ? freshTexts : (cached?.warnings ?? []);

  if (freshTexts.length === 0 && cached) {
    state.entries = state.entries.filter(e => e.area !== area);
    saveHazardState(cwd, state);
  }

  // Persist fresh warnings to disk (update or add entry)
  if (freshTexts.length > 0) {
    const entry: HazardStateEntry = {
      area,
      warnings: freshTexts,
      sprint: currentSprint,
      timestamp: Date.now(),
    };
    state.entries = state.entries.filter(e => e.area !== area);
    state.entries.push(entry);
    saveHazardState(cwd, state);
  }

  if (allWarnings.length === 0) return {};

  // Cap output at top N, show overflow count
  const shown = allWarnings.slice(0, MAX_HAZARDS);
  const overflow = allWarnings.length - shown.length;
  const header = `SLOPE hazards (${area}, ${allWarnings.length} total${overflow > 0 ? `, showing top ${MAX_HAZARDS}` : ''}):`;
  const lines = [header, ...shown.map(w => `• ${w}`)];
  if (overflow > 0) lines.push(`  (+${overflow} more — run \`slope briefing --area=${area}\` for all)`);
  const fullContext = lines.join('\n');

  // Session dedup: if this exact context was already injected, return compressed reference
  const dedup = dedupGuardContext(cwd, input.session_id, 'hazard', fullContext);
  if (dedup) return { context: dedup };

  return { context: fullContext };
}
