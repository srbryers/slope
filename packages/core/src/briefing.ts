import type {
  GolfScorecard,
  MissDirection,
  NutritionCategory,
  NutritionEntry,
  SprintClaim,
  SlopeEvent,
  PRSignal,
} from './types.js';
import type { MetaphorDefinition } from './metaphor.js';
import type { RoleDefinition } from './roles.js';
import { computeHandicapCard } from './handicap.js';
import { computeDispersion } from './dispersion.js';
import { generateTrainingPlan } from './advisor.js';
import { checkConflicts } from './registry.js';
import type { RoadmapDefinition } from './roadmap.js';
import { formatStrategicContext } from './roadmap.js';

// --- Input types ---

/** A recurring pattern from common-issues.json */
export interface RecurringPattern {
  id: number;
  title: string;
  category: string;
  sprints_hit: number[];
  gotcha_refs: string[];
  description: string;
  prevention: string;
  /** Players who have reported this pattern */
  reported_by?: string[];
}

/** The top-level common-issues.json shape */
export interface CommonIssuesFile {
  recurring_patterns: RecurringPattern[];
}

/** A session entry from sessions.json */
export interface SessionEntry {
  id: number;
  date: string;
  sprint: string;
  summary: string;
  where_left_off: string;
}

/** Briefing filter — what packages/categories the upcoming sprint touches */
export interface BriefingFilter {
  categories?: string[];
  keywords?: string[];
}

// --- Output types ---

/** A single hazard extracted from scorecards */
export interface HazardEntry {
  sprint: number;
  ticket: string;
  type: string;
  description: string;
}

/** Nutrition trend for a single category */
export interface NutritionTrend {
  category: NutritionCategory;
  healthy: number;
  needs_attention: number;
  neglected: number;
  trend: 'healthy' | 'mixed' | 'neglected';
}

// --- Library functions ---

/**
 * Filter common issues to only those relevant to the sprint's work.
 * Matches by category list and/or keyword search in title/description/prevention.
 * Returns at most 10 results, sorted by most-recently-hit sprint (descending).
 */
export function filterCommonIssues(
  issues: CommonIssuesFile,
  filter: BriefingFilter,
): RecurringPattern[] {
  let results = issues.recurring_patterns;

  if (filter.categories && filter.categories.length > 0) {
    const cats = new Set(filter.categories.map(c => c.toLowerCase()));
    results = results.filter(p => cats.has(p.category.toLowerCase()));
  }

  if (filter.keywords && filter.keywords.length > 0) {
    const kws = filter.keywords.map(k => k.toLowerCase());
    results = results.filter(p => {
      const text = `${p.title} ${p.description} ${p.prevention}`.toLowerCase();
      return kws.some(kw => text.includes(kw));
    });
  }

  // Sort by most recent sprint hit (descending)
  results = [...results].sort((a, b) => {
    const aMax = Math.max(...a.sprints_hit, 0);
    const bMax = Math.max(...b.sprints_hit, 0);
    return bMax - aMax;
  });

  return results.slice(0, 10);
}

/**
 * Extract all hazards from scorecards into a flat searchable index.
 * Optionally filter by keyword in the hazard description.
 */
export function extractHazardIndex(
  scorecards: GolfScorecard[],
  keyword?: string,
): { shot_hazards: HazardEntry[]; bunker_locations: { sprint: number; location: string }[] } {
  const shotHazards: HazardEntry[] = [];
  const bunkers: { sprint: number; location: string }[] = [];
  const kw = keyword?.toLowerCase();

  for (const sc of scorecards) {
    const sprintNum = sc.sprint_number ?? (sc as any).sprint;

    for (const shot of sc.shots ?? []) {
      for (const h of shot.hazards ?? []) {
        const desc = h.description ?? '';
        if (!kw || desc.toLowerCase().includes(kw)) {
          shotHazards.push({
            sprint: sprintNum,
            ticket: shot.ticket_key,
            type: h.type,
            description: desc,
          });
        }
      }
    }

    for (const loc of sc.bunker_locations ?? []) {
      const locStr = typeof loc === 'string' ? loc : (loc as Record<string, unknown>)?.area as string ?? '';
      if (!kw || locStr.toLowerCase().includes(kw)) {
        bunkers.push({ sprint: sprintNum, location: locStr });
      }
    }
  }

  return { shot_hazards: shotHazards, bunker_locations: bunkers };
}

/**
 * Compute nutrition trends across scorecards.
 * Shows which dev health categories are consistently healthy vs neglected.
 */
export function computeNutritionTrend(scorecards: GolfScorecard[]): NutritionTrend[] {
  const counts: Record<string, { healthy: number; needs_attention: number; neglected: number }> = {};

  for (const sc of scorecards) {
    if (!sc.nutrition || !Array.isArray(sc.nutrition)) continue;
    for (const entry of sc.nutrition) {
      if (!counts[entry.category]) {
        counts[entry.category] = { healthy: 0, needs_attention: 0, neglected: 0 };
      }
      counts[entry.category][entry.status]++;
    }
  }

  return Object.entries(counts).map(([category, data]) => {
    const total = data.healthy + data.needs_attention + data.neglected;
    let trend: NutritionTrend['trend'];
    if (data.neglected > total / 2) {
      trend = 'neglected';
    } else if (data.healthy >= total / 2) {
      trend = 'healthy';
    } else {
      trend = 'mixed';
    }
    return { category: category as NutritionCategory, ...data, trend };
  });
}

/**
 * Generate hazard warnings for specific areas, formatted for agent instruction injection.
 *
 * Filters extractHazardIndex() to only hazards in the target areas,
 * then formats as "WARNING: [area] — [description] (seen in S{N})".
 */
export function hazardBriefing(opts: {
  areas: string[];
  scorecards: GolfScorecard[];
}): string[] {
  const { areas, scorecards } = opts;
  if (areas.length === 0 || scorecards.length === 0) return [];

  const warnings: string[] = [];
  const loweredAreas = areas.map(a => a.toLowerCase());

  for (const sc of scorecards) {
    const sprintNum = sc.sprint_number ?? (sc as any).sprint;

    for (const shot of sc.shots ?? []) {
      for (const h of shot.hazards ?? []) {
        const desc = (h.description ?? '').toLowerCase();
        if (loweredAreas.some(area => desc.includes(area))) {
          warnings.push(`WARNING: ${h.type} — ${h.description ?? 'unknown'} (seen in S${sprintNum})`);
        }
      }
    }

    for (const loc of sc.bunker_locations ?? []) {
      const locStr = typeof loc === 'string' ? loc : (loc as Record<string, unknown>)?.area as string ?? '';
      const lowLoc = locStr.toLowerCase();
      if (loweredAreas.some(area => lowLoc.includes(area))) {
        warnings.push(`WARNING: bunker — ${locStr} (seen in S${sprintNum})`);
      }
    }
  }

  return warnings;
}

/**
 * Format the complete pre-round briefing.
 * Combines handicap card, filtered hazards, filtered common issues,
 * nutrition trends, and session continuity into a single compact output.
 *
 * Replaces reading ~15k tokens across 3-4 files with ~500 tokens of output.
 */
export function formatBriefing(opts: {
  scorecards: GolfScorecard[];
  commonIssues: CommonIssuesFile;
  lastSession?: SessionEntry;
  filter?: BriefingFilter;
  includeTraining?: boolean;
  claims?: SprintClaim[];
  roadmap?: RoadmapDefinition;
  currentSprint?: number;
  metaphor?: MetaphorDefinition;
  role?: RoleDefinition;
  recentEvents?: SlopeEvent[];
  eventRecencyWindow?: number;
  prSignal?: PRSignal;
}): string {
  const { scorecards, commonIssues, lastSession, filter, includeTraining = true, claims, roadmap, currentSprint, metaphor: m, role, recentEvents, eventRecencyWindow = 5, prSignal } = opts;
  const lines: string[] = [];

  // Merge role's briefingFilter with explicit filter (explicit filter takes precedence)
  const effectiveFilter = mergeRoleFilter(filter, role);

  // Section 1: Handicap snapshot
  const briefingTitle = m ? m.vocabulary.briefing.toUpperCase() : 'PRE-ROUND BRIEFING';
  lines.push(briefingTitle);
  if (role) {
    lines.push(`Role: ${role.name} — ${role.description}`);
  }
  lines.push('\u2550'.repeat(50));

  if (scorecards.length > 0) {
    const card = computeHandicapCard(scorecards);
    const latest = scorecards[scorecards.length - 1];
    const latestNum = latest.sprint_number ?? (latest as any).sprint;

    lines.push('');
    lines.push(`Handicap: +${card.all_time.handicap.toFixed(1)} (${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'})`);
    lines.push(`Fairways: ${card.all_time.fairway_pct.toFixed(1)}%  GIR: ${card.all_time.gir_pct.toFixed(1)}%  Putts: ${card.all_time.avg_putts.toFixed(1)}  Penalties: ${card.all_time.penalties_per_round.toFixed(1)}`);

    // Miss pattern
    const mp = card.all_time.miss_pattern;
    const totalMisses = mp.long + mp.short + mp.left + mp.right;
    if (totalMisses > 0) {
      const dirs = (['long', 'short', 'left', 'right'] as MissDirection[])
        .filter(d => mp[d] > 0)
        .map(d => `${d}:${mp[d]}`);
      lines.push(`Miss pattern: ${dirs.join(' ')} (${totalMisses} total)`);
    } else {
      lines.push('Miss pattern: Clean \u2014 no misses recorded.');
    }

    const scoreDisplay = m?.scoreLabels[latest.score_label] ?? latest.score_label;
    lines.push(`Latest: S${latestNum} ${scoreDisplay} (${latest.score} vs par ${latest.par})`);
  } else {
    lines.push('');
    lines.push('No SLOPE-era scorecards yet.');
  }

  // Section 1.5: Strategic context (from roadmap)
  if (roadmap && currentSprint) {
    const context = formatStrategicContext(roadmap, currentSprint);
    if (context) {
      lines.push('');
      lines.push('\u2500'.repeat(50));
      lines.push('STRATEGIC CONTEXT');
      for (const line of context.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  }

  // Section 2: Hazard index
  lines.push('');
  lines.push('\u2500'.repeat(50));
  lines.push('HAZARDS');

  const hazards = extractHazardIndex(scorecards, filter?.keywords?.[0]);
  let filteredBunkers = hazards.bunker_locations;
  let filteredShotHazards = hazards.shot_hazards;

  // Role-based focus area filtering: show only hazards relevant to the role's focus
  if (role && role.focusAreas.length > 0) {
    const focusLow = role.focusAreas.map(a => a.replace(/\*/g, '').replace(/\/$/, '').toLowerCase());
    filteredBunkers = filteredBunkers.filter(b =>
      focusLow.some(f => b.location.toLowerCase().includes(f)),
    );
    filteredShotHazards = filteredShotHazards.filter(h =>
      focusLow.some(f => h.description.toLowerCase().includes(f) || h.ticket.toLowerCase().includes(f)),
    );
  }

  if (filteredBunkers.length > 0 || filteredShotHazards.length > 0) {
    for (const h of filteredShotHazards) {
      lines.push(`  [S${h.sprint}] ${h.type}: ${h.description}`);
    }
    for (const b of filteredBunkers) {
      lines.push(`  [S${b.sprint}] ${b.location}`);
    }
  } else {
    lines.push('  No bunker locations recorded.');
  }

  // Section 2.5: Course status (active claims)
  lines.push('');
  lines.push('\u2500'.repeat(50));
  lines.push('COURSE STATUS');

  if (!claims || claims.length === 0) {
    lines.push('  No active claims.');
  } else {
    // Group claims by player
    const byPlayer = new Map<string, SprintClaim[]>();
    for (const c of claims) {
      const list = byPlayer.get(c.player) || [];
      list.push(c);
      byPlayer.set(c.player, list);
    }
    for (const [player, playerClaims] of byPlayer) {
      lines.push(`  ${player}:`);
      for (const c of playerClaims) {
        const tag = c.scope === 'area' ? '[area]' : '[ticket]';
        const notes = c.notes ? ` — ${c.notes}` : '';
        lines.push(`    ${tag} ${c.target}${notes}`);
      }
    }

    // Show conflicts
    const conflicts = checkConflicts(claims);
    if (conflicts.length > 0) {
      lines.push('');
      lines.push('  Conflicts:');
      for (const c of conflicts) {
        const icon = c.severity === 'overlap' ? '[!!]' : '[~]';
        lines.push(`    ${icon} ${c.reason}`);
      }
    }
  }

  // Section 2.6: PR context (when available)
  if (prSignal) {
    lines.push('');
    lines.push('\u2500'.repeat(50));
    lines.push('PR CONTEXT');
    lines.push(`  PR: #${prSignal.pr_number} (${prSignal.platform})`);
    lines.push(`  Review: ${prSignal.review_decision} — ${prSignal.review_cycles} cycle(s), ${prSignal.change_request_count} change request(s)`);
    lines.push(`  Files: ${prSignal.file_count} (+${prSignal.additions} / -${prSignal.deletions})`);
    lines.push(`  CI checks: ${prSignal.ci_checks_passed} passed, ${prSignal.ci_checks_failed} failed`);
    lines.push(`  Comments: ${prSignal.comment_count}${prSignal.file_count > 0 ? ` (${(prSignal.comment_count / prSignal.file_count).toFixed(1)}/file)` : ''}`);
    if (prSignal.time_to_merge_minutes !== null) {
      const hours = Math.floor(prSignal.time_to_merge_minutes / 60);
      const mins = prSignal.time_to_merge_minutes % 60;
      lines.push(`  Time to merge: ${hours > 0 ? `${hours}h ` : ''}${mins}m`);
    }
  }

  // Section 2.75: Recent events from telemetry
  if (recentEvents && recentEvents.length > 0 && currentSprint) {
    const minSprint = currentSprint - eventRecencyWindow;
    const relevant = recentEvents.filter(e =>
      e.sprint_number != null && e.sprint_number > minSprint,
    );

    if (relevant.length > 0) {
      // Group by type for compact display
      const byType = new Map<string, SlopeEvent[]>();
      for (const e of relevant) {
        const list = byType.get(e.type) || [];
        list.push(e);
        byType.set(e.type, list);
      }

      lines.push('');
      lines.push('\u2500'.repeat(50));
      lines.push(`RECENT EVENTS (last ${eventRecencyWindow} sprints)`);
      for (const [type, events] of byType) {
        const sprints = [...new Set(events.map(e => e.sprint_number))].sort((a, b) => (a ?? 0) - (b ?? 0));
        const sprintList = sprints.map(s => `S${s}`).join(', ');
        const sample = events[0];
        const desc = (sample.data.error as string) ?? (sample.data.description as string) ?? (sample.data.area as string) ?? '';
        const descSuffix = desc ? ` — ${desc.slice(0, 80)}${desc.length > 80 ? '...' : ''}` : '';
        lines.push(`  [${type}] x${events.length} (${sprintList})${descSuffix}`);
      }
    }
  }

  // Section 3: Nutrition trends
  if (scorecards.length > 0) {
    const nutrition = computeNutritionTrend(scorecards);
    const issues = nutrition.filter(n => n.trend !== 'healthy');
    if (issues.length > 0) {
      lines.push('');
      lines.push('\u2500'.repeat(50));
      lines.push('NUTRITION ALERTS');
      for (const n of issues) {
        const icon = n.trend === 'neglected' ? '!!' : '! ';
        lines.push(`  ${icon} ${n.category}: ${n.trend} (${n.healthy}h/${n.needs_attention}a/${n.neglected}n)`);
      }
    }
  }

  // Section 4: Relevant common issues (role emphasis applied)
  let filtered = effectiveFilter
    ? filterCommonIssues(commonIssues, effectiveFilter)
    : filterCommonIssues(commonIssues, {}); // Return top 10 by recency if no filter

  // Role deemphasis: push deemphasized categories to the end
  if (role && role.briefingFilter.deemphasize.length > 0) {
    const deempSet = new Set(role.briefingFilter.deemphasize.map(d => d.toLowerCase()));
    filtered = [
      ...filtered.filter(p => !deempSet.has(p.category.toLowerCase())),
      ...filtered.filter(p => deempSet.has(p.category.toLowerCase())),
    ];
  }

  if (filtered.length > 0) {
    lines.push('');
    lines.push('\u2500'.repeat(50));
    const label = filter?.categories?.length || filter?.keywords?.length
      ? 'RELEVANT GOTCHAS'
      : 'RECENT GOTCHAS';
    lines.push(`${label} (${filtered.length}/${commonIssues.recurring_patterns.length} patterns)`);
    for (const p of filtered) {
      const lastHit = Math.max(...p.sprints_hit);
      const reporterTag = (p.reported_by && p.reported_by.length > 1) ? ` [${p.reported_by.length} reporters]` : '';
      lines.push(`  [${p.category}] ${p.title} (last: S${lastHit})${reporterTag}`);
      lines.push(`    Prevention: ${p.prevention.slice(0, 120)}${p.prevention.length > 120 ? '...' : ''}`);
    }
  }

  // Section 5: Training recommendations
  if (includeTraining && scorecards.length > 0) {
    const handicap = computeHandicapCard(scorecards);
    const dispersion = computeDispersion(scorecards);
    const plan = generateTrainingPlan({ handicap, dispersion, recentScorecards: scorecards });
    const relevant = plan.filter(t => t.priority === 'high' || t.priority === 'medium');
    if (relevant.length > 0) {
      lines.push('');
      lines.push('\u2500'.repeat(50));
      lines.push('TRAINING RECOMMENDATIONS');
      for (const item of relevant) {
        const icon = item.priority === 'high' ? '!!' : '! ';
        const adjustment = item.instruction_adjustment ?? item.description;
        const typeDisplay = m?.trainingTypes[item.type] ?? item.type;
      lines.push(`  ${icon} [${typeDisplay}] ${item.area}`);
        lines.push(`     ${adjustment.slice(0, 120)}${adjustment.length > 120 ? '...' : ''}`);
      }
    }
  }

  // Section 6: Session continuity
  if (lastSession) {
    lines.push('');
    lines.push('\u2500'.repeat(50));
    lines.push('LAST SESSION');
    lines.push(`  ${lastSession.date} \u2014 ${lastSession.sprint}`);
    lines.push(`  ${lastSession.summary}`);
    lines.push(`  Left off: ${lastSession.where_left_off}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Merge a role's briefingFilter with an explicit filter.
 * Role emphasis keywords are added to the filter's keywords list,
 * enabling role-aware filtering without losing explicit user filters.
 * Explicit filter categories/keywords take precedence — role adds to them.
 */
function mergeRoleFilter(
  filter: BriefingFilter | undefined,
  role: RoleDefinition | undefined,
): BriefingFilter | undefined {
  if (!role || role.briefingFilter.emphasize.length === 0) {
    return filter;
  }

  const roleKeywords = role.briefingFilter.emphasize;
  if (!filter) {
    return { keywords: roleKeywords };
  }

  // Merge: explicit keywords + role emphasis keywords
  const merged: BriefingFilter = { ...filter };
  if (merged.keywords && merged.keywords.length > 0) {
    // User already specified keywords — keep them, add role keywords
    merged.keywords = [...merged.keywords, ...roleKeywords];
  } else {
    merged.keywords = roleKeywords;
  }
  return merged;
}
