import type { GolfScorecard, HandicapCard } from './types.js';
import type { CommonIssuesFile, RecurringPattern } from './briefing.js';
import { computeHandicapCard } from './handicap.js';

/** Default player name when scorecard has no player field */
export const DEFAULT_PLAYER = 'default';

/** Per-player handicap result */
export interface PlayerHandicap {
  player: string;
  scorecardCount: number;
  handicapCard: HandicapCard;
}

/**
 * Extract unique sorted player names from scorecards.
 * Scorecards without a player field are attributed to DEFAULT_PLAYER.
 */
export function extractPlayers(scorecards: GolfScorecard[]): string[] {
  const players = new Set<string>();
  for (const sc of scorecards) {
    players.add(sc.player ?? DEFAULT_PLAYER);
  }
  return [...players].sort();
}

/**
 * Filter scorecards to those belonging to a specific player.
 * Scorecards without a player field match DEFAULT_PLAYER.
 */
export function filterScorecardsByPlayer(
  scorecards: GolfScorecard[],
  player: string,
): GolfScorecard[] {
  return scorecards.filter(sc => (sc.player ?? DEFAULT_PLAYER) === player);
}

/**
 * Compute handicap cards for all players found in scorecards.
 * Each player gets an independent HandicapCard from their own scorecards.
 */
export function computePlayerHandicaps(scorecards: GolfScorecard[]): PlayerHandicap[] {
  const players = extractPlayers(scorecards);
  return players.map(player => computePlayerHandicap(scorecards, player));
}

/**
 * Compute handicap card for a single player.
 * Returns zeroed stats if no scorecards match.
 */
export function computePlayerHandicap(
  scorecards: GolfScorecard[],
  player: string,
): PlayerHandicap {
  const filtered = filterScorecardsByPlayer(scorecards, player);
  return {
    player,
    scorecardCount: filtered.length,
    handicapCard: computeHandicapCard(filtered),
  };
}

// --- Shared Hazard Indices ---

export type ReporterSeverity = 'low' | 'medium' | 'high';

/**
 * Compute severity from reporter count.
 * 1 reporter = low, 2 = medium, 3+ = high.
 * Deduplicates reporters before counting.
 */
export function computeReporterSeverity(reporters: string[]): ReporterSeverity {
  const unique = new Set(reporters);
  if (unique.size >= 3) return 'high';
  if (unique.size >= 2) return 'medium';
  return 'low';
}

/**
 * Merge new patterns into existing common issues, accumulating reporters
 * and unioning sprints_hit. Patterns are matched by id.
 */
export function mergeHazardIndices(
  issues: CommonIssuesFile,
  newPatterns: RecurringPattern[],
  reporter: string,
): CommonIssuesFile {
  const existing = new Map<number, RecurringPattern>();
  for (const p of issues.recurring_patterns) {
    existing.set(p.id, { ...p, reported_by: [...(p.reported_by ?? [])] });
  }

  for (const np of newPatterns) {
    const ex = existing.get(np.id);
    if (ex) {
      // Merge: union sprints, accumulate reporter
      const sprintSet = new Set([...ex.sprints_hit, ...np.sprints_hit]);
      ex.sprints_hit = [...sprintSet].sort((a, b) => a - b);
      const reporters = ex.reported_by ?? [];
      if (!reporters.includes(reporter)) {
        reporters.push(reporter);
      }
      ex.reported_by = reporters;
    } else {
      // New pattern
      existing.set(np.id, {
        ...np,
        reported_by: [reporter],
      });
    }
  }

  return { recurring_patterns: [...existing.values()] };
}

/**
 * Filter hazards by visibility: team-wide shows all,
 * player filter shows only those reported by that player (or with no reporters).
 */
export function filterHazardsByVisibility(
  issues: CommonIssuesFile,
  opts: { player?: string; teamWide?: boolean },
): CommonIssuesFile {
  if (opts.teamWide || (!opts.player && !opts.teamWide)) {
    return issues;
  }

  const filtered = issues.recurring_patterns.filter(p => {
    if (!p.reported_by || p.reported_by.length === 0) return true;
    return p.reported_by.includes(opts.player!);
  });

  return { recurring_patterns: filtered };
}
