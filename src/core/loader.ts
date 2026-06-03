import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ClubSelection, GolfScorecard, HazardHit, ShotRecord, ShotResult } from './types.js';
import type { SlopeConfig } from './config.js';
import { computeStatsFromShots, normalizeStats } from './builder.js';
import { computePar, computeScoreLabel } from './handicap.js';
import { compareSprintIds, nextCanonicalSprintId } from './roadmap.js';

type ScorecardCandidate = {
  path: string;
  sprintNumber: number;
  priority: number;
  label: string;
};

const VALID_CLUBS = new Set<ClubSelection>(['driver', 'long_iron', 'short_iron', 'wedge', 'putter']);
const VALID_RESULTS = new Set<ShotResult>([
  'in_the_hole',
  'green',
  'fairway',
  'missed_long',
  'missed_short',
  'missed_left',
  'missed_right',
]);

const LEGACY_RESULT_ALIASES: Record<string, ShotResult> = {
  long: 'missed_long',
  short: 'missed_short',
  left: 'missed_left',
  right: 'missed_right',
};

/**
 * Load SLOPE scorecards from the configured directory.
 * Filters by minSprint and normalizes sprint_number.
 */
export function loadScorecards(config: SlopeConfig, cwd: string = process.cwd()): GolfScorecard[] {
  const candidates = discoverScorecardCandidatesForConfig(config, cwd);
  const scorecards: GolfScorecard[] = [];
  const loadedSprints = new Set<number>();

  for (const candidate of candidates) {
    if (loadedSprints.has(candidate.sprintNumber)) continue;

    try {
      const raw = JSON.parse(readFileSync(candidate.path, 'utf8'));
      const card = normalizeScorecard(raw);
      if (card.sprint_number < config.minSprint || loadedSprints.has(card.sprint_number)) continue;
      scorecards.push(card);
      loadedSprints.add(card.sprint_number);
    } catch {
      console.error(`  Warning: Could not parse ${candidate.label}, skipping`);
    }
  }

  return scorecards;
}

export function discoverScorecardFiles(config: SlopeConfig, cwd: string = process.cwd()): string[] {
  return discoverScorecardCandidatesForConfig(config, cwd).map((candidate) => candidate.path);
}

export function sprintNumberFromScorecardFile(file: string, config: SlopeConfig): number | null {
  const patternParts = config.scorecardPattern.split('*');
  const prefix = patternParts[0] ?? '';
  const suffix = patternParts[1] ?? '';
  const regex = new RegExp(`^${escapeRegex(prefix)}(\\d+(?:\\.\\d+)?)${escapeRegex(suffix)}$`);
  const normalized = file.replace(/\\/g, '/');
  const filename = normalized.split('/').at(-1) ?? file;
  const topLevelMatch = filename.match(regex);
  if (topLevelMatch?.[1]) return parseFloat(topLevelMatch[1]);

  const parts = normalized.split('/');
  const parent = parts.at(-2) ?? '';
  const nestedMatch = parent.match(/^s(?:print-)?(\d+(?:\.\d+)?)$/i);
  if (filename === 'scorecard.json' && nestedMatch?.[1]) return parseFloat(nestedMatch[1]);
  return null;
}

function discoverScorecardCandidatesForConfig(config: SlopeConfig, cwd: string): ScorecardCandidate[] {
  const dir = join(cwd, config.scorecardDir);
  if (!existsSync(dir)) {
    return [];
  }

  // Build regex from pattern (e.g. "sprint-*.json" → /^sprint-(\d+(?:\.\d+)?)\.json$/)
  const patternParts = config.scorecardPattern.split('*');
  const prefix = patternParts[0] ?? '';
  const suffix = patternParts[1] ?? '';
  const regex = new RegExp(`^${escapeRegex(prefix)}(\\d+(?:\\.\\d+)?)${escapeRegex(suffix)}$`);

  const candidates = discoverScorecardCandidates(dir, regex)
    .filter((candidate) => candidate.sprintNumber >= config.minSprint)
    .sort((a, b) => {
      const bySprint = compareSprintIds(a.sprintNumber, b.sprintNumber);
      return bySprint === 0 ? a.priority - b.priority : bySprint;
    });

  const loadedSprints = new Set<number>();
  const dedupedCandidates: ScorecardCandidate[] = [];

  for (const candidate of candidates) {
    if (loadedSprints.has(candidate.sprintNumber)) continue;
    dedupedCandidates.push(candidate);
    loadedSprints.add(candidate.sprintNumber);
  }

  return dedupedCandidates;
}

/**
 * Detect the latest sprint number from existing scorecards.
 * Returns 0 if no scorecards are found.
 */
export function detectLatestSprint(config: SlopeConfig, cwd: string = process.cwd()): number {
  const cards = loadScorecards(config, cwd);
  if (cards.length === 0) return 0;
  return cards
    .map((c) => c.sprint_number)
    .sort(compareSprintIds)
    .at(-1) ?? 0;
}

/**
 * Resolve the current sprint number: explicit config > auto-detect + 1.
 */
export function resolveCurrentSprint(config: SlopeConfig, cwd: string = process.cwd()): number {
  if (config.currentSprint) return config.currentSprint;
  const latest = detectLatestSprint(config, cwd);
  return latest > 0 ? nextCanonicalSprintId(latest) : 1;
}

/**
 * Normalize a raw scorecard object to ensure consistent field names.
 * Handles legacy `hole_stats` → `stats` and `sprint` → `sprint_number`.
 */
export function normalizeScorecard(raw: Record<string, unknown>): GolfScorecard {
  const card = { ...raw } as Record<string, unknown>;
  const shots = normalizeScorecardShots(card);
  const shotCount = shots.length;

  // Normalize sprint_number
  card.sprint_number = card.sprint_number ?? card.sprint;

  if ((!Array.isArray(card.shots) || card.shots.length === 0) && shotCount > 0) {
    card.shots = shots;
  }

  if (typeof card.par !== 'number' || Number.isNaN(card.par)) {
    card.par = computePar(shotCount);
  }

  if (typeof card.score !== 'number' || Number.isNaN(card.score)) {
    card.score = card.par;
  }

  if (typeof card.score_label !== 'string') {
    card.score_label = computeScoreLabel(card.score as number, card.par as number);
  }

  // Normalize hole_stats → stats using the existing normalizeStats coercion
  if (card.hole_stats && !card.stats) {
    card.stats = normalizeStats(card.hole_stats, shotCount);
    delete card.hole_stats;
  } else if (isEmptyStats(card.stats)) {
    card.stats = computeStatsFromShots(shots);
  } else {
    // Always normalize — handles both existing stats and missing stats (zeroed defaults)
    card.stats = normalizeStats(card.stats, shotCount);
  }

  return card as unknown as GolfScorecard;
}

export function normalizeScorecardShots(card: Record<string, unknown> | (Partial<GolfScorecard> & { tickets?: unknown[] })): ShotRecord[] {
  const canonical = (card as { shots?: unknown }).shots;
  if (Array.isArray(canonical) && canonical.length > 0) {
    return canonical as ShotRecord[];
  }

  const legacy = (card as { tickets?: unknown }).tickets;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    return Array.isArray(canonical) ? (canonical as ShotRecord[]) : [];
  }

  return legacy.map((ticket, index) => {
    const obj = (ticket ?? {}) as Record<string, unknown>;
    const ticketKey =
      nonEmptyString(obj.ticket_key) ??
      nonEmptyString(obj.id) ??
      nonEmptyString(obj.key) ??
      `T${index + 1}`;
    const rawClub = nonEmptyString(obj.club) ?? nonEmptyString(obj.approach) ?? 'short_iron';
    const rawResult = nonEmptyString(obj.result) ?? 'green';

    return {
      ticket_key: ticketKey,
      title: nonEmptyString(obj.title) ?? `Ticket ${ticketKey}`,
      club: normalizeClub(rawClub),
      result: normalizeResult(rawResult),
      hazards: normalizeHazards(obj.hazards),
      ...(typeof obj.notes === 'string' ? { notes: obj.notes } : {}),
    };
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeClub(value: string): ClubSelection {
  return VALID_CLUBS.has(value as ClubSelection) ? value as ClubSelection : 'short_iron';
}

function normalizeResult(value: string): ShotResult {
  const alias = LEGACY_RESULT_ALIASES[value];
  if (alias) return alias;
  return VALID_RESULTS.has(value as ShotResult) ? value as ShotResult : 'green';
}

function normalizeHazards(value: unknown): HazardHit[] {
  if (!Array.isArray(value)) return [];
  const hazards: HazardHit[] = [];
  for (const hazard of value) {
    if (typeof hazard === 'string') {
      hazards.push({ type: 'rough', description: hazard });
      continue;
    }
    if (!hazard || typeof hazard !== 'object') continue;
    hazards.push(hazard as HazardHit);
  }
  return hazards;
}

function isEmptyStats(value: unknown): boolean {
  if (value == null) return true;
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

function discoverScorecardCandidates(dir: string, regex: RegExp): ScorecardCandidate[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const candidates: ScorecardCandidate[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const match = entry.name.match(regex);
      if (!match) continue;
      candidates.push({
        path: join(dir, entry.name),
        sprintNumber: parseFloat(match[1] ?? '0'),
        priority: 0,
        label: entry.name,
      });
      continue;
    }

    if (!entry.isDirectory()) continue;
    const nestedMatch = entry.name.match(/^s(?:print-)?(\d+(?:\.\d+)?)$/i);
    if (!nestedMatch) continue;
    const nestedPath = join(dir, entry.name, 'scorecard.json');
    if (!existsSync(nestedPath)) continue;
    candidates.push({
      path: nestedPath,
      sprintNumber: parseFloat(nestedMatch[1] ?? '0'),
      priority: 1,
      label: `${entry.name}/scorecard.json`,
    });
  }

  return candidates;
}
