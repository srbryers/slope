import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRoadmap,
  validateRoadmap,
  computeCriticalPath,
  findParallelOpportunities,
  formatRoadmapSummary,
  formatStrategicContext,
  loadScorecards,
} from '@slope-dev/core';
import type { RoadmapDefinition, GolfScorecard } from '@slope-dev/core';
import { loadConfig } from '../config.js';

// --- Helpers ---

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

const DEFAULT_ROADMAP_PATH = 'docs/backlog/roadmap.json';

function resolveRoadmapPath(flags: Record<string, string>, cwd: string): string {
  if (flags.path) return flags.path;
  const config = loadConfig(cwd);
  if ('roadmapPath' in config && typeof (config as Record<string, unknown>).roadmapPath === 'string') {
    return join(cwd, (config as Record<string, unknown>).roadmapPath as string);
  }
  return join(cwd, DEFAULT_ROADMAP_PATH);
}

function loadRoadmapFile(flags: Record<string, string>, cwd: string): RoadmapDefinition | null {
  const path = resolveRoadmapPath(flags, cwd);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error(`\nNo roadmap file found at: ${path}`);
    console.error('Create one with "slope init" or specify --path=<file>\n');
    return null;
  }

  const { roadmap, validation } = parseRoadmap(raw);
  if (!roadmap) {
    console.error('\nRoadmap file has structural errors:\n');
    for (const e of validation.errors) {
      console.error(`  \u2717 ${e.message}`);
    }
    console.error('');
    return null;
  }
  return roadmap;
}

function resolveSprint(flags: Record<string, string>, cwd: string): number {
  if (flags.sprint) return parseInt(flags.sprint, 10);
  const config = loadConfig(cwd);
  if (config.currentSprint) return config.currentSprint;
  const scorecards = loadScorecards(config, cwd);
  if (scorecards.length === 0) return 1;
  return Math.max(...scorecards.map(s => s.sprint_number)) + 1;
}

// --- Subcommands ---

function validateSubcommand(flags: Record<string, string>, cwd: string): void {
  const path = resolveRoadmapPath(flags, cwd);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error(`\nNo roadmap file found at: ${path}`);
    console.error('Create one with "slope init" or specify --path=<file>\n');
    process.exit(1);
  }

  const { roadmap, validation } = parseRoadmap(raw);

  console.log(`\nRoadmap: ${path}`);
  console.log('\u2550'.repeat(40));

  if (validation.valid) {
    console.log('\n\u2713 Roadmap is valid');
  } else {
    console.log(`\n\u2717 ${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'} found`);
  }

  if (validation.errors.length > 0) {
    console.log('\nErrors:');
    for (const e of validation.errors) {
      const loc = e.sprint ? `S${e.sprint}${e.ticket ? ` ${e.ticket}` : ''}` : '';
      console.log(`  \u2717 ${loc ? `[${loc}] ` : ''}${e.message}`);
    }
  }

  if (validation.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of validation.warnings) {
      const loc = w.sprint ? `S${w.sprint}${w.ticket ? ` ${w.ticket}` : ''}` : '';
      console.log(`  \u26A0 ${loc ? `[${loc}] ` : ''}${w.message}`);
    }
  }

  if (roadmap) {
    console.log(`\n  Sprints: ${roadmap.sprints.length}`);
    console.log(`  Tickets: ${roadmap.sprints.reduce((s, sp) => s + sp.tickets.length, 0)}`);
    console.log(`  Phases: ${roadmap.phases.length}`);
  }

  console.log('');
  process.exit(validation.valid ? 0 : 1);
}

function reviewSubcommand(flags: Record<string, string>, cwd: string): void {
  const roadmap = loadRoadmapFile(flags, cwd);
  if (!roadmap) { process.exit(1); return; }

  const validation = validateRoadmap(roadmap);
  const criticalPath = computeCriticalPath(roadmap);
  const parallelGroups = findParallelOpportunities(roadmap);

  console.log(`\n# Architect Review — ${roadmap.name}`);
  console.log('\u2550'.repeat(40));

  // 1. Structural validation
  console.log('\n## Structural Validation');
  if (validation.valid && validation.warnings.length === 0) {
    console.log('  \u2713 No errors or warnings');
  } else {
    for (const e of validation.errors) {
      console.log(`  \u2717 ${e.message}`);
    }
    for (const w of validation.warnings) {
      console.log(`  \u26A0 ${w.message}`);
    }
  }

  // 2. Scope balance
  console.log('\n## Scope Balance');
  const ticketCounts = roadmap.sprints.map(s => s.tickets.length);
  const avgTickets = ticketCounts.reduce((a, b) => a + b, 0) / ticketCounts.length;
  const parValues = roadmap.sprints.map(s => s.par);
  const avgPar = parValues.reduce((a, b) => a + b, 0) / parValues.length;
  console.log(`  Tickets per sprint: min=${Math.min(...ticketCounts)} avg=${avgTickets.toFixed(1)} max=${Math.max(...ticketCounts)}`);
  console.log(`  Par per sprint: min=${Math.min(...parValues)} avg=${avgPar.toFixed(1)} max=${Math.max(...parValues)}`);

  // Flag outliers
  for (const sprint of roadmap.sprints) {
    if (sprint.tickets.length > 4) {
      console.log(`  \u26A0 S${sprint.id} has ${sprint.tickets.length} tickets (over recommended 4)`);
    }
    if (sprint.tickets.length < 3) {
      console.log(`  \u26A0 S${sprint.id} has ${sprint.tickets.length} tickets (under recommended 3)`);
    }
  }

  // Club distribution
  const clubCounts: Record<string, number> = {};
  for (const sprint of roadmap.sprints) {
    for (const ticket of sprint.tickets) {
      clubCounts[ticket.club] = (clubCounts[ticket.club] ?? 0) + 1;
    }
  }
  console.log(`  Club distribution: ${Object.entries(clubCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // 3. Critical path analysis
  console.log('\n## Critical Path');
  console.log(`  Path: ${criticalPath.path.map(id => `S${id}`).join(' \u2192 ')}`);
  console.log(`  Length: ${criticalPath.length} sprints, par ${criticalPath.totalPar}`);

  // Identify bottlenecks (sprints on critical path with many dependents)
  const criticalSet = new Set(criticalPath.path);
  for (const id of criticalPath.path) {
    const dependents = roadmap.sprints.filter(s => s.depends_on?.includes(id));
    if (dependents.length > 1) {
      console.log(`  \u26A0 S${id} is a bottleneck — ${dependents.length} sprints depend on it`);
    }
  }

  // 4. Parallel opportunities
  console.log('\n## Parallelism');
  if (parallelGroups.length === 0) {
    console.log('  No parallel opportunities — all sprints are sequentially dependent');
  } else {
    for (const group of parallelGroups) {
      console.log(`  \u2713 ${group.sprints.map(id => `S${id}`).join(', ')}: ${group.reason}`);
    }
  }

  // 5. Dependency fan-in/fan-out
  console.log('\n## Dependency Analysis');
  for (const sprint of roadmap.sprints) {
    const fanIn = sprint.depends_on?.length ?? 0;
    const fanOut = roadmap.sprints.filter(s => s.depends_on?.includes(sprint.id)).length;
    if (fanIn > 2 || fanOut > 2) {
      console.log(`  S${sprint.id}: fan-in=${fanIn} fan-out=${fanOut}${fanIn > 2 ? ' (high fan-in)' : ''}${fanOut > 2 ? ' (high fan-out)' : ''}`);
    }
  }

  // Summary verdict
  const issueCount = validation.errors.length + validation.warnings.length;
  console.log('\n## Verdict');
  if (issueCount === 0) {
    console.log('  \u2713 Roadmap passes all checks');
  } else {
    console.log(`  ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
  }
  console.log('');
}

function statusSubcommand(flags: Record<string, string>, cwd: string): void {
  const roadmap = loadRoadmapFile(flags, cwd);
  if (!roadmap) { process.exit(1); return; }

  const config = loadConfig(cwd);
  const scorecards = loadScorecards(config, cwd);
  const currentSprint = resolveSprint(flags, cwd);
  const completedSprints = new Set(scorecards.map(s => s.sprint_number));

  console.log(`\n# Roadmap Status — ${roadmap.name}`);
  console.log('\u2550'.repeat(40));
  console.log(`\nCurrent sprint: S${currentSprint}`);
  console.log('');

  for (const phase of roadmap.phases) {
    const phaseSprints = roadmap.sprints.filter(s => phase.sprints.includes(s.id));
    const completed = phaseSprints.filter(s => completedSprints.has(s.id)).length;
    console.log(`## ${phase.name} (${completed}/${phaseSprints.length})`);

    for (const sprint of phaseSprints) {
      const isCompleted = completedSprints.has(sprint.id);
      const isCurrent = sprint.id === currentSprint;

      // Check if blocked: all dependencies must be completed
      const blockedBy = (sprint.depends_on ?? []).filter(dep => !completedSprints.has(dep));
      const isBlocked = !isCompleted && blockedBy.length > 0;

      let status: string;
      if (isCompleted) {
        status = '\u2713 completed';
      } else if (isCurrent) {
        status = '\u25B6 active';
      } else if (isBlocked) {
        status = `\u2718 blocked by ${blockedBy.map(d => `S${d}`).join(', ')}`;
      } else {
        status = '\u25CB pending';
      }

      console.log(`  S${sprint.id} ${sprint.theme.padEnd(30)} ${status}`);
    }
    console.log('');
  }

  // Strategic context for current sprint
  const context = formatStrategicContext(roadmap, currentSprint);
  if (context) {
    console.log('## Current Context');
    console.log(context.split('\n').map(l => `  ${l}`).join('\n'));
    console.log('');
  }
}

function showSubcommand(flags: Record<string, string>, cwd: string): void {
  const roadmap = loadRoadmapFile(flags, cwd);
  if (!roadmap) { process.exit(1); return; }

  console.log('');
  console.log(formatRoadmapSummary(roadmap));
}

// --- Main Command ---

export async function roadmapCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseArgs(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'validate':
      validateSubcommand(flags, cwd);
      break;
    case 'review':
      reviewSubcommand(flags, cwd);
      break;
    case 'status':
      statusSubcommand(flags, cwd);
      break;
    case 'show':
      showSubcommand(flags, cwd);
      break;
    default:
      console.log(`
slope roadmap — Strategic planning tools

Usage:
  slope roadmap validate [--path=<file>]     Schema + dependency graph checks
  slope roadmap review [--path=<file>]       Automated architect review
  slope roadmap status [--path=<file>] [--sprint=N]  Current progress
  slope roadmap show [--path=<file>]         Render summary (critical path, parallel tracks)

Options:
  --path=<file>    Path to roadmap JSON (default: docs/backlog/roadmap.json)
  --sprint=N       Override current sprint number (for status)
`);
      if (sub) process.exit(1);
  }
}
