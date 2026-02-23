/**
 * Tournament Review — aggregates multiple sprint scorecards into
 * a cohesive initiative-level retrospective.
 */
import type {
  GolfScorecard,
  ScoreLabel,
  TournamentReview,
  TournamentSprintEntry,
  TournamentScoring,
  TournamentStats,
  TournamentHazard,
} from './types.js';

const SCORE_ORDER: ScoreLabel[] = [
  'eagle', 'birdie', 'par',
  'bogey', 'double_bogey', 'triple_plus',
];

function scoreLabelRank(label: ScoreLabel): number {
  return SCORE_ORDER.indexOf(label);
}

export function buildTournamentReview(
  id: string,
  name: string,
  scorecards: GolfScorecard[],
  options?: { takeaways?: string[]; improvements?: string[]; reflection?: string },
): TournamentReview {
  const sorted = [...scorecards].sort((a, b) => a.sprint_number - b.sprint_number);

  const sprints: TournamentSprintEntry[] = sorted.map((card) => {
    const landed = card.shots.filter((s) => s.result === 'in_the_hole').length;
    return {
      sprintNumber: card.sprint_number,
      theme: card.theme,
      par: card.par,
      slope: card.slope,
      score: card.score,
      scoreLabel: card.score_label,
      ticketCount: card.shots.length,
      ticketsLanded: landed,
    };
  });

  const scoring = computeScoring(sprints);
  const stats = computeStats(sorted);
  const hazardIndex = extractHazards(sorted);
  const clubPerformance = computeClubPerformance(sorted);

  return {
    id,
    name,
    dateRange: {
      start: sorted[0]?.date ?? '',
      end: sorted[sorted.length - 1]?.date ?? '',
    },
    sprints,
    scoring,
    stats,
    hazardIndex,
    clubPerformance,
    takeaways: options?.takeaways ?? [],
    improvements: options?.improvements ?? [],
    reflection: options?.reflection,
  };
}

function computeScoring(sprints: TournamentSprintEntry[]): TournamentScoring {
  const totalPar = sprints.reduce((s, e) => s + e.par, 0);
  const totalScore = sprints.reduce((s, e) => s + e.score, 0);
  const ticketCount = sprints.reduce((s, e) => s + e.ticketCount, 0);
  const ticketsLanded = sprints.reduce((s, e) => s + e.ticketsLanded, 0);

  let best = sprints[0];
  let worst = sprints[0];
  for (const s of sprints) {
    if (scoreLabelRank(s.scoreLabel) < scoreLabelRank(best.scoreLabel)) best = s;
    if (scoreLabelRank(s.scoreLabel) > scoreLabelRank(worst.scoreLabel)) worst = s;
  }

  const labelCounts: Record<string, number> = {};
  for (const s of sprints) {
    labelCounts[s.scoreLabel] = (labelCounts[s.scoreLabel] ?? 0) + 1;
  }
  const avgScoreLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'par';

  return {
    totalPar,
    totalScore,
    differential: totalScore - totalPar,
    avgScoreLabel,
    bestSprint: { sprintNumber: best?.sprintNumber ?? 0, label: best?.scoreLabel ?? 'par' },
    worstSprint: { sprintNumber: worst?.sprintNumber ?? 0, label: worst?.scoreLabel ?? 'par' },
    sprintCount: sprints.length,
    ticketCount,
    ticketsLanded,
    landingRate: ticketCount > 0 ? ticketsLanded / ticketCount : 0,
  };
}

function computeStats(cards: GolfScorecard[]): TournamentStats {
  const avgSlope = cards.length > 0 ? cards.reduce((s, c) => s + c.slope, 0) / cards.length : 0;

  let totalHazards = 0;
  let totalPenalties = 0;
  let totalPutts = 0;
  let fairwayHit = 0;
  let fairwayTotal = 0;
  let girHit = 0;
  let girTotal = 0;

  for (const card of cards) {
    const s = card.stats;
    totalHazards += s.hazards_hit;
    totalPenalties += s.penalties;
    totalPutts += s.putts;
    fairwayHit += s.fairways_hit;
    fairwayTotal += s.fairways_total;
    girHit += s.greens_in_regulation;
    girTotal += s.greens_total;
  }

  return {
    avgSlope: Math.round(avgSlope * 10) / 10,
    totalHazards,
    totalPenalties,
    avgPutts: cards.length > 0 ? Math.round((totalPutts / cards.length) * 10) / 10 : 0,
    fairwayRate: fairwayTotal > 0 ? Math.round((fairwayHit / fairwayTotal) * 1000) / 1000 : 0,
    girRate: girTotal > 0 ? Math.round((girHit / girTotal) * 1000) / 1000 : 0,
  };
}

function extractHazards(cards: GolfScorecard[]): TournamentHazard[] {
  const hazards: TournamentHazard[] = [];

  for (const card of cards) {
    if (!card.bunker_locations) continue;
    for (const loc of card.bunker_locations) {
      if (typeof loc === 'string') {
        hazards.push({
          gotchaId: `g-${card.sprint_number}-${hazards.length}`,
          sprint: card.sprint_number,
          area: loc,
          description: loc,
        });
      } else if (typeof loc === 'object' && loc !== null) {
        const obj = loc as Record<string, unknown>;
        hazards.push({
          gotchaId: (obj.gotcha_id as string) ?? `g-${card.sprint_number}-${hazards.length}`,
          sprint: card.sprint_number,
          area: (obj.area as string) ?? '',
          description: (obj.description as string) ?? '',
        });
      }
    }
  }

  return hazards;
}

function computeClubPerformance(
  cards: GolfScorecard[],
): Record<string, { attempts: number; inTheHole: number; avgScore: number }> {
  const clubMap = new Map<string, { attempts: number; inTheHole: number; scores: number[] }>();

  for (const card of cards) {
    for (const shot of card.shots) {
      const club = shot.club;
      if (!clubMap.has(club)) {
        clubMap.set(club, { attempts: 0, inTheHole: 0, scores: [] });
      }
      const entry = clubMap.get(club)!;
      entry.attempts++;
      if (shot.result === 'in_the_hole') entry.inTheHole++;
      entry.scores.push(shot.result === 'in_the_hole' ? 1 : shot.result === 'green' ? 2 : 3);
    }
  }

  const result: Record<string, { attempts: number; inTheHole: number; avgScore: number }> = {};
  for (const [club, data] of clubMap) {
    result[club] = {
      attempts: data.attempts,
      inTheHole: data.inTheHole,
      avgScore: Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100) / 100,
    };
  }

  return result;
}

export function formatTournamentReview(review: TournamentReview): string {
  const lines: string[] = [];

  lines.push(`# Tournament Review: ${review.name}`);
  lines.push(`**ID:** ${review.id} | **Period:** ${review.dateRange.start} — ${review.dateRange.end}`);
  lines.push('');

  // Scoring summary
  const s = review.scoring;
  const diffLabel = s.differential < 0 ? `${s.differential}` : s.differential === 0 ? 'E' : `+${s.differential}`;
  lines.push('## Scoring Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Sprints | ${s.sprintCount} |`);
  lines.push(`| Total Par | ${s.totalPar} |`);
  lines.push(`| Total Score | ${s.totalScore} (${diffLabel}) |`);
  lines.push(`| Tickets | ${s.ticketsLanded}/${s.ticketCount} landed (${Math.round(s.landingRate * 100)}%) |`);
  lines.push(`| Most Common | ${s.avgScoreLabel} |`);
  lines.push(`| Best Sprint | S${s.bestSprint.sprintNumber} (${s.bestSprint.label}) |`);
  lines.push(`| Worst Sprint | S${s.worstSprint.sprintNumber} (${s.worstSprint.label}) |`);
  lines.push('');

  // Sprint-by-sprint table
  lines.push('## Sprint Breakdown');
  lines.push('');
  lines.push('| Sprint | Theme | Par | Slope | Score | Label | Tickets |');
  lines.push('|--------|-------|-----|-------|-------|-------|---------|');
  for (const sp of review.sprints) {
    lines.push(`| S${sp.sprintNumber} | ${sp.theme} | ${sp.par} | ${sp.slope} | ${sp.score} | ${sp.scoreLabel} | ${sp.ticketsLanded}/${sp.ticketCount} |`);
  }
  lines.push('');

  // Aggregate stats
  const st = review.stats;
  lines.push('## Aggregate Stats');
  lines.push('');
  lines.push(`| Stat | Value |`);
  lines.push(`|------|-------|`);
  lines.push(`| Avg Slope | ${st.avgSlope} |`);
  lines.push(`| Fairway Rate | ${Math.round(st.fairwayRate * 100)}% |`);
  lines.push(`| GIR Rate | ${Math.round(st.girRate * 100)}% |`);
  lines.push(`| Avg Putts/Sprint | ${st.avgPutts} |`);
  lines.push(`| Total Penalties | ${st.totalPenalties} |`);
  lines.push(`| Total Hazards Hit | ${st.totalHazards} |`);
  lines.push('');

  // Club performance
  const clubs = Object.entries(review.clubPerformance).sort((a, b) => b[1].attempts - a[1].attempts);
  if (clubs.length > 0) {
    lines.push('## Club Performance');
    lines.push('');
    lines.push('| Club | Attempts | In-the-Hole | Rate | Avg Score |');
    lines.push('|------|----------|-------------|------|-----------|');
    for (const [club, perf] of clubs) {
      const rate = perf.attempts > 0 ? Math.round((perf.inTheHole / perf.attempts) * 100) : 0;
      lines.push(`| ${club} | ${perf.attempts} | ${perf.inTheHole} | ${rate}% | ${perf.avgScore} |`);
    }
    lines.push('');
  }

  // Hazard index
  if (review.hazardIndex.length > 0) {
    lines.push('## Hazard Index');
    lines.push('');
    for (const h of review.hazardIndex) {
      lines.push(`- **[${h.gotchaId}]** (S${h.sprint}) ${h.area}`);
      if (h.description !== h.area) {
        lines.push(`  ${h.description}`);
      }
    }
    lines.push('');
  }

  // Takeaways
  if (review.takeaways.length > 0) {
    lines.push('## Strategic Takeaways');
    lines.push('');
    for (const t of review.takeaways) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }

  // Improvements
  if (review.improvements.length > 0) {
    lines.push('## What We\'d Do Differently');
    lines.push('');
    for (const imp of review.improvements) {
      lines.push(`- ${imp}`);
    }
    lines.push('');
  }

  // Reflection
  if (review.reflection) {
    lines.push('## Reflection');
    lines.push('');
    lines.push(review.reflection);
    lines.push('');
  }

  return lines.join('\n');
}
