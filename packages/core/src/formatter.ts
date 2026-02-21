import type {
  GolfScorecard,
  MissDirection,
  ShotResult,
  ClubSelection,
  ScoreLabel,
  ClubRecommendation,
  TrainingRecommendation,
} from './types.js';
import { normalizeStats } from './builder.js';

// --- Input types ---

/** Generic project stats — teams define their own metrics */
export type ProjectStats = Record<string, number | Record<string, number>>;

/** Optional deltas to show +N changes in the review */
export type ProjectStatsDelta = Record<string, number | undefined>;

// --- Helpers ---

function pct(num: number, den: number): string {
  if (den === 0) return '0%';
  return `${Math.round((num / den) * 1000) / 10}%`;
}

function delta(n: number | undefined): string {
  if (n == null || n === 0) return '—';
  return `+${n}`;
}

const MISS_LABELS: Record<MissDirection, string> = {
  long: 'Long (over-engineered)',
  short: 'Short (under-scoped)',
  left: 'Left (wrong approach)',
  right: 'Right (spec drift)',
};

export type ReviewMode = 'technical' | 'plain';

const PLAIN_RESULTS: Record<ShotResult, string> = {
  in_the_hole: 'Completed perfectly',
  green: 'Completed with some hiccups',
  fairway: 'Good start',
  missed_long: 'Over-engineered',
  missed_short: 'Under-scoped',
  missed_left: 'Wrong approach taken',
  missed_right: 'Drifted from spec',
};

const PLAIN_CLUBS: Record<ClubSelection, string> = {
  driver: 'High-risk approach',
  long_iron: 'Complex approach',
  short_iron: 'Standard approach',
  wedge: 'Simple fix',
  putter: 'Trivial fix',
};

const PLAIN_SCORES: Record<ScoreLabel, string> = {
  eagle: 'Well ahead of schedule',
  birdie: 'Ahead of schedule',
  par: 'On schedule',
  bogey: 'Took longer than expected',
  double_bogey: 'Significantly over time',
  triple_plus: 'Major overrun',
};

function safeBunkerLabel(b: unknown): string {
  if (typeof b === 'string') return b;
  if (b && typeof b === 'object') return (b as Record<string, unknown>).area as string ?? String(b);
  return String(b);
}

// --- Formatter ---

/**
 * Format a SLOPE scorecard into a markdown sprint review.
 *
 * If projectStats is provided, renders a project stats table.
 * If omitted, skips the infrastructure section entirely.
 */
export function formatSprintReview(
  card: GolfScorecard & { sprint?: number },
  projectStats?: ProjectStats,
  deltas?: ProjectStatsDelta,
  mode: ReviewMode = 'technical',
): string {
  if (mode === 'plain') {
    return formatPlainReview(card, projectStats, deltas);
  }
  const sprintNum = card.sprint_number ?? (card as any).sprint;
  const stats = normalizeStats(card.stats, card.shots?.length ?? 0);
  const shots = card.shots ?? [];
  const conditions = card.conditions ?? [];
  const bunkerLocations = card.bunker_locations ?? [];
  const courseNotes = card.course_management_notes ?? [];
  const lines: string[] = [];

  lines.push(`## Sprint ${sprintNum} Review: ${card.theme}`);
  lines.push('');

  lines.push('### SLOPE Scorecard Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Par | ${card.par} |`);
  lines.push(`| Slope | ${card.slope} |`);
  lines.push(`| Score | ${card.score} |`);
  lines.push(`| Label | ${card.score_label} |`);
  lines.push(`| Fairway % | ${pct(stats.fairways_hit, stats.fairways_total)} (${stats.fairways_hit}/${stats.fairways_total}) |`);
  lines.push(`| GIR % | ${pct(stats.greens_in_regulation, stats.greens_total)} (${stats.greens_in_regulation}/${stats.greens_total}) |`);
  lines.push(`| Putts | ${stats.putts} |`);
  lines.push(`| Penalties | ${stats.penalties} |`);
  lines.push('');

  if (projectStats) {
    lines.push('### Project Stats');
    lines.push('');
    lines.push('| Category | Count | Delta |');
    lines.push('|---|---|---|');
    for (const [key, value] of Object.entries(projectStats)) {
      if (typeof value === 'number') {
        const d = deltas?.[key];
        lines.push(`| ${key} | ${value} | ${delta(d)} |`);
      } else if (typeof value === 'object' && value !== null) {
        const total = Object.values(value).reduce((sum, v) => sum + v, 0);
        const d = deltas?.[key];
        lines.push(`| ${key} | ${total} | ${delta(d)} |`);
        const breakdown = Object.entries(value).map(([k, v]) => `${v} ${k}`).join(' + ');
        lines.push('');
        lines.push(`> ${breakdown}`);
      }
    }
    lines.push('');
  }

  lines.push(`### Shot-by-Shot (Tickets Delivered: ${shots.length})`);
  lines.push('');
  lines.push('| Ticket | Club | Result | Hazards | Notes |');
  lines.push('|---|---|---|---|---|');
  for (const shot of shots) {
    const hazards = (shot.hazards ?? []).length > 0
      ? shot.hazards.map(h => `${h.type}: ${h.description ?? 'unknown'}`).join('; ')
      : '—';
    const notes = shot.notes ?? '—';
    lines.push(`| ${shot.ticket_key} | ${shot.club} | ${shot.result} | ${hazards} | ${notes} |`);
  }
  lines.push('');

  const missTotal = stats.miss_directions.long + stats.miss_directions.short +
    stats.miss_directions.left + stats.miss_directions.right;
  if (missTotal > 0) {
    lines.push('### Miss Pattern');
    lines.push('');
    lines.push('| Direction | Count |');
    lines.push('|---|---|');
    for (const dir of ['long', 'short', 'left', 'right'] as MissDirection[]) {
      const count = stats.miss_directions[dir];
      if (count > 0) {
        lines.push(`| ${MISS_LABELS[dir]} | ${count} |`);
      }
    }
    lines.push('');
  }

  if (conditions.length > 0) {
    lines.push('### Conditions');
    lines.push('');
    lines.push('| Condition | Impact | Description |');
    lines.push('|---|---|---|');
    for (const c of conditions) {
      lines.push(`| ${c.type} | ${c.impact} | ${c.description} |`);
    }
    lines.push('');
  }

  const allHazards = shots.flatMap(s => (s.hazards ?? []).map(h => ({ ...h, ticket: s.ticket_key })));
  if (allHazards.length > 0 || bunkerLocations.length > 0) {
    lines.push('### Hazards Discovered (Bunker Locations)');
    lines.push('');
    if (allHazards.length > 0) {
      lines.push('| Type | Ticket | Description |');
      lines.push('|---|---|---|');
      for (const h of allHazards) {
        lines.push(`| ${h.type} | ${h.ticket} | ${h.description ?? 'unknown'} |`);
      }
      lines.push('');
    }
    if (bunkerLocations.length > 0) {
      lines.push('**Bunker locations for future sprints:**');
      for (const b of bunkerLocations) {
        lines.push(`- ${safeBunkerLabel(b)}`);
      }
      lines.push('');
    }
  }

  if (card.training && card.training.length > 0) {
    lines.push('### Training Log');
    lines.push('');
    lines.push('| Type | Description | Outcome |');
    lines.push('|---|---|---|');
    for (const t of card.training) {
      lines.push(`| ${t.type} | ${t.description} | ${t.outcome} |`);
    }
    lines.push('');
  }

  if (card.nutrition && card.nutrition.length > 0) {
    lines.push('### Nutrition Check (Development Health)');
    lines.push('');
    lines.push('| Category | Status | Notes |');
    lines.push('|---|---|---|');
    for (const n of card.nutrition) {
      lines.push(`| ${n.category} | ${n.status} | ${n.description} |`);
    }
    lines.push('');
  }

  if (courseNotes.length > 0) {
    lines.push('### Course Management Notes');
    lines.push('');
    for (const note of courseNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  if (card.nineteenth_hole) {
    const nh = card.nineteenth_hole;
    lines.push('### 19th Hole');
    lines.push('');
    if (nh.how_did_it_feel) lines.push(`- **How did it feel?** ${nh.how_did_it_feel}`);
    if (nh.advice_for_next_player) lines.push(`- **Advice for next player?** ${nh.advice_for_next_player}`);
    if (nh.what_surprised_you) lines.push(`- **What surprised you?** ${nh.what_surprised_you}`);
    if (nh.excited_about_next) lines.push(`- **Excited about next?** ${nh.excited_about_next}`);
    lines.push('');
  }

  return lines.join('\n');
}

// --- Advisor report formatter ---

export interface AdvisorReportInput {
  clubRecommendation?: ClubRecommendation;
  trainingPlan?: TrainingRecommendation[];
  hazardWarnings?: string[];
}

export function formatAdvisorReport(input: AdvisorReportInput): string {
  const { clubRecommendation, trainingPlan, hazardWarnings } = input;
  const lines: string[] = [];

  if (clubRecommendation) {
    lines.push('### CLUB RECOMMENDATION');
    lines.push('');
    lines.push(`**Club:** ${clubRecommendation.club}`);
    lines.push(`**Confidence:** ${Math.round(clubRecommendation.confidence * 100)}%`);
    lines.push('');
    for (const reason of clubRecommendation.reasoning.split('. ').filter(Boolean)) {
      lines.push(`- ${reason.endsWith('.') ? reason : reason + '.'}`);
    }
    if (clubRecommendation.provisional_suggestion) {
      lines.push('');
      lines.push(`> ${clubRecommendation.provisional_suggestion}`);
    }
    lines.push('');
  }

  const filtered = trainingPlan?.filter(t => t.priority === 'high' || t.priority === 'medium') ?? [];
  if (filtered.length > 0) {
    lines.push('### TRAINING RECOMMENDATIONS');
    lines.push('');
    lines.push('| Priority | Area | Type | Recommendation |');
    lines.push('|---|---|---|---|');
    for (const item of filtered) {
      const adjustment = item.instruction_adjustment ?? item.description;
      lines.push(`| ${item.priority} | ${item.area} | ${item.type} | ${adjustment} |`);
    }
    lines.push('');
  }

  if (hazardWarnings && hazardWarnings.length > 0) {
    lines.push('### HAZARD WARNINGS');
    lines.push('');
    for (const warning of hazardWarnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Plain mode formatter ---

function formatPlainReview(
  card: GolfScorecard & { sprint?: number },
  projectStats?: ProjectStats,
  deltas?: ProjectStatsDelta,
): string {
  const sprintNum = card.sprint_number ?? (card as any).sprint;
  const shots = card.shots ?? [];
  const lines: string[] = [];

  lines.push(`## Sprint ${sprintNum}: ${card.theme}`);
  lines.push('');

  const scoreDesc = PLAIN_SCORES[card.score_label] ?? card.score_label;
  lines.push(`**Status:** ${scoreDesc}`);
  lines.push(`**Tickets:** ${shots.length} delivered`);
  lines.push('');

  lines.push('### Tickets');
  lines.push('');
  lines.push('| Ticket | Approach | Outcome | Notes |');
  lines.push('|---|---|---|---|');
  for (const shot of shots) {
    const approach = PLAIN_CLUBS[shot.club] ?? shot.club;
    const outcome = PLAIN_RESULTS[shot.result] ?? shot.result;
    const notes = shot.notes ?? '—';
    lines.push(`| ${shot.ticket_key} | ${approach} | ${outcome} | ${notes} |`);
  }
  lines.push('');

  if (projectStats) {
    lines.push('### System Stats');
    lines.push('');
    for (const [key, value] of Object.entries(projectStats)) {
      if (typeof value === 'number') {
        const d = deltas?.[key];
        lines.push(`- **${key}:** ${value} ${d ? `(+${d})` : ''}`);
      }
    }
    lines.push('');
  }

  if (card.nineteenth_hole) {
    const nh = card.nineteenth_hole;
    lines.push('### Reflection');
    lines.push('');
    if (nh.how_did_it_feel) lines.push(`- ${nh.how_did_it_feel}`);
    if (nh.advice_for_next_player) lines.push(`- **Tip:** ${nh.advice_for_next_player}`);
    if (nh.excited_about_next) lines.push(`- **Next:** ${nh.excited_about_next}`);
    lines.push('');
  }

  return lines.join('\n');
}
