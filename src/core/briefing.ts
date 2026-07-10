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
import {
  formatRoadmapSprintLabel,
  formatStrategicContext,
  roadmapSprintOrderValue,
} from './roadmap.js';
import type { SkillDefinition, SkillRegistryFile } from './skills.js';

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

type BriefingHazardRelationship =
  | 'active_sprint'
  | 'direct_dependency'
  | 'transitive_dependency'
  | 'same_phase'
  | 'historical';

interface BriefingHazardProvenance {
  source_sprint: number;
  source_phase?: string;
  target_sprint: number;
  target_phase?: string;
  relationship: BriefingHazardRelationship;
  relevance: 'active' | 'historical';
}

interface ScopedBriefingHazard extends HazardEntry {
  provenance: BriefingHazardProvenance;
}

interface ScopedBriefingBunker {
  sprint: number;
  location: string;
  provenance: BriefingHazardProvenance;
}

interface ScopedBriefingHazardIndex {
  shot_hazards: ScopedBriefingHazard[];
  bunker_locations: ScopedBriefingBunker[];
  suppressed_route_directives: number;
}

/** Nutrition trend for a single category */
export interface NutritionTrend {
  category: NutritionCategory;
  healthy: number;
  needs_attention: number;
  neglected: number;
  trend: 'healthy' | 'mixed' | 'neglected';
}

export interface SkillBriefingRecommendation {
  id: string;
  name: string;
  reason: string;
  matched_terms: string[];
  score: number;
}

export interface SkillGapRecommendation {
  topic: string;
  reason: string;
  evidence: string[];
}

export interface SkillBriefingResult {
  recommendations: SkillBriefingRecommendation[];
  gaps: SkillGapRecommendation[];
}

// --- Library functions ---

const DEFAULT_BRIEFING_HAZARD_LIMIT = 12;

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

const ROUTE_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'before', 'begin', 'being', 'between',
  'agent', 'architecture', 'code', 'context', 'could', 'does', 'feature', 'from', 'gate',
  'handoff', 'into', 'next', 'only', 'other', 'phase', 'planning', 'process', 'project',
  'review', 'route', 'routes', 'routing', 'should', 'sprint', 'start', 'system', 'than',
  'that', 'their', 'then', 'there',
  'these', 'this', 'those', 'through', 'until', 'when', 'where', 'which', 'while', 'with',
  'work', 'would',
]);

function roadmapIdsEqual(roadmap: RoadmapDefinition, left: number, right: number): boolean {
  return roadmapSprintOrderValue(roadmap, left) === roadmapSprintOrderValue(roadmap, right);
}

function roadmapSprintById(roadmap: RoadmapDefinition, sprint: number) {
  return roadmap.sprints.find(candidate => roadmapIdsEqual(roadmap, candidate.id, sprint));
}

function roadmapPhaseForSprint(roadmap: RoadmapDefinition, sprint: number) {
  return roadmap.phases.find(phase => phase.sprints.some(id => roadmapIdsEqual(roadmap, id, sprint)));
}

function collectDependencyDepths(roadmap: RoadmapDefinition, sprint: number): Map<number, number> {
  const depths = new Map<number, number>();
  const root = roadmapSprintById(roadmap, sprint);
  const queue = (root?.depends_on ?? []).map(id => ({ id, depth: 1 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const order = roadmapSprintOrderValue(roadmap, current.id);
    const previous = depths.get(order);
    if (previous != null && previous <= current.depth) continue;
    depths.set(order, current.depth);
    const dependency = roadmapSprintById(roadmap, current.id);
    for (const nested of dependency?.depends_on ?? []) {
      queue.push({ id: nested, depth: current.depth + 1 });
    }
  }
  return depths;
}

function meaningfulRouteTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  return new Set(tokens.filter(token => !ROUTE_STOP_WORDS.has(token) && !/^s\d/.test(token)));
}

function currentAssignmentTokens(roadmap: RoadmapDefinition, sprint: number): Set<string> {
  const row = roadmapSprintById(roadmap, sprint);
  const phase = roadmapPhaseForSprint(roadmap, sprint);
  return meaningfulRouteTokens([
    row?.theme,
    row?.type,
    row?.note,
    row?.outcome,
    ...(row?.tickets ?? []).flatMap(ticket => [ticket.title, ticket.note]),
    phase?.name,
    phase?.description,
    phase?.note,
  ].filter((value): value is string => typeof value === 'string').join(' '));
}

function sprintMentionPattern(roadmap: RoadmapDefinition, sprint: number): RegExp {
  const raw = String(sprint).replace('.', '\\.');
  const order = String(roadmapSprintOrderValue(roadmap, sprint)).replace('.', '\\.');
  const label = formatRoadmapSprintLabel(roadmap, sprint).slice(1).replace('.', '\\.');
  const aliases = [...new Set([raw, order, label])].join('|');
  return new RegExp(`\\bS(?:${aliases})\\b`, 'i');
}

function extractTargetAssignmentPremise(sentence: string, mention: RegExp): string | null {
  const target = mention.source;
  const routedAfterTarget = new RegExp(
    `${target}\\s+(?:routes?\\s+to|becomes?|is\\s+(?:now\\s+)?(?:assigned|reassigned)\\s+to|follows?|hands?\\s+off\\s+to)\\s+(.+?)(?=\\s+(?:before|after|as\\s+if|because)\\b|[;,.!?]|$)`,
    'i',
  ).exec(sentence);
  if (routedAfterTarget?.[1]) return routedAfterTarget[1];

  const startAsAssignment = new RegExp(
    `(?:do\\s+not|don['’]t)?\\s*(?:start|begin)\\s+${target}\\s+(?!until\\b|before\\b|after\\b|if\\b|when\\b)(.+?)(?=\\s+(?:as\\s+if|before|after|because)\\b|[;,.!?]|$)`,
    'i',
  ).exec(sentence);
  return startAsAssignment?.[1] ?? null;
}

function stripSupersededRouteDirectives(
  description: string,
  roadmap: RoadmapDefinition,
  targetSprint: number,
  assignmentTokens: Set<string>,
): { description: string; suppressed: number } {
  const mention = sprintMentionPattern(roadmap, targetSprint);
  const sentences = description.split(/(?<=[.!?;])\s+/);
  const kept: string[] = [];
  let suppressed = 0;
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    const assignmentPremise = extractTargetAssignmentPremise(sentence, mention);
    if (!assignmentPremise) {
      kept.push(sentence);
      continue;
    }
    const premiseTokens = meaningfulRouteTokens(assignmentPremise);
    const matchesAssignment = [...premiseTokens].some(token => assignmentTokens.has(token));
    if (matchesAssignment) kept.push(sentence);
    else suppressed++;
  }
  return { description: kept.join(' '), suppressed };
}

/**
 * Derive current-roadmap provenance for immutable scorecard hazards. Route-like
 * sentences that name the requested sprint are removed only when their premise
 * has no meaningful overlap with that sprint's current authored assignment.
 */
function scopeBriefingHazards(
  index: ReturnType<typeof extractHazardIndex>,
  roadmap: RoadmapDefinition,
  currentSprint: number,
): ScopedBriefingHazardIndex {
  const target = roadmapSprintById(roadmap, currentSprint);
  if (!target) {
    return { shot_hazards: [], bunker_locations: [], suppressed_route_directives: 0 };
  }
  const targetPhase = roadmapPhaseForSprint(roadmap, currentSprint);
  const dependencyDepths = collectDependencyDepths(roadmap, currentSprint);
  const assignmentTokens = currentAssignmentTokens(roadmap, currentSprint);
  let suppressed = 0;

  const provenanceFor = (sourceSprint: number): BriefingHazardProvenance => {
    const sourcePhase = roadmapPhaseForSprint(roadmap, sourceSprint);
    const dependencyDepth = dependencyDepths.get(roadmapSprintOrderValue(roadmap, sourceSprint));
    let relationship: BriefingHazardRelationship = 'historical';
    if (roadmapIdsEqual(roadmap, sourceSprint, currentSprint)) relationship = 'active_sprint';
    else if (dependencyDepth === 1) relationship = 'direct_dependency';
    else if (dependencyDepth != null) relationship = 'transitive_dependency';
    else if (sourcePhase
      && targetPhase
      && sourcePhase === targetPhase
      && roadmapSprintOrderValue(roadmap, sourceSprint) < roadmapSprintOrderValue(roadmap, target.id)) {
      relationship = 'same_phase';
    }
    return {
      source_sprint: sourceSprint,
      source_phase: sourcePhase?.name,
      target_sprint: target.id,
      target_phase: targetPhase?.name,
      relationship,
      relevance: relationship === 'active_sprint' ? 'active' : 'historical',
    };
  };

  const shotHazards: ScopedBriefingHazard[] = [];
  for (const hazard of index.shot_hazards) {
    const scoped = roadmapIdsEqual(roadmap, hazard.sprint, target.id)
      ? { description: hazard.description, suppressed: 0 }
      : stripSupersededRouteDirectives(hazard.description, roadmap, target.id, assignmentTokens);
    suppressed += scoped.suppressed;
    if (!scoped.description) continue;
    shotHazards.push({ ...hazard, description: scoped.description, provenance: provenanceFor(hazard.sprint) });
  }

  const bunkerLocations: ScopedBriefingBunker[] = [];
  for (const bunker of index.bunker_locations) {
    const scoped = roadmapIdsEqual(roadmap, bunker.sprint, target.id)
      ? { description: bunker.location, suppressed: 0 }
      : stripSupersededRouteDirectives(bunker.location, roadmap, target.id, assignmentTokens);
    suppressed += scoped.suppressed;
    if (!scoped.description) continue;
    bunkerLocations.push({ ...bunker, location: scoped.description, provenance: provenanceFor(bunker.sprint) });
  }

  return {
    shot_hazards: shotHazards,
    bunker_locations: bunkerLocations,
    suppressed_route_directives: suppressed,
  };
}

function formatBriefingHazardProvenance(
  provenance: BriefingHazardProvenance,
  roadmap: RoadmapDefinition,
): string {
  const source = formatRoadmapSprintLabel(roadmap, provenance.source_sprint);
  const target = formatRoadmapSprintLabel(roadmap, provenance.target_sprint);
  const phase = provenance.source_phase ?? 'unassigned phase';
  const relationship = provenance.relationship === 'active_sprint'
    ? 'active'
    : provenance.relationship === 'direct_dependency'
      ? `direct dependency history for ${target}`
      : provenance.relationship === 'transitive_dependency'
        ? `transitive dependency history for ${target}`
        : provenance.relationship === 'same_phase'
          ? 'phase history'
          : 'historical';
  return `[${source} | ${phase} | ${relationship}]`;
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

export function buildSkillBriefing(opts: {
  registry?: SkillRegistryFile | null;
  scorecards: GolfScorecard[];
  commonIssues: CommonIssuesFile;
  filter?: BriefingFilter;
  roadmap?: RoadmapDefinition;
  currentSprint?: number;
  claims?: SprintClaim[];
  changedFiles?: string[];
  maxRecommendations?: number;
  maxGaps?: number;
}): SkillBriefingResult {
  const { registry, scorecards, commonIssues, filter, roadmap, currentSprint, claims, changedFiles } = opts;
  if (!registry || !Array.isArray(registry.skills) || registry.skills.length === 0) {
    return { recommendations: [], gaps: [] };
  }

  const sprint = currentSprint != null
    ? roadmap?.sprints.find(s => s.id === currentSprint)
    : undefined;
  const sprintText = normalizeSearchText(sprint ? collectStringValues(sprint).join(' ') : '');
  const filterText = normalizeSearchText([
    ...(filter?.categories ?? []),
    ...(filter?.keywords ?? []),
  ].join(' '));
  const rawHazardIndex = extractHazardIndex(scorecards);
  const scopedHazardIndex = roadmap && currentSprint != null && roadmapSprintById(roadmap, currentSprint)
    ? scopeBriefingHazards(rawHazardIndex, roadmap, currentSprint)
    : undefined;
  const relevantHazards = scopedHazardIndex
    ? scopedHazardIndex.shot_hazards.filter(hazard =>
      hazard.provenance.relationship !== 'historical'
      && hazard.provenance.relationship !== 'transitive_dependency')
    : rawHazardIndex.shot_hazards;
  const relevantBunkers = scopedHazardIndex
    ? scopedHazardIndex.bunker_locations.filter(bunker =>
      bunker.provenance.relationship !== 'historical'
      && bunker.provenance.relationship !== 'transitive_dependency')
    : rawHazardIndex.bunker_locations;
  const recentHazards = [...relevantHazards]
    .sort((a, b) => b.sprint - a.sprint)
    .slice(0, 20);
  const hazardText = normalizeSearchText([
    ...recentHazards.map(h => `${h.type} ${h.ticket} ${h.description}`),
    ...relevantBunkers.slice(-10).map(b => b.location),
  ].join(' '));
  const changedFilesText = normalizeSearchText([
    ...(claims ?? []).map(c => c.target),
    ...(changedFiles ?? []),
  ].join(' '));
  const requestedScorecard = currentSprint != null
    ? scorecards.find(card => scorecardSprintNumber(card) === currentSprint)
    : undefined;
  const requestedSkillIds = collectRequestedScorecardSkillIds(requestedScorecard);
  const historicalSkillIds = collectScorecardSkillIds(scorecards);

  const contextTokens = new Set([
    ...tokensFromText(sprintText),
    ...tokensFromText(filterText),
    ...tokensFromText(hazardText),
    ...tokensFromText(changedFilesText),
  ]);

  const recommendations = registry.skills
    .map(skill => scoreSkill(skill, { sprintText, filterText, hazardText, changedFilesText, contextTokens, requestedSkillIds, historicalSkillIds }))
    .filter((rec): rec is SkillBriefingRecommendation => rec != null)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, opts.maxRecommendations ?? 5);

  const gaps = findSkillGaps({
    registry,
    commonIssues,
    filter,
    scorecards,
    requestedScorecard,
    maxGaps: opts.maxGaps ?? 3,
  });

  return { recommendations, gaps };
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
  skillRegistry?: SkillRegistryFile | null;
}): string {
  const { scorecards, commonIssues, lastSession, filter, includeTraining = true, claims, roadmap, currentSprint, metaphor: m, role, recentEvents, eventRecencyWindow = 5, prSignal, skillRegistry } = opts;
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

  const skillBriefing = buildSkillBriefing({
    registry: skillRegistry,
    scorecards,
    commonIssues,
    filter: effectiveFilter,
    roadmap,
    currentSprint,
    claims,
  });

  if (skillBriefing.recommendations.length > 0 || skillBriefing.gaps.length > 0) {
    lines.push('');
    lines.push('\u2500'.repeat(50));
    lines.push('RECOMMENDED SKILLS');
    if (skillBriefing.recommendations.length === 0) {
      lines.push('  No registered skills matched this briefing context.');
    } else {
      for (const rec of skillBriefing.recommendations) {
        const terms = rec.matched_terms.length > 0 ? ` (${rec.matched_terms.join(', ')})` : '';
        lines.push(`  ${rec.id}: ${rec.reason}${terms}`);
      }
    }
    if (skillBriefing.gaps.length > 0) {
      lines.push('');
      lines.push('  Skill gaps to consider:');
      for (const gap of skillBriefing.gaps) {
        lines.push(`    - ${gap.topic}: ${gap.reason}`);
      }
    }
  }

  // Section 2: Hazard index
  lines.push('');
  lines.push('\u2500'.repeat(50));
  lines.push('HAZARDS');

  const hazards = extractHazardIndex(scorecards, filter?.keywords?.[0]);
  const scopedHazards = roadmap && currentSprint && roadmapSprintById(roadmap, currentSprint)
    ? scopeBriefingHazards(hazards, roadmap, currentSprint)
    : undefined;
  let filteredBunkers: Array<{ sprint: number; location: string; provenance?: BriefingHazardProvenance }> =
    scopedHazards?.bunker_locations ?? hazards.bunker_locations;
  let filteredShotHazards: Array<HazardEntry & { provenance?: BriefingHazardProvenance }> =
    scopedHazards?.shot_hazards ?? hazards.shot_hazards;

  // With a resolved roadmap target, default output contains only the selected
  // sprint, direct dependencies, and prior work in its current phase. An
  // explicit keyword remains an escape hatch into labelled transitive or
  // unrelated historical evidence.
  if (scopedHazards && !effectiveFilter?.keywords?.length) {
    filteredBunkers = filteredBunkers.filter(b =>
      b.provenance?.relationship !== 'historical'
      && b.provenance?.relationship !== 'transitive_dependency');
    filteredShotHazards = filteredShotHazards.filter(h =>
      h.provenance?.relationship !== 'historical'
      && h.provenance?.relationship !== 'transitive_dependency');
  }

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
    const hazardLines = [
      ...filteredShotHazards.map(h => ({
        sprint: h.sprint,
        order: roadmap ? roadmapSprintOrderValue(roadmap, h.sprint) : h.sprint,
        line: scopedHazards && h.provenance
          ? `  ${formatBriefingHazardProvenance(h.provenance, roadmap!)} ${h.type}: ${h.description}`
          : `  [S${h.sprint}] ${h.type}: ${h.description}`,
      })),
      ...filteredBunkers.map(b => ({
        sprint: b.sprint,
        order: roadmap ? roadmapSprintOrderValue(roadmap, b.sprint) : b.sprint,
        line: scopedHazards && b.provenance
          ? `  ${formatBriefingHazardProvenance(b.provenance, roadmap!)} bunker: ${b.location}`
          : `  [S${b.sprint}] ${b.location}`,
      })),
    ].sort((a, b) => b.order - a.order);

    for (const entry of hazardLines.slice(0, DEFAULT_BRIEFING_HAZARD_LIMIT)) {
      lines.push(entry.line);
    }
    const omitted = hazardLines.length - DEFAULT_BRIEFING_HAZARD_LIMIT;
    if (omitted > 0) {
      lines.push(`  ... ${omitted} older hazard${omitted === 1 ? '' : 's'} omitted. Use --keywords=<term> or --categories=<category> to focus the briefing.`);
    }
  } else {
    lines.push(scopedHazards ? '  No hazards relevant to the current roadmap context.' : '  No bunker locations recorded.');
  }
  if (scopedHazards && scopedHazards.suppressed_route_directives > 0) {
    lines.push(`  Suppressed ${scopedHazards.suppressed_route_directives} superseded route directive${scopedHazards.suppressed_route_directives === 1 ? '' : 's'} that no longer match ${formatRoadmapSprintLabel(roadmap!, currentSprint!)}'s roadmap assignment.`);
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

function scoreSkill(
  skill: SkillDefinition,
  context: {
    sprintText: string;
    filterText: string;
    hazardText: string;
    changedFilesText: string;
    contextTokens: Set<string>;
    requestedSkillIds: Set<string>;
    historicalSkillIds: Set<string>;
  },
): SkillBriefingRecommendation | null {
  let score = 0;
  const matchedTerms = new Set<string>();
  const reasons: string[] = [];
  const phrases = skillMatchPhrases(skill);

  if (context.requestedSkillIds.has(skill.id)) {
    score += 20;
    addReason(reasons, 'requested sprint scorecard');
  }

  for (const phrase of phrases) {
    const normalized = normalizeSearchText(phrase);
    if (!normalized || normalized.length < 3) continue;
    if (SKILL_STOPWORDS.has(normalized)) continue;
    if (containsPhrase(context.sprintText, normalized)) {
      score += 5;
      matchedTerms.add(phrase);
      addReason(reasons, 'sprint text');
    }
    if (containsPhrase(context.filterText, normalized)) {
      score += 4;
      matchedTerms.add(phrase);
      addReason(reasons, 'briefing filters');
    }
    if (containsPhrase(context.hazardText, normalized)) {
      score += 3;
      matchedTerms.add(phrase);
      addReason(reasons, 'recent hazards');
    }
    if (containsPhrase(context.changedFilesText, normalized)) {
      score += 4;
      matchedTerms.add(phrase);
      addReason(reasons, 'changed files');
    }
  }

  const skillTokens = tokensFromText([
    skill.id,
    skill.name,
    skill.description,
    ...(skill.triggers ?? []),
    ...(skill.tags ?? []),
  ].join(' '));
  const tokenMatches = [...skillTokens].filter(token => context.contextTokens.has(token)).slice(0, 5);
  if (tokenMatches.length > 0) {
    score += tokenMatches.length;
    for (const token of tokenMatches) matchedTerms.add(token);
    addReason(reasons, 'related terminology');
  }

  if (context.historicalSkillIds.has(skill.id)) {
    score += 2;
    addReason(reasons, 'scorecard skill history');
  }

  if (score <= 0) return null;
  return {
    id: skill.id,
    name: skill.name,
    reason: `matches ${reasons.join(', ')}`,
    matched_terms: [...matchedTerms].sort((a, b) => a.localeCompare(b)).slice(0, 5),
    score,
  };
}

function findSkillGaps(opts: {
  registry: SkillRegistryFile;
  commonIssues: CommonIssuesFile;
  filter?: BriefingFilter;
  scorecards: GolfScorecard[];
  requestedScorecard?: GolfScorecard;
  maxGaps: number;
}): SkillGapRecommendation[] {
  const gaps: SkillGapRecommendation[] = [];
  const relevantIssues = opts.filter
    ? filterCommonIssues(opts.commonIssues, opts.filter)
    : filterCommonIssues(opts.commonIssues, {}).slice(0, 5);

  for (const issue of relevantIssues) {
    if (issue.sprints_hit.length < 2) continue;
    if (isCoveredBySkill(issue.title, opts.registry.skills)) continue;
    gaps.push({
      topic: issue.title,
      reason: `recurs across ${issue.sprints_hit.length} sprint(s) but has no matching registered skill`,
      evidence: issue.sprints_hit.map(s => `S${s}`).slice(-5),
    });
    if (gaps.length >= opts.maxGaps) return gaps;
  }

  const seenGapTopics = new Set(gaps.map(g => normalizeSearchText(g.topic)));
  const gapCards = uniqueScorecards([
    ...(opts.requestedScorecard ? [opts.requestedScorecard] : []),
    ...opts.scorecards.slice(-10),
  ]);
  for (const card of gapCards) {
    for (const gap of card.skill_gaps_found ?? []) {
      const normalized = normalizeSearchText(gap);
      if (!normalized || seenGapTopics.has(normalized)) continue;
      if (isCoveredBySkill(gap, opts.registry.skills)) continue;
      seenGapTopics.add(normalized);
      const requested = opts.requestedScorecard && scorecardSprintNumber(card) === scorecardSprintNumber(opts.requestedScorecard);
      gaps.push({
        topic: gap,
        reason: requested ? 'recorded in requested sprint skill_gaps_found' : 'recorded in recent scorecard skill_gaps_found',
        evidence: [`S${scorecardSprintNumber(card)}`],
      });
      if (gaps.length >= opts.maxGaps) return gaps;
    }
  }

  return gaps;
}

function isCoveredBySkill(topic: string, skills: SkillDefinition[]): boolean {
  const normalized = normalizeSearchText(topic);
  const topicTokens = tokensFromText(normalized);
  if (topicTokens.size === 0) return false;
  return skills.some(skill => {
    const phrases = skillMatchPhrases(skill).map(normalizeSearchText);
    if (phrases.some(phrase => phrase && containsPhrase(normalized, phrase))) return true;
    const skillTokens = tokensFromText([
      skill.id,
      skill.name,
      skill.description,
      ...(skill.triggers ?? []),
      ...(skill.tags ?? []),
    ].join(' '));
    let matches = 0;
    for (const token of topicTokens) {
      if (skillTokens.has(token)) matches += 1;
    }
    return matches >= Math.min(2, topicTokens.size);
  });
}

function skillMatchPhrases(skill: SkillDefinition): string[] {
  return uniqueStrings([
    skill.id,
    skill.name,
    ...skill.id.split(/[._-]+/).filter(Boolean),
    ...(skill.triggers ?? []),
    ...(skill.tags ?? []),
  ]);
}

function collectRequestedScorecardSkillIds(scorecard?: GolfScorecard): Set<string> {
  const ids = new Set<string>();
  if (!scorecard) return ids;
  for (const id of [
    ...(scorecard.skills_used ?? []),
    ...(scorecard.skills_created ?? []),
    ...(scorecard.skills_recommended ?? []),
  ]) {
    ids.add(id);
  }
  return ids;
}

function collectScorecardSkillIds(scorecards: GolfScorecard[]): Set<string> {
  const ids = new Set<string>();
  for (const card of scorecards) {
    for (const id of [
      ...(card.skills_used ?? []),
      ...(card.skills_created ?? []),
      ...(card.skills_recommended ?? []),
      ...(card.skills_skipped ?? []),
    ]) {
      ids.add(id);
    }
  }
  return ids;
}

function scorecardSprintNumber(card: GolfScorecard): number {
  return card.sprint_number ?? (card as { sprint?: number }).sprint ?? 0;
}

function uniqueScorecards(cards: GolfScorecard[]): GolfScorecard[] {
  const seen = new Set<number>();
  const unique: GolfScorecard[] = [];
  for (const card of cards) {
    const sprint = scorecardSprintNumber(card);
    if (seen.has(sprint)) continue;
    seen.add(sprint);
    unique.push(card);
  }
  return unique;
}

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, out);
  }
  return out;
}

const SKILL_STOPWORDS = new Set([
  'and', 'for', 'from', 'into', 'this', 'that', 'the', 'use', 'uses', 'with',
  'when', 'work', 'slope', 'skill', 'skills', 'agent', 'agents',
]);

function tokensFromText(text: string): Set<string> {
  return new Set(normalizeSearchText(text)
    .split(' ')
    .filter(token => token.length >= 3 && !SKILL_STOPWORDS.has(token)));
}

function normalizeSearchText(value: string): string {
  let out = '';
  let lastSpace = true;
  for (const char of value.toLowerCase()) {
    const code = char.charCodeAt(0);
    const isAlphaNum = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isAlphaNum) {
      out += char;
      lastSpace = false;
    } else if (!lastSpace) {
      out += ' ';
      lastSpace = true;
    }
  }
  return out.trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
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
