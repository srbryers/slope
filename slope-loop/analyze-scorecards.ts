#!/usr/bin/env npx tsx
/**
 * analyze-scorecards.ts — Mine sprint scorecard data to generate
 * a prioritized backlog for the autonomous loop.
 *
 * Outputs:
 *   - slope-loop/analysis.json    (raw analysis with temporal weighting)
 *   - slope-loop/backlog.json     (generated sprint backlog)
 *
 * Run: npx tsx slope-loop/analyze-scorecards.ts
 *
 * Requires: pnpm build (imports from local build output)
 */

import {
  loadScorecards,
  loadConfig,
  computeHandicapCard,
  computeDispersion,
} from '../dist/index.js';
import type {
  DispersionReport,
} from '../dist/index.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BacklogSprint, PlannedSprint } from '../src/cli/loop/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- File Reference Extraction ---

// Match patterns like "enrich.ts", "src/core/prep.ts", "run.sh"
export const FILE_REF_PATTERN = /\b((?:[\w.-]+\/)*[\w.-]+\.(?:ts|js|sh|json))\b/g;

// Bare basenames that are too ambiguous — could match dozens of files in any project.
// Only filtered when they appear without a path component (no '/').
export const AMBIGUOUS_BASENAMES = new Set([
  'test', 'index', 'init', 'utils', 'helpers', 'types', 'config',
  'constants', 'main', 'app', 'server', 'client', 'store', 'router',
]);

export function extractFileRefs(texts: string[]): string[] {
  const refs = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(FILE_REF_PATTERN)) {
      const file = match[1];
      // Skip non-source bare json files (e.g. "analysis.json")
      if (file.endsWith('.json') && !file.includes('/')) continue;
      // Skip docs, templates, config, build output, and dotfile directories
      // Note: \b in the regex strips leading dots, so .claude/ becomes claude/
      if (/^(docs|templates|\.?claude|\.?slope|dist|node_modules)\//.test(file)) continue;
      // Skip test files — hotspots should target production code, not tests
      if (/\.(test|spec)\.(ts|js)$/.test(file)) continue;
      // Skip bare basenames that are too ambiguous (no path component)
      // e.g., "test.ts", "init.ts", "index.ts" — could match dozens of files
      if (!file.includes('/') && AMBIGUOUS_BASENAMES.has(file.replace(/\.[^.]+$/, ''))) continue;
      refs.add(file);
    }
  }

  // Prefer path-qualified refs over bare basenames
  // e.g., if we have both "enrich.ts" and "src/core/enrich.ts", keep only the path
  const pathQualified = new Map<string, string>();
  for (const ref of refs) {
    const base = ref.split('/').pop()!;
    const existing = pathQualified.get(base);
    if (!existing || (ref.includes('/') && !existing.includes('/'))) {
      pathQualified.set(base, ref);
    }
  }
  return [...new Set(pathQualified.values())];
}

// --- Temporal Weighting ---

const RECENCY_WEIGHT = 0.7;
const RECENT_WINDOW = 10; // last N sprints weighted higher

// Max roadmap sprints per regeneration cycle — forces a regression re-check
// between batches. If a roadmap sprint introduces a hazard, the next analyze
// cycle surfaces it as Strategy 1 before more roadmap sprints run.
export const ROADMAP_SPRINT_CAP = 3;

function temporalWeight(
  totalCount: number,
  recentCount: number,
): number {
  return (recentCount * RECENCY_WEIGHT) + (totalCount * (1 - RECENCY_WEIGHT));
}

// --- Analysis ---

interface HazardFrequency {
  type: string;
  total_count: number;
  recent_count: number;
  weighted_score: number;
}

interface MissPattern {
  direction: string;
  count: number;
  by_club: Record<string, number>;
}

interface ClubStats {
  club: string;
  total: number;
  success: number;
  success_rate: number;
}

interface HotspotModule {
  area: string;
  risk_score: number;
  hazard_types: Record<string, number>;
  source_files: string[];
  hazard_descriptions: string[];
}

interface Analysis {
  generated_at: string;
  sprint_count: number;
  handicap: {
    current: number;
    trend: string;
    last_5: number;
    last_10: number;
    all_time: number;
  };
  hazards: {
    frequency: HazardFrequency[];
    by_module: Record<string, Record<string, number>>;
    type_files: Record<string, string[]>;
    type_descriptions: Record<string, string[]>;
  };
  misses: {
    frequency: MissPattern[];
    by_club: Record<string, Record<string, number>>;
  };
  scores: Record<string, number>;
  clubs: ClubStats[];
  hotspots: HotspotModule[];
  dispersion: DispersionReport;
}

function analyze(): void {
  const cwd = join(__dirname, '..');
  const config = loadConfig(cwd);
  const scorecards = loadScorecards(config, cwd);

  if (scorecards.length === 0) {
    console.error('No scorecards found. Run from the SLOPE repo root.');
    process.exit(1);
  }

  const handicap = computeHandicapCard(scorecards);
  const dispersion = computeDispersion(scorecards);

  console.log(`\nLoaded ${scorecards.length} scorecards\n`);

  // Sort by sprint number for recency calculation
  const sorted = [...scorecards].sort((a, b) => a.sprint_number - b.sprint_number);
  const recentCutoff = sorted.length > RECENT_WINDOW
    ? sorted[sorted.length - RECENT_WINDOW].sprint_number
    : 0;

  // --- 1. Hazard frequency analysis (with temporal weighting) ---

  const hazardTotalCounts: Record<string, number> = {};
  const hazardRecentCounts: Record<string, number> = {};
  const hazardByModule: Record<string, Record<string, number>> = {};
  // Track source files and descriptions per area
  const hazardFileRefs: Record<string, Set<string>> = {};
  const hazardDescs: Record<string, string[]> = {};
  // Track file refs per hazard type (for cleanup strategy)
  const hazardTypeFiles: Record<string, Set<string>> = {};
  const hazardTypeDescs: Record<string, string[]> = {};

  for (const card of scorecards) {
    const isRecent = card.sprint_number >= recentCutoff;
    for (const shot of card.shots ?? []) {
      for (const hazard of shot.hazards ?? []) {
        const type = hazard.type;
        hazardTotalCounts[type] = (hazardTotalCounts[type] ?? 0) + 1;
        if (isRecent) {
          hazardRecentCounts[type] = (hazardRecentCounts[type] ?? 0) + 1;
        }

        // Track which modules/areas hazards cluster in
        const area = shot.title ?? 'unknown';
        if (!hazardByModule[area]) hazardByModule[area] = {};
        hazardByModule[area][type] = (hazardByModule[area][type] ?? 0) + 1;

        // Extract file refs from hazard descriptions
        const desc = hazard.description ?? '';
        const refs = extractFileRefs([desc]);
        if (!hazardFileRefs[area]) hazardFileRefs[area] = new Set();
        for (const ref of refs) hazardFileRefs[area].add(ref);
        if (!hazardDescs[area]) hazardDescs[area] = [];
        if (desc) hazardDescs[area].push(desc);

        // Track per hazard type (for cleanup strategy)
        if (!hazardTypeFiles[type]) hazardTypeFiles[type] = new Set();
        for (const ref of refs) hazardTypeFiles[type].add(ref);
        if (!hazardTypeDescs[type]) hazardTypeDescs[type] = [];
        if (desc) hazardTypeDescs[type].push(desc);
      }
    }

    // Extract file refs from bunker_locations (architectural hazards)
    for (const bunker of card.bunker_locations ?? []) {
      const refs = extractFileRefs([bunker]);
      if (refs.length > 0) {
        if (!hazardTypeFiles['bunker']) hazardTypeFiles['bunker'] = new Set();
        for (const ref of refs) hazardTypeFiles['bunker'].add(ref);
        if (!hazardTypeDescs['bunker']) hazardTypeDescs['bunker'] = [];
        hazardTypeDescs['bunker'].push(bunker);
      }
    }
  }

  // Dynamic threshold: >= Math.ceil(scorecards.length * 0.1)
  const recurringThreshold = Math.ceil(scorecards.length * 0.1);

  const hazardFrequency: HazardFrequency[] = Object.entries(hazardTotalCounts)
    .map(([type, total]) => ({
      type,
      total_count: total,
      recent_count: hazardRecentCounts[type] ?? 0,
      weighted_score: temporalWeight(total, hazardRecentCounts[type] ?? 0),
    }))
    .filter(h => h.weighted_score >= recurringThreshold)
    .sort((a, b) => b.weighted_score - a.weighted_score);

  // --- 2. Miss pattern analysis ---

  const missCounts: Record<string, number> = {};
  const missByClub: Record<string, Record<string, number>> = {};

  for (const card of scorecards) {
    for (const shot of card.shots ?? []) {
      const result = shot.result;
      if (result && result.startsWith('missed_')) {
        const direction = result.replace('missed_', '');
        missCounts[direction] = (missCounts[direction] ?? 0) + 1;

        const club = shot.club ?? 'unknown';
        if (!missByClub[club]) missByClub[club] = {};
        missByClub[club][direction] = (missByClub[club][direction] ?? 0) + 1;
      }
    }
  }

  const missPatterns: MissPattern[] = Object.entries(missCounts)
    .map(([direction, count]) => ({
      direction,
      count,
      by_club: Object.fromEntries(
        Object.entries(missByClub)
          .filter(([_, dirs]) => dirs[direction])
          .map(([club, dirs]) => [club, dirs[direction]]),
      ),
    }))
    .sort((a, b) => b.count - a.count);

  // --- 3. Score distribution ---

  const scoreDist: Record<string, number> = {};
  for (const card of scorecards) {
    const label = card.score_label ?? 'unknown';
    scoreDist[label] = (scoreDist[label] ?? 0) + 1;
  }

  // --- 4. Club success rates ---

  const clubData: Record<string, { total: number; success: number }> = {};
  for (const card of scorecards) {
    for (const shot of card.shots ?? []) {
      const club = shot.club ?? 'unknown';
      if (!clubData[club]) clubData[club] = { total: 0, success: 0 };
      clubData[club].total++;
      if (['green', 'in_the_hole', 'fairway'].includes(shot.result ?? '')) {
        clubData[club].success++;
      }
    }
  }

  const clubStats: ClubStats[] = Object.entries(clubData)
    .map(([club, data]) => ({
      club,
      total: data.total,
      success: data.success,
      success_rate: data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // --- 5. Hotspot modules ---

  const moduleRisk: Record<string, { score: number; hazards: Record<string, number> }> = {};
  for (const [area, hazards] of Object.entries(hazardByModule)) {
    const score = Object.values(hazards).reduce((a, b) => a + b, 0);
    moduleRisk[area] = { score, hazards };
  }

  const hotspots: HotspotModule[] = Object.entries(moduleRisk)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 15)
    .map(([area, data]) => ({
      area,
      risk_score: data.score,
      hazard_types: data.hazards,
      source_files: [...(hazardFileRefs[area] ?? [])].filter(f => existsSync(join(cwd, f))),
      hazard_descriptions: (hazardDescs[area] ?? []).slice(0, 5),
    }));

  // --- Build analysis output ---

  const analysis: Analysis = {
    generated_at: new Date().toISOString(),
    sprint_count: scorecards.length,
    handicap: {
      current: handicap.last_5.handicap,
      trend: handicap.last_5.handicap <= handicap.last_10.handicap ? 'improving' : 'declining',
      last_5: handicap.last_5.handicap,
      last_10: handicap.last_10.handicap,
      all_time: handicap.all_time.handicap,
    },
    hazards: {
      frequency: hazardFrequency,
      by_module: hazardByModule,
      type_files: Object.fromEntries(
        Object.entries(hazardTypeFiles).map(([k, v]) => [k, [...v].filter(f => existsSync(join(cwd, f)))]),
      ),
      type_descriptions: Object.fromEntries(
        Object.entries(hazardTypeDescs).map(([k, v]) => [k, v.slice(0, 10)]),
      ),
    },
    misses: {
      frequency: missPatterns,
      by_club: missByClub,
    },
    scores: scoreDist,
    clubs: clubStats,
    hotspots,
    dispersion,
  };

  writeFileSync(
    join(__dirname, 'analysis.json'),
    JSON.stringify(analysis, null, 2) + '\n',
  );

  // --- Print summary ---

  console.log('=== Analysis Summary ===\n');
  const currentHandicap = handicap.last_5.handicap;
  const trend = handicap.last_5.handicap <= handicap.last_10.handicap ? 'improving' : 'declining';
  console.log(`Sprints analyzed: ${scorecards.length}`);
  console.log(`Current handicap: ${currentHandicap} (${trend})`);
  console.log(`Recency window: last ${RECENT_WINDOW} sprints (weight: ${RECENCY_WEIGHT})`);
  console.log(`Recurring threshold: ${recurringThreshold} (dynamic: ceil(${scorecards.length} * 0.1))`);

  if (hazardFrequency.length > 0) {
    console.log(`\nTop recurring hazards (temporally weighted):`);
    for (const h of hazardFrequency.slice(0, 5)) {
      console.log(`  ${h.type}: weighted=${h.weighted_score.toFixed(1)} (total=${h.total_count}, recent=${h.recent_count})`);
    }
  }

  if (hotspots.length > 0) {
    // Count file refs pruned by existence check
    const totalRefs = Object.values(hazardFileRefs).reduce((n, s) => n + s.size, 0);
    const validRefs = hotspots.reduce((n, h) => n + h.source_files.length, 0);
    const pruned = totalRefs - validRefs;
    console.log(`\nHotspot areas (${pruned > 0 ? `${pruned} stale file ref(s) pruned` : 'all refs valid'}):`);
    for (const h of hotspots.slice(0, 5)) {
      console.log(`  ${h.area}: risk score ${h.risk_score}, ${h.source_files.length} file(s)`);
    }
  }

  console.log(`\nClub success rates:`);
  for (const c of clubStats) {
    console.log(`  ${c.club}: ${c.success_rate}% (${c.success}/${c.total})`);
  }

  if (missPatterns.length > 0) {
    console.log(`\nMiss patterns:`);
    for (const m of missPatterns) {
      console.log(`  ${m.direction}: ${m.count}`);
    }
  }

  console.log(`\nFull analysis: slope-loop/analysis.json`);

  // --- Generate backlog ---

  generateBacklog(analysis, scorecards.length);
}

// --- Roadmap Fallback ---

/**
 * Convert planned sprints from roadmap.json into BacklogSprint format.
 * Caps at ROADMAP_SPRINT_CAP sprints per cycle to force a regression re-check
 * between batches (if a roadmap sprint introduces a hazard, the next analyze
 * cycle picks it up as Strategy 1).
 *
 * **Known limitation:** Completion is tracked by sequential counter position,
 * not by the planned sprint's display ID. If the `planned` array in
 * roadmap.json is reordered between analyze cycles, sprints may be skipped
 * or re-run. This is acceptable since the array is author-maintained and
 * rarely changes.
 */
export function convertPlannedSprints(
  planned: PlannedSprint[],
  startCounter: number,
  repoRoot: string,
): { sprints: BacklogSprint[]; counter: number } {
  const sprints: BacklogSprint[] = [];
  let counter = startCounter;
  const resultsDir = join(repoRoot, 'slope-loop/results');

  for (const ps of planned) {
    // Skip malformed sprints
    if (!ps.tickets || !Array.isArray(ps.tickets) || ps.tickets.length === 0) continue;

    const sprintId = `S-LOCAL-${String(counter).padStart(3, '0')}`;

    // Skip already-completed planned sprints (check by result file)
    if (existsSync(join(resultsDir, `${sprintId}.json`))) {
      counter++;
      continue;
    }

    sprints.push({
      id: sprintId,
      title: ps.theme,
      strategy: 'roadmap',
      par: ps.par,
      slope: ps.slope,
      type: ps.type,
      tickets: ps.tickets
        .filter(t => t.acceptance_criteria?.length > 0)
        .map((t, i) => ({
          key: `${sprintId}-${i + 1}`,
          title: t.title,
          club: t.club,
          description: t.description,
          acceptance_criteria: t.acceptance_criteria,
          modules: t.modules.filter(m => existsSync(join(repoRoot, m))),
          max_files: t.max_files,
        })),
    });
    counter++;

    if (sprints.length >= ROADMAP_SPRINT_CAP) break;
  }

  return { sprints, counter };
}

// --- Backlog Generation ---

function generateBacklog(analysis: Analysis, sprintCount: number): void {
  const sprints: BacklogSprint[] = [];
  let counter = sprintCount + 1;

  // Determine safe club from success rates
  const clubSuccessMap: Record<string, number> = {};
  for (const c of analysis.clubs) {
    clubSuccessMap[c.club] = c.success_rate;
  }
  const safeClub = (clubSuccessMap.short_iron ?? 100) < 60 ? 'wedge' : 'short_iron';

  // --- Strategy 1: Harden hotspot modules ---
  // Only include hotspots that have identifiable source files
  const topHotspots = analysis.hotspots
    .filter(h => h.source_files.length > 0)
    .slice(0, 3);
  if (topHotspots.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Harden top hotspot modules',
      strategy: 'hardening',
      par: 4,
      slope: 2,
      type: 'bugfix',
      tickets: topHotspots.map((h, i) => {
        const primary = h.source_files[0];
        const hazardList = h.hazard_descriptions.slice(0, 3).map(d => `- ${d}`).join('\n');
        return {
          key: `S-LOCAL-${String(counter).padStart(3, '0')}-${i + 1}`,
          title: `Harden: ${primary}`,
          club: safeClub,
          description: `Harden ${h.source_files.join(', ')} against known hazards:\n${hazardList}\n\nAction: Read each file, identify the hazard patterns described above, and add defensive code (input validation, error handling, edge case guards, or tests) to prevent recurrence.`,
          acceptance_criteria: [
            'pnpm test passes',
            'pnpm typecheck passes',
            ...h.source_files.slice(0, 2).map(f => `At least one substantive code change in ${f}`),
            'New or updated test(s) covering the hardened path',
          ],
          modules: h.source_files,
          max_files: Math.min(h.source_files.length, 3),
        };
      }),
    });
    counter++;
  }

  // --- Strategy 2: Add test coverage for miss patterns ---
  const topMisses = analysis.misses.frequency.slice(0, 3);
  if (topMisses.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Add test coverage for miss-prone areas',
      strategy: 'testing',
      par: 4,
      slope: 1,
      type: 'feature',
      tickets: topMisses.map((m, i) => ({
        key: `S-LOCAL-${String(counter).padStart(3, '0')}-${i + 1}`,
        title: `Test coverage: ${m.direction} miss pattern`,
        club: 'wedge',
        description: `Add test coverage for areas where ${m.direction} misses cluster. Clubs affected: ${Object.keys(m.by_club).join(', ')}`,
        acceptance_criteria: [
          'pnpm test passes',
          'New test file(s) created',
          `Tests specifically target ${m.direction} scenarios`,
        ],
        modules: Object.keys(m.by_club),
        max_files: 2,
      })),
    });
    counter++;
  }

  // --- Strategy 3: Address recurring hazards (tech debt) ---
  // Only generate tickets for hazard types that have identifiable source files
  const topHazards = analysis.hazards.frequency
    .filter(h => (analysis.hazards.type_files[h.type] ?? []).length > 0)
    .slice(0, 4);
  if (topHazards.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Address recurring hazard patterns',
      strategy: 'cleanup',
      par: 4,
      slope: 2,
      type: 'bugfix',
      tickets: topHazards.map((h, i) => {
        const files = analysis.hazards.type_files[h.type] ?? [];
        const descs = analysis.hazards.type_descriptions[h.type] ?? [];
        const descList = descs.slice(0, 3).map(d => `- ${d}`).join('\n');
        return {
          key: `S-LOCAL-${String(counter).padStart(3, '0')}-${i + 1}`,
          title: `Fix ${h.type} hazards in ${files[0] ?? 'codebase'}`,
          club: safeClub,
          description: `Address ${h.type} hazards in: ${files.slice(0, 3).join(', ')}.\n\nRecent examples:\n${descList}\n\nAction: Read each file, find code matching these hazard patterns, and fix with proper error handling, type safety, or validation. Add tests for the fixed paths.`,
          acceptance_criteria: [
            'pnpm test passes',
            'pnpm typecheck passes',
            ...files.slice(0, 2).map(f => `At least one substantive fix in ${f}`),
            'New or updated test(s) covering the fixed hazard',
          ],
          modules: files.slice(0, 5),
          max_files: Math.min(files.length, 3),
        };
      }),
    });
    counter++;
  }

  // --- Strategy 4: Documentation for high-complexity areas ---
  // Collect files from driver/long_iron hotspots (complex areas)
  const complexFiles: string[] = [];
  for (const h of analysis.hotspots) {
    // Check if the area had driver/long_iron hazard patterns
    if (h.source_files.length > 0 && h.risk_score >= 2) {
      complexFiles.push(...h.source_files);
    }
  }
  const uniqueComplexFiles = [...new Set(complexFiles)].slice(0, 3);
  // Only generate docs sprint if we have specific files to target
  if (uniqueComplexFiles.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Document high-complexity modules',
      strategy: 'documentation',
      par: 3,
      slope: 1,
      type: 'chore',
      tickets: [{
        key: `S-LOCAL-${String(counter).padStart(3, '0')}-1`,
        title: `Add inline docs for ${uniqueComplexFiles[0]}`,
        club: 'wedge',
        description: `Add JSDoc comments to complex functions in: ${uniqueComplexFiles.join(', ')}. These files have high hazard risk scores and need better documentation.`,
        acceptance_criteria: [
          'pnpm typecheck passes',
          ...uniqueComplexFiles.map(f => `${f} has JSDoc on exported functions`),
        ],
        modules: uniqueComplexFiles,
        max_files: uniqueComplexFiles.length,
      }],
    });
    counter++;
  }

  // --- Strategy 5: Hardening overflow ---
  // If there are hotspot files not already covered by strategies 1-4, add an overflow sprint
  const coveredFiles = new Set<string>();
  for (const sprint of sprints) {
    for (const ticket of sprint.tickets) {
      for (const m of ticket.modules) coveredFiles.add(m);
    }
  }
  const overflowHotspots = analysis.hotspots
    .filter(h => h.source_files.some(f => !coveredFiles.has(f)))
    .slice(0, 3);
  const overflowFiles = [...new Set(
    overflowHotspots.flatMap(h => h.source_files.filter(f => !coveredFiles.has(f))),
  )].slice(0, 4);
  if (overflowFiles.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Harden remaining hotspot files',
      strategy: 'hardening-overflow',
      par: 4,
      slope: 2,
      type: 'bugfix',
      tickets: overflowFiles.map((f, i) => {
        const hotspot = overflowHotspots.find(h => h.source_files.includes(f));
        return {
          key: `S-LOCAL-${String(counter).padStart(3, '0')}-${i + 1}`,
          title: `Harden: ${f}`,
          club: safeClub,
          description: `Harden ${f} against known hazards:\n${(hotspot?.hazard_descriptions ?? []).slice(0, 3).map(d => `- ${d}`).join('\n')}`,
          acceptance_criteria: [
            'pnpm test passes',
            'pnpm typecheck passes',
            `Review and harden ${f}`,
          ],
          modules: [f],
          max_files: 1,
        };
      }),
    });
    counter++;
  }

  // --- Strategy 6: Roadmap-driven sprints (when scorecard data is exhausted) ---
  // Only fires when scorecard strategies produce 0 sprints — regressions always take priority.
  if (sprints.length === 0) {
    const repoRoot = join(__dirname, '..');
    const roadmapPath = join(repoRoot, 'docs/backlog/roadmap.json');
    if (existsSync(roadmapPath)) {
      try {
        const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
        const result = convertPlannedSprints(roadmap.planned ?? [], counter, repoRoot);
        sprints.push(...result.sprints);
        counter = result.counter;
      } catch (err) {
        console.error(`Warning: failed to parse roadmap.json: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  writeFileSync(
    join(__dirname, 'backlog.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), sprints }, null, 2) + '\n',
  );

  console.log(`\nGenerated backlog: ${sprints.length} sprints, ${sprints.reduce((s, sp) => s + sp.tickets.length, 0)} tickets`);
  console.log(`Safe club: ${safeClub} (short_iron success rate: ${clubSuccessMap.short_iron ?? 'N/A'}%)`);
  console.log(`Full backlog: slope-loop/backlog.json`);
}

// --- Run ---

analyze();
