// SLOPE CLI — Stats export for slope-web live stats
// Computes SlopeStats JSON from local scorecards + registries.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadScorecards,
  computeHandicapCard,
  computeScoreLabel,
  listMetaphors,
  GUARD_DEFINITIONS,
  loadConfig,
} from '../../core/index.js';
import type { GolfScorecard, RollingStats as CoreRollingStats } from '../../core/index.js';
import { CLI_COMMAND_REGISTRY } from '../registry.js';

// Ensure metaphors are registered before counting
import '../../core/metaphors/index.js';

// ── Web-facing types (match slope-web SlopeStats interface) ────

interface WebRollingStats {
  handicap: number;
  fairway_pct: number;
  gir_pct: number;
  avg_putts: number;
}

interface ScorecardSummary {
  sprint: number;
  par: number;
  score: number;
  score_label: string;
  theme: string;
}

interface LatestScorecard {
  sprint: number;
  par: number;
  score: number;
  score_label: string;
  theme: string;
  stats: {
    fairway_hits: number;
    fairway_total: number;
    gir: number;
    hazards_hit: number;
  };
}

interface HandicapMilestone {
  sprint: number;
  handicap: number;
}

interface SlopeStats {
  sprints_completed: number;
  total_tests: number;
  cli_commands: number;
  guards: number;
  packages: number;
  metaphors: number;
  handicap: {
    last_5: WebRollingStats;
    last_10: WebRollingStats;
    all_time: WebRollingStats;
  };
  recent_scorecards: ScorecardSummary[];
  miss_pattern: { long: number; short: number; left: number; right: number };
  phase_status: Record<string, string>;
  latest_scorecard: LatestScorecard | null;
  handicap_milestones: HandicapMilestone[];
}

// ── Helpers ────────────────────────────────────────────────────

function simplifyRollingStats(core: CoreRollingStats): WebRollingStats {
  return {
    handicap: core.handicap,
    fairway_pct: core.fairway_pct,
    gir_pct: core.gir_pct,
    avg_putts: core.avg_putts,
  };
}

function countTestFiles(cwd: string): number {
  const testsDir = join(cwd, 'tests');
  if (!existsSync(testsDir)) return 0;

  let count = 0;
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith('.test.ts')) {
        count++;
      }
    }
  }
  walk(testsDir);
  return count;
}

function countPackages(cwd: string): number {
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) return 0;
  return readdirSync(srcDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .length;
}

function toScorecardSummary(sc: GolfScorecard): ScorecardSummary {
  return {
    sprint: sc.sprint_number,
    par: sc.par,
    score: sc.score,
    score_label: sc.score_label ?? computeScoreLabel(sc.score, sc.par),
    theme: sc.theme,
  };
}

function toLatestScorecard(sc: GolfScorecard): LatestScorecard {
  const stats = sc.stats;
  return {
    sprint: sc.sprint_number,
    par: sc.par,
    score: sc.score,
    score_label: sc.score_label ?? computeScoreLabel(sc.score, sc.par),
    theme: sc.theme,
    stats: {
      fairway_hits: stats?.fairways_hit ?? 0,
      fairway_total: stats?.fairways_total ?? 0,
      gir: stats?.greens_in_regulation ?? 0,
      hazards_hit: stats?.hazards_hit ?? 0,
    },
  };
}

function computeMilestones(scorecards: GolfScorecard[]): HandicapMilestone[] {
  const milestones: HandicapMilestone[] = [];
  // Sample at every 5th sprint, plus the latest
  for (let i = 0; i < scorecards.length; i++) {
    const sc = scorecards[i];
    if ((sc.sprint_number % 5 === 0) || i === scorecards.length - 1) {
      const window = scorecards.slice(0, i + 1);
      const card = computeHandicapCard(window);
      milestones.push({
        sprint: sc.sprint_number,
        handicap: card.all_time.handicap,
      });
    }
  }
  return milestones;
}

// ── Core export function ───────────────────────────────────────

export function computeSlopeStats(cwd: string = process.cwd()): SlopeStats {
  const config = loadConfig(cwd);
  const scorecards = loadScorecards(config, cwd);
  const handicapCard = computeHandicapCard(scorecards);

  const latest = scorecards.length > 0 ? scorecards[scorecards.length - 1] : null;
  const recent = scorecards.slice(-5).reverse().map(toScorecardSummary);

  return {
    sprints_completed: scorecards.length > 0
      ? Math.max(...scorecards.map(s => s.sprint_number))
      : 0,
    total_tests: countTestFiles(cwd),
    cli_commands: CLI_COMMAND_REGISTRY.length,
    guards: GUARD_DEFINITIONS.length,
    packages: countPackages(cwd),
    metaphors: listMetaphors().length,
    handicap: {
      last_5: simplifyRollingStats(handicapCard.last_5),
      last_10: simplifyRollingStats(handicapCard.last_10),
      all_time: simplifyRollingStats(handicapCard.all_time),
    },
    recent_scorecards: recent,
    miss_pattern: {
      long: handicapCard.all_time.miss_pattern.long,
      short: handicapCard.all_time.miss_pattern.short,
      left: handicapCard.all_time.miss_pattern.left,
      right: handicapCard.all_time.miss_pattern.right,
    },
    phase_status: {},
    latest_scorecard: latest ? toLatestScorecard(latest) : null,
    handicap_milestones: computeMilestones(scorecards),
  };
}

// ── CLI command ────────────────────────────────────────────────

export async function statsCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'export':
      return exportSubcommand(args.slice(1));
    default:
      console.log(`
slope stats — Statistics export for slope-web

Usage:
  slope stats export [--pretty] [--stdout]

Subcommands:
  export    Compute SlopeStats JSON from local scorecards + registries

Options:
  --pretty  Pretty-print JSON output
  --stdout  Write to stdout (default behavior)
`);
      if (sub) process.exit(1);
  }
}

function exportSubcommand(args: string[]): void {
  const pretty = args.includes('--pretty');
  const stats = computeSlopeStats();
  const json = JSON.stringify(stats, null, pretty ? 2 : undefined);
  console.log(json);
}
