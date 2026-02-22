import type { GolfScorecard, HandicapCard } from './types.js';
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
