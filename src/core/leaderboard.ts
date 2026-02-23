import type { GolfScorecard } from './types.js';
import type { MetaphorDefinition } from './metaphor.js';
import { escapeHtml } from './report.js';
import { extractPlayers, filterScorecardsByPlayer, DEFAULT_PLAYER } from './player.js';
import { computeHandicapCard } from './handicap.js';

/** A single entry in the team leaderboard */
export interface LeaderboardEntry {
  rank: number;
  player: string;
  handicap: number;
  scorecardCount: number;
  improvementTrend: number;
  fairwayPct: number;
  girPct: number;
}

/** Complete leaderboard */
export interface Leaderboard {
  entries: LeaderboardEntry[];
  generatedAt: string;
}

/**
 * Build a ranked leaderboard from scorecards.
 * Rank by handicap ascending (lower = better).
 * Ties broken by improvement trend (last_5.handicap - all_time.handicap, more negative = more improvement).
 */
export function buildLeaderboard(scorecards: GolfScorecard[]): Leaderboard {
  const players = extractPlayers(scorecards);

  const entries: LeaderboardEntry[] = players.map(player => {
    const filtered = filterScorecardsByPlayer(scorecards, player);
    const card = computeHandicapCard(filtered);
    const improvementTrend = filtered.length >= 5
      ? Math.round((card.last_5.handicap - card.all_time.handicap) * 10) / 10
      : 0;

    return {
      rank: 0, // assigned below
      player,
      handicap: card.all_time.handicap,
      scorecardCount: filtered.length,
      improvementTrend,
      fairwayPct: card.all_time.fairway_pct,
      girPct: card.all_time.gir_pct,
    };
  });

  // Sort by handicap asc, then improvement trend asc (more negative = better)
  entries.sort((a, b) => {
    if (a.handicap !== b.handicap) return a.handicap - b.handicap;
    return a.improvementTrend - b.improvementTrend;
  });

  // Assign ranks (ties get same rank)
  let currentRank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].handicap === entries[i - 1].handicap) {
      entries[i].rank = entries[i - 1].rank;
    } else {
      entries[i].rank = currentRank;
    }
    currentRank = i + 2;
  }

  return {
    entries,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format leaderboard as a text table for CLI output.
 */
export function formatLeaderboard(leaderboard: Leaderboard, metaphor?: MetaphorDefinition): string {
  const lines: string[] = [];
  const title = metaphor?.vocabulary.review ?? 'Team Leaderboard';

  lines.push(title);
  lines.push('\u2501'.repeat(64));
  lines.push('');

  const pad = (s: string | number, w: number) => String(s).padStart(w);

  lines.push(`${'Rank'.padEnd(6)}${'Player'.padEnd(16)}${'Handicap'.padStart(10)}${'Cards'.padStart(7)}${'Fairway%'.padStart(10)}${'GIR%'.padStart(8)}${'Trend'.padStart(7)}`);
  lines.push('\u2500'.repeat(64));

  for (const e of leaderboard.entries) {
    const trend = e.improvementTrend > 0 ? `+${e.improvementTrend}` : e.improvementTrend === 0 ? '—' : `${e.improvementTrend}`;
    lines.push(
      `${pad(e.rank, 4)}  ${e.player.padEnd(16)}${pad(`+${e.handicap.toFixed(1)}`, 10)}${pad(e.scorecardCount, 7)}${pad(e.fairwayPct.toFixed(1) + '%', 10)}${pad(e.girPct.toFixed(1) + '%', 8)}${pad(trend, 7)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render leaderboard as an HTML table, following renderSprintTable() pattern.
 */
export function renderLeaderboardHtml(leaderboard: Leaderboard, metaphor?: MetaphorDefinition): string {
  if (leaderboard.entries.length === 0) {
    return '<p>No leaderboard data available.</p>';
  }

  const rows = leaderboard.entries.map(e => {
    const trend = e.improvementTrend > 0 ? `+${e.improvementTrend}` : e.improvementTrend === 0 ? '\u2014' : `${e.improvementTrend}`;
    const trendClass = e.improvementTrend < 0 ? 'under' : e.improvementTrend > 0 ? 'over' : 'even';
    return `<tr>
      <td>${e.rank}</td>
      <td>${escapeHtml(e.player)}</td>
      <td>+${e.handicap.toFixed(1)}</td>
      <td>${e.scorecardCount}</td>
      <td>${e.fairwayPct.toFixed(1)}%</td>
      <td>${e.girPct.toFixed(1)}%</td>
      <td class="${trendClass}">${escapeHtml(trend)}</td>
    </tr>`;
  }).join('\n');

  return `
  <div class="chart-container">
    <table>
      <thead>
        <tr><th>Rank</th><th>Player</th><th>Handicap</th><th>Cards</th><th>Fairway%</th><th>GIR%</th><th>Trend</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
