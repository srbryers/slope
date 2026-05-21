import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../../core/index.js';
import type { CommonIssuesFile, GolfScorecard } from '../../core/index.js';
import { dedupGuardContext } from '../session-state.js';
import { normalizeTouchedPath, resolveTouchedPaths } from './hook-input.js';

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
const DEFAULT_HAZARD_RECENCY = 5;
const GENERIC_AREA_SEGMENTS = new Set(['src', 'test', 'tests', 'package', 'packages']);

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
  const areas = resolveTouchedAreas(input, cwd);
  if (areas.length === 0) return { metricReason: 'no-file-path' };

  const config = loadConfig(cwd);
  const currentSprint = config.currentSprint ?? 0;

  // Load and prune disk state
  let state = loadHazardState(cwd);
  state = pruneState(state, currentSprint);

  let issues: CommonIssuesFile | null = null;
  try {
    const issuesPath = join(cwd, config.commonIssuesPath);
    if (existsSync(issuesPath)) {
      issues = JSON.parse(readFileSync(issuesPath, 'utf8'));
    }
  } catch { /* skip — common issues are optional */ }

  const hazardRecency = config.guidance?.hazardRecency ?? DEFAULT_HAZARD_RECENCY;
  let recentScorecards: GolfScorecard[] | null = null;
  let scorecardSourceAvailable = false;
  const loadRecentScorecards = (): GolfScorecard[] => {
    if (recentScorecards) return recentScorecards;
    try {
      const scorecards = loadScorecards(config, cwd);
      recentScorecards = hazardRecency > 0 ? scorecards.slice(-hazardRecency) : scorecards;
      scorecardSourceAvailable = recentScorecards.length > 0;
    } catch {
      recentScorecards = [];
      scorecardSourceAvailable = false;
    }
    return recentScorecards;
  };

  for (const area of areas) {
    // Compute fresh warnings from common issues (ranked by recency)
    const commonWarnings = computeFreshWarnings(area, issues);
    const freshTexts = commonWarnings.length > 0
      ? commonWarnings
      : computeScorecardWarnings(area, loadRecentScorecards());

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

    if (allWarnings.length === 0) continue;

    const fullContext = formatHazardContext(area, allWarnings);

    // Session dedup: if this exact context was already injected, return compressed reference
    const dedup = dedupGuardContext(cwd, input.session_id, 'hazard', fullContext);
    if (dedup) return { context: dedup, metricReason: 'deduped' };

    return { context: fullContext, metricReason: 'matched' };
  }

  return { metricReason: issues || scorecardSourceAvailable ? 'no-match' : 'state-unavailable' };
}

function resolveTouchedAreas(input: HookInput, cwd: string): string[] {
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const touchedPath of resolveTouchedPaths(input)) {
    const relativePath = normalizeTouchedPath(touchedPath, cwd);
    if (!relativePath) continue;
    const area = dirname(relativePath);
    if (!area || area === '.' || seen.has(area)) continue;
    seen.add(area);
    areas.push(area);
  }
  return areas;
}

function computeFreshWarnings(area: string, issues: CommonIssuesFile | null): string[] {
  if (!issues) return [];

  const freshWarnings: Array<{ lastSprint: number; text: string }> = [];

  for (const pattern of issues.recurring_patterns) {
    // Check if pattern is relevant to this area
    const text = `${pattern.title} ${pattern.description} ${pattern.prevention}`.toLowerCase();
    if (areaMatchesText(area, text, { includeGenericSegments: true })) {
      const lastSprint = Math.max(...pattern.sprints_hit);
      freshWarnings.push({ lastSprint, text: `[${pattern.category}] ${pattern.title} (S${lastSprint}) — ${pattern.prevention.slice(0, 80)}` });
    }
  }

  // Sort by recency (most recent first)
  freshWarnings.sort((a, b) => b.lastSprint - a.lastSprint);
  return freshWarnings.map(w => w.text);
}

function computeScorecardWarnings(area: string, scorecards: GolfScorecard[]): string[] {
  const warnings: Array<{ sprint: number; text: string }> = [];

  for (const sc of scorecards) {
    const sprint = sc.sprint_number ?? (sc as unknown as { sprint?: number }).sprint ?? 0;

    for (const shot of sc.shots ?? []) {
      for (const hazard of shot.hazards ?? []) {
        const description = hazard.description ?? '';
        const haystack = `${shot.ticket_key} ${shot.title} ${hazard.type} ${description}`.toLowerCase();
        if (!areaMatchesText(area, haystack)) continue;
        warnings.push({
          sprint,
          text: `[scorecard:${hazard.type}] ${description || shot.title} (S${sprint})`,
        });
      }
    }

    for (const location of sc.bunker_locations ?? []) {
      const locationText = typeof location === 'string'
        ? location
        : String((location as Record<string, unknown>).area ?? '');
      if (!locationText || !areaMatchesText(area, locationText.toLowerCase())) continue;
      warnings.push({
        sprint,
        text: `[scorecard:bunker] ${locationText} (S${sprint})`,
      });
    }
  }

  warnings.sort((a, b) => b.sprint - a.sprint);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const warning of warnings) {
    const key = warning.text.replace(/ \(S\d+\)$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(warning.text);
  }

  return unique;
}

function areaMatchesText(
  area: string,
  lowerText: string,
  opts: { includeGenericSegments?: boolean } = {},
): boolean {
  const areaLower = area.toLowerCase();
  if (lowerText.includes(areaLower)) return true;

  const segments = areaLower
    .split('/')
    .map(seg => seg.trim())
    .filter(Boolean)
    .filter(seg => opts.includeGenericSegments || seg.length >= 4)
    .filter(seg => opts.includeGenericSegments || !GENERIC_AREA_SEGMENTS.has(seg));

  return segments.some(seg => lowerText.includes(seg));
}

function formatHazardContext(area: string, allWarnings: string[]): string {
  const maxHazards = 3;
  const shown = allWarnings.slice(0, maxHazards);
  const overflow = allWarnings.length - shown.length;
  const header = `SLOPE hazards (${area}, ${allWarnings.length} total${overflow > 0 ? `, showing top ${maxHazards}` : ''}):`;
  const lines = [header, ...shown.map(w => `• ${w}`)];
  if (overflow > 0) lines.push(`  (+${overflow} more — run \`slope briefing --area=${area}\` for all)`);
  return lines.join('\n');
}
