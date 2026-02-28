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
  GolfScorecard,
  HandicapCard,
  DispersionReport,
  ShotRecord,
  HazardHit,
} from '../dist/index.js';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Temporal Weighting ---

const RECENCY_WEIGHT = 0.7;
const RECENT_WINDOW = 10; // last N sprints weighted higher

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

interface BacklogTicket {
  key: string;
  title: string;
  club: string;
  description: string;
  acceptance_criteria: string[];
  modules: string[];
  max_files: number;
}

interface BacklogSprint {
  id: string;
  title: string;
  strategy: string;
  par: number;
  slope: number;
  type: string;
  tickets: BacklogTicket[];
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
    }));

  // --- Build analysis output ---

  const analysis: Analysis = {
    generated_at: new Date().toISOString(),
    sprint_count: scorecards.length,
    handicap: {
      current: handicap.current,
      trend: handicap.trend,
      last_5: handicap.last5,
      last_10: handicap.last10,
      all_time: handicap.allTime,
    },
    hazards: {
      frequency: hazardFrequency,
      by_module: hazardByModule,
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
  console.log(`Sprints analyzed: ${scorecards.length}`);
  console.log(`Current handicap: ${handicap.current} (${handicap.trend})`);
  console.log(`Recency window: last ${RECENT_WINDOW} sprints (weight: ${RECENCY_WEIGHT})`);
  console.log(`Recurring threshold: ${recurringThreshold} (dynamic: ceil(${scorecards.length} * 0.1))`);

  if (hazardFrequency.length > 0) {
    console.log(`\nTop recurring hazards (temporally weighted):`);
    for (const h of hazardFrequency.slice(0, 5)) {
      console.log(`  ${h.type}: weighted=${h.weighted_score.toFixed(1)} (total=${h.total_count}, recent=${h.recent_count})`);
    }
  }

  if (hotspots.length > 0) {
    console.log(`\nHotspot areas:`);
    for (const h of hotspots.slice(0, 5)) {
      console.log(`  ${h.area}: risk score ${h.risk_score}`);
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
  const topHotspots = analysis.hotspots.slice(0, 3);
  if (topHotspots.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Harden top hotspot modules',
      strategy: 'hardening',
      par: 4,
      slope: 2,
      type: 'bugfix',
      tickets: topHotspots.map((h, i) => ({
        key: `S-LOCAL-${String(counter).padStart(3, '0')}-${i + 1}`,
        title: `Harden: ${h.area}`,
        club: safeClub,
        description: `Address hazards in ${h.area}: ${Object.keys(h.hazard_types).join(', ')}`,
        acceptance_criteria: [
          'pnpm test passes',
          'pnpm typecheck passes',
          `Reduce hazard surface in ${h.area}`,
        ],
        modules: [h.area],
        max_files: 2,
      })),
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
  const topHazards = analysis.hazards.frequency.slice(0, 4);
  if (topHazards.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Address recurring hazard patterns',
      strategy: 'cleanup',
      par: 4,
      slope: 2,
      type: 'bugfix',
      tickets: topHazards.map((h, i) => ({
        key: `S-LOCAL-${String(counter).padStart(3, '0')}-${i + 1}`,
        title: `Fix recurring: ${h.type} hazard`,
        club: safeClub,
        description: `Address recurring ${h.type} hazard (weighted score: ${h.weighted_score.toFixed(1)}, recent: ${h.recent_count})`,
        acceptance_criteria: [
          'pnpm test passes',
          'pnpm typecheck passes',
          `Reduce ${h.type} hazard occurrences`,
        ],
        modules: [],
        max_files: 2,
      })),
    });
    counter++;
  }

  // --- Strategy 4: Documentation for high-complexity areas ---
  const driverTickets = analysis.clubs.filter(c => c.club === 'driver' || c.club === 'long_iron');
  if (driverTickets.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
      title: 'Document high-complexity modules',
      strategy: 'documentation',
      par: 3,
      slope: 1,
      type: 'chore',
      tickets: [{
        key: `S-LOCAL-${String(counter).padStart(3, '0')}-1`,
        title: 'Add inline docs for complex modules',
        club: 'wedge',
        description: 'Add JSDoc comments to functions with driver/long_iron complexity that lack documentation',
        acceptance_criteria: [
          'pnpm typecheck passes',
          'Key functions have JSDoc comments',
        ],
        modules: [],
        max_files: 3,
      }],
    });
    counter++;
  }

  // --- Strategy 5: Meta — improve SLOPE itself ---
  sprints.push({
    id: `S-LOCAL-${String(counter).padStart(3, '0')}`,
    title: 'Meta: improve scoring accuracy',
    strategy: 'meta',
    par: 3,
    slope: 1,
    type: 'feature',
    tickets: [
      {
        key: `S-LOCAL-${String(counter).padStart(3, '0')}-1`,
        title: 'Validate analysis.json against scorecard data',
        club: 'wedge',
        description: 'Cross-reference analysis outputs against raw scorecards to verify temporal weighting correctness',
        acceptance_criteria: [
          'pnpm test passes',
          'analysis.json validated',
        ],
        modules: ['slope-loop'],
        max_files: 1,
      },
    ],
  });

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
