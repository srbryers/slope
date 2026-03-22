import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GolfScorecard } from './types.js';
import type { SlopeConfig } from './config.js';
import { normalizeStats } from './builder.js';

/**
 * Load SLOPE scorecards from the configured directory.
 * Filters by minSprint and normalizes sprint_number.
 */
export function loadScorecards(config: SlopeConfig, cwd: string = process.cwd()): GolfScorecard[] {
  const dir = join(cwd, config.scorecardDir);
  if (!existsSync(dir)) {
    return [];
  }

  // Build regex from pattern (e.g. "sprint-*.json" → /^sprint-(\d+)\.json$/)
  const patternParts = config.scorecardPattern.split('*');
  const prefix = patternParts[0] ?? '';
  const suffix = patternParts[1] ?? '';
  const regex = new RegExp(`^${escapeRegex(prefix)}(\\d+)${escapeRegex(suffix)}$`);

  const files = readdirSync(dir)
    .filter((f: string) => regex.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(regex)?.[1] ?? '0', 10);
      const nb = parseInt(b.match(regex)?.[1] ?? '0', 10);
      return na - nb;
    });

  const scorecards: GolfScorecard[] = [];

  for (const file of files) {
    const match = file.match(regex);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (num < config.minSprint) continue;

    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const card = normalizeScorecard(raw);
      scorecards.push(card);
    } catch {
      console.error(`  Warning: Could not parse ${file}, skipping`);
    }
  }

  return scorecards;
}

/**
 * Detect the latest sprint number from existing scorecards.
 * Returns 0 if no scorecards are found.
 */
export function detectLatestSprint(config: SlopeConfig, cwd: string = process.cwd()): number {
  const cards = loadScorecards(config, cwd);
  if (cards.length === 0) return 0;
  return Math.max(...cards.map((c) => c.sprint_number));
}

/**
 * Resolve the current sprint number: explicit config > auto-detect + 1.
 */
export function resolveCurrentSprint(config: SlopeConfig, cwd: string = process.cwd()): number {
  if (config.currentSprint) return config.currentSprint;
  const latest = detectLatestSprint(config, cwd);
  return latest + 1;
}

/**
 * Normalize a raw scorecard object to ensure consistent field names.
 * Handles legacy `hole_stats` → `stats` and `sprint` → `sprint_number`.
 */
export function normalizeScorecard(raw: Record<string, unknown>): GolfScorecard {
  const card = { ...raw } as Record<string, unknown>;

  // Normalize sprint_number
  card.sprint_number = card.sprint_number ?? card.sprint;

  // Normalize hole_stats → stats using the existing normalizeStats coercion
  if (card.hole_stats && !card.stats) {
    card.stats = normalizeStats(card.hole_stats, (card.shots as unknown[])?.length ?? 0);
    delete card.hole_stats;
  } else if (card.stats) {
    card.stats = normalizeStats(card.stats, (card.shots as unknown[])?.length ?? 0);
  }

  return card as unknown as GolfScorecard;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
