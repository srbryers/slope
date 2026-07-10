import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  parseRoadmap,
  validateRoadmap,
  castRoadmapStructure,
  findShippedSprintsOnMain,
  compareSprintIds,
  computeCriticalPath,
  findParallelOpportunities,
  formatSprintLabel,
  formatRoadmapSummary,
  formatStrategicContext,
  buildRoadmapFocus,
  formatRoadmapFocus,
  formatRoadmapSprintLabel,
  roadmapSprintOrderValue,
  isRoadmapSprintPending,
  loadScorecards,
  discoverScorecardFiles,
  sprintNumberFromScorecardFile,
  loadVision,
  parseSprintNumber,
  analyzeBacklog,
  mergeBacklogs,
  runAnalyzers,
  estimateComplexity,
  generateRoadmapFromVision,
  RoadmapGenerationError,
  normalizeDiagnosticPath,
} from '../../core/index.js';
import type {
  RoadmapDefinition,
  RoadmapSprint,
  RoadmapTicket,
  RoadmapClub,
  GolfScorecard,
  RoadmapFocusEvidence,
  RoadmapFocusHazard,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { buildRoadmapReality, formatRoadmapRealitySection, roadmapRealityIssues } from '../pre-sprint-reality.js';
import { interviewCommand } from './interview.js';
import {
  loadRoadmapSourceStore,
  hasModularRoadmapSources,
  planRoadmapSourceArchive,
  applyRoadmapSourceArchive,
  validateRoadmapSourceStore,
  writeRoadmapSourceProjection,
  roadmapProjectionMatches,
} from '../roadmap-source-store.js';
import {
  applyRoadmapSourceMigration,
  prepareRoadmapSourceMigration,
} from '../roadmap-source-migration.js';
import { serializeRoadmapMigrationMappingTemplate } from '../../core/roadmap-migration.js';

// --- Helpers ---

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.*))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

const DEFAULT_ROADMAP_PATH = 'docs/backlog/roadmap.json';
const TERMINAL_ROADMAP_STATUSES = new Set(['complete', 'superseded']);
const DEFAULT_UPCOMING_LIMIT = 3;

function getRoadmapStatus(sprint: RoadmapSprint): string | undefined {
  return (sprint as RoadmapSprint & { status?: string }).status;
}

function isTerminalRoadmapSprint(sprint: RoadmapSprint, completedSprints: Set<number>): boolean {
  return completedSprints.has(sprint.id) || TERMINAL_ROADMAP_STATUSES.has(getRoadmapStatus(sprint) ?? '');
}

function blockedByForSprint(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint,
  completedSprints: Set<number>,
): number[] {
  return (sprint.depends_on ?? []).filter(dep => {
    const dependency = roadmap.sprints.find(s => s.id === dep);
    return dependency ? !isTerminalRoadmapSprint(dependency, completedSprints) : !completedSprints.has(dep);
  });
}

function statusLabelForSprint(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint,
  currentSprint: number,
  completedSprints: Set<number>,
): string {
  const explicitStatus = getRoadmapStatus(sprint);
  const isCompleted = completedSprints.has(sprint.id) || explicitStatus === 'complete';
  const isSuperseded = explicitStatus === 'superseded';
  const isCurrent = sprint.id === currentSprint;
  const blockedBy = blockedByForSprint(roadmap, sprint, completedSprints);

  if (isSuperseded) return '\u21B7 superseded';
  if (isCompleted) return '\u2713 completed';
  if (isCurrent) return '\u25B6 active';
  if (blockedBy.length > 0) return `\u2718 blocked by ${blockedBy.map(formatSprintLabel).join(', ')}`;
  return '\u25CB pending';
}

function phaseForSprint(roadmap: RoadmapDefinition, sprintId: number): { name: string; sprints: number[] } | undefined {
  return roadmap.phases.find(phase => phase.sprints?.includes(sprintId));
}

function formatPhaseProgress(
  roadmap: RoadmapDefinition,
  phase: { name: string; sprints: number[] },
  completedSprints: Set<number>,
): string {
  const phaseSprints = roadmap.sprints.filter(s => phase.sprints.includes(s.id));
  const completed = phaseSprints.filter(s => isTerminalRoadmapSprint(s, completedSprints)).length;
  return `${phase.name || 'Unnamed Phase'} (${completed}/${phaseSprints.length})`;
}

function sortedRoadmapSprints(roadmap: RoadmapDefinition): RoadmapSprint[] {
  return [...roadmap.sprints].sort((a, b) => compareSprintIds(a.id, b.id));
}

function resolveRoadmapPath(flags: Record<string, string>, cwd: string): string {
  if (flags.path) return flags.path;
  const config = loadConfig(cwd);
  return join(cwd, config.roadmapPath);
}

function loadRawRoadmap(flags: Record<string, string>, cwd: string): { path: string; raw: unknown } | null {
  const path = resolveRoadmapPath(flags, cwd);
  try {
    const content = readFileSync(path, 'utf8');
    if (!content.trim()) {
      console.error(`\nRoadmap file is empty: ${path}\n`);
      return null;
    }
    return { path, raw: JSON.parse(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`\nNo roadmap file found at: ${path}`);
      console.error('Create one with "slope init" or specify --path=<file>\n');
    } else {
      console.error(`\nFailed to parse roadmap file: ${path}`);
      console.error(`Error: ${(error as Error).message}\n`);
    }
    return null;
  }
}

function loadRoadmapFile(flags: Record<string, string>, cwd: string): RoadmapDefinition | null {
  const loaded = loadRawRoadmap(flags, cwd);
  if (!loaded) return null;

  const { roadmap, validation } = parseRoadmap(loaded.raw);
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

function resolveSprint(
  flags: Record<string, string>,
  cwd: string,
  roadmap?: RoadmapDefinition,
  scorecards: GolfScorecard[] = [],
): number {
  if (flags.sprint) {
    const parsed = parseSprintNumber(flags.sprint);
    if (parsed == null) {
      console.error(`\nInvalid sprint number: ${flags.sprint}\n`);
      process.exit(1);
    }
    return parsed;
  }

  const completedSprints = new Set(scorecards.map(s => s.sprint_number));
  const roadmapCurrent = resolveRoadmapCurrentSprint(roadmap, completedSprints);
  if (roadmapCurrent != null) return roadmapCurrent;

  const config = loadConfig(cwd);
  if (config.currentSprint && config.currentSprint > 0) return config.currentSprint;
  if (scorecards.length === 0) return 1;
  const sprintNumbers = scorecards.map(s => s.sprint_number).filter(n => typeof n === 'number' && n > 0);
  if (sprintNumbers.length === 0) return 1;
  return Math.max(...sprintNumbers) + 1;
}

function resolveRoadmapCurrentSprint(
  roadmap: RoadmapDefinition | undefined,
  completedSprints: Set<number>,
): number | null {
  const candidates = roadmap?.sprints
    .filter(sprint => isRoadmapSprintPending(sprint) && !completedSprints.has(sprint.id))
    .sort((a, b) => compareSprintIds(a.id, b.id)) ?? [];

  if (candidates.length === 0) return null;

  const active = candidates.find(sprint => getRoadmapStatus(sprint) === 'active');
  return (active ?? candidates[0]).id;
}

// --- Subcommands ---

function validateSubcommand(flags: Record<string, string>, cwd: string): void {
  const loaded = loadRawRoadmap(flags, cwd);
  if (!loaded) process.exit(1);

  const { path, raw } = loaded!;
  const parsed = parseRoadmap(raw);
  let { validation } = parsed;

  // Re-cast structurally even if parseRoadmap returned null due to validation
  // failure — drift checks should still fire on roadmaps that have ticket/
  // numbering issues. Only skip if the JSON has no name/sprints/phases at all.
  const roadmap = parsed.roadmap ?? castRoadmapStructure(raw);

  if (roadmap) {
    const config = loadConfig(cwd);
    const scorecards = loadScorecards(config, cwd).map(s => ({ sprint_number: s.sprint_number }));
    const shippedSprintIds = findShippedSprintsOnMain(cwd);
    validation = validateRoadmap(roadmap, scorecards, shippedSprintIds);
  }

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
  if (roadmap.sprints.length === 0) {
    console.log('  No sprints defined');
  } else {
    const ticketCounts = roadmap.sprints.map(s => s.tickets?.length ?? 0);
    const avgTickets = ticketCounts.reduce((a, b) => a + b, 0) / ticketCounts.length;
    const parValues = roadmap.sprints.map(s => s.par);
    const avgPar = parValues.reduce((a, b) => a + b, 0) / parValues.length;
    console.log(`  Tickets per sprint: min=${Math.min(...ticketCounts)} avg=${avgTickets.toFixed(1)} max=${Math.max(...ticketCounts)}`);
    console.log(`  Par per sprint: min=${Math.min(...parValues)} avg=${avgPar.toFixed(1)} max=${Math.max(...parValues)}`);

    // Flag outliers
    for (const sprint of roadmap.sprints) {
      const ticketCount = sprint.tickets?.length ?? 0;
      if (ticketCount > 4) {
        console.log(`  \u26A0 S${sprint.id} has ${ticketCount} tickets (over recommended 4)`);
      }
      if (ticketCount < 3) {
        console.log(`  \u26A0 S${sprint.id} has ${ticketCount} tickets (under recommended 3)`);
      }
    }

    // Club distribution
    const clubCounts: Record<string, number> = {};
    for (const sprint of roadmap.sprints) {
      if (sprint.tickets) {
        for (const ticket of sprint.tickets) {
          if (ticket.club) {
            clubCounts[ticket.club] = (clubCounts[ticket.club] ?? 0) + 1;
          }
        }
      }
    }
    if (Object.keys(clubCounts).length > 0) {
      console.log(`  Club distribution: ${Object.entries(clubCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }

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
  if (!parallelGroups || parallelGroups.length === 0) {
    console.log('  No parallel opportunities — all sprints are sequentially dependent');
  } else {
    for (const group of parallelGroups) {
      if (group.sprints && group.sprints.length > 0) {
        console.log(`  \u2713 ${group.sprints.map(id => `S${id}`).join(', ')}: ${group.reason || 'No dependencies'}`);
      }
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
  const currentSprint = resolveSprint(flags, cwd, roadmap, scorecards);
  const completedSprints = new Set(scorecards.map(s => s.sprint_number));

  if (flags.full === 'true' || flags.history === 'true') {
    printFullRoadmapStatus(roadmap, currentSprint, completedSprints);
  } else {
    printCompactRoadmapStatus(roadmap, currentSprint, completedSprints, cwd);
  }
}

function displayPath(cwd: string, path: string): string {
  return relative(cwd, resolve(cwd, path)).replace(/\\/g, '/');
}

function focusEvidence(
  roadmap: RoadmapDefinition,
  sprintId: number,
  flags: Record<string, string>,
  cwd: string,
): RoadmapFocusEvidence[] {
  const config = loadConfig(cwd);
  const evidence: RoadmapFocusEvidence[] = [{
    kind: 'roadmap',
    label: 'Roadmap source',
    ref: displayPath(cwd, resolveRoadmapPath(flags, cwd)),
    sprint: sprintId,
  }];
  const selected = roadmap.sprints.find(sprint => sprint.id === sprintId);
  const phase = roadmap.phases.find(candidate => candidate.sprints.includes(sprintId));
  const phaseIndex = phase?.sprints.indexOf(sprintId) ?? -1;
  const contextIds = new Set([
    sprintId,
    ...(selected?.depends_on ?? []),
    ...(phaseIndex < 0 ? [] : phase!.sprints.slice(Math.max(0, phaseIndex - 2), phaseIndex)),
  ]);
  const contextByValue = new Map(
    [...contextIds].map(id => [roadmapSprintOrderValue(roadmap, id), id]),
  );

  for (const path of discoverScorecardFiles(config, cwd)) {
    const scorecardSprint = sprintNumberFromScorecardFile(path, config);
    if (scorecardSprint == null) continue;
    const roadmapSprintId = contextByValue.get(roadmapSprintOrderValue(roadmap, scorecardSprint));
    if (roadmapSprintId == null) continue;
    evidence.push({
      kind: 'scorecard',
      label: `${formatRoadmapSprintLabel(roadmap, roadmapSprintId)} scorecard`,
      ref: displayPath(cwd, path),
      sprint: roadmapSprintId,
    });
    const reviewPath = [scorecardSprint, roadmapSprintId]
      .map(id => join(dirname(path), `sprint-${id}-review.md`))
      .find(candidate => existsSync(candidate));
    if (reviewPath) {
      evidence.push({
        kind: 'review',
        label: `${formatRoadmapSprintLabel(roadmap, roadmapSprintId)} review`,
        ref: displayPath(cwd, reviewPath),
        sprint: roadmapSprintId,
      });
    }
  }
  return evidence;
}

function focusSubcommand(flags: Record<string, string>, cwd: string): void {
  if (!Object.prototype.hasOwnProperty.call(flags, 'sprint') || flags.sprint === 'true') {
    console.error('\nMissing required --sprint=N for roadmap focus.');
    console.error('Usage: slope roadmap focus --sprint=N [--path=<file>] [--json]\n');
    process.exit(1);
    return;
  }
  const sprintId = parseSprintNumber(flags.sprint);
  if (sprintId == null) {
    console.error(`\nInvalid sprint number: ${flags.sprint || '(empty)'}`);
    console.error('Usage: slope roadmap focus --sprint=N [--path=<file>] [--json]\n');
    process.exit(1);
    return;
  }

  const roadmap = loadRoadmapFile(flags, cwd);
  if (!roadmap) { process.exit(1); return; }
  const config = loadConfig(cwd);
  const scorecards = loadScorecards(config, cwd);
  const completedSprintIds = scorecards.map(card => card.sprint_number);
  const hazards: RoadmapFocusHazard[] = roadmapRealityIssues(buildRoadmapReality(cwd, roadmap), sprintId)
    .map(issue => ({
      sprint: sprintId,
      sprint_label: formatRoadmapSprintLabel(roadmap, sprintId),
      type: 'roadmap_reality',
      severity: issue.type === 'error' ? 'major' : 'minor',
      description: issue.message,
    }));
  const focus = buildRoadmapFocus(roadmap, sprintId, {
    completedSprintIds,
    hazards,
    scorecards,
    evidence: focusEvidence(roadmap, sprintId, flags, cwd),
  });
  if (!focus) {
    console.error(`\nSprint ${formatRoadmapSprintLabel(roadmap, sprintId)} was not found in the roadmap.\n`);
    process.exit(1);
    return;
  }

  if (flags.json === 'true') {
    console.log(JSON.stringify(focus, null, 2));
  } else {
    console.log(formatRoadmapFocus(focus).trimEnd());
  }
}

function compileSourcesSubcommand(flags: Record<string, string>, cwd: string): void {
  try {
    const store = loadRoadmapSourceStore(cwd, flags.source);
    const validation = validateRoadmapSourceStore(store, { checkProjection: false });
    if (!validation.valid) {
      throw new Error([
        'Modular roadmap sources are invalid:',
        ...validation.errors.map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
        'Run `slope roadmap validate-sources` for the full report.',
      ].join('\n'));
    }
    const existing = existsSync(store.outputPath) ? readFileSync(store.outputPath, 'utf8') : null;
    const changed = existing == null || !roadmapProjectionMatches(existing, store.projection);
    const output = displayPath(cwd, store.outputPath);

    if (flags.check === 'true') {
      if (changed) {
        throw new Error(
          `Roadmap projection drift: ${output}. Run \`slope roadmap compile\` to regenerate it from modular sources.`,
        );
      }
      console.log(`\nRoadmap projection is current: ${output}\n`);
      return;
    }
    if (flags['dry-run'] === 'true') {
      console.log(`\nRoadmap compile dry run: ${changed ? 'would write' : 'already current'} ${output}`);
      console.log(`  Sources: ${store.sources.length}; phases: ${store.roadmap.phases.length}; sprints: ${store.roadmap.sprints.length}\n`);
      return;
    }

    const result = writeRoadmapSourceProjection(store);
    console.log(`\nRoadmap projection ${result}: ${output}`);
    console.log(`  Sources: ${store.sources.length}; phases: ${store.roadmap.phases.length}; sprints: ${store.roadmap.sprints.length}\n`);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
  }
}

function printMigrationPlan(
  prepared: ReturnType<typeof prepareRoadmapSourceMigration>,
  dryRun: boolean,
): void {
  if (prepared.status === 'unchanged') {
    console.log(`\nRoadmap migration unchanged: ${prepared.manifestRelativePath}`);
    console.log(`  Receipt: ${prepared.receipt.receipt_path}`);
    console.log(`  Migration: ${prepared.receipt.migration_id}\n`);
    return;
  }
  if (prepared.status === 'recovery_required') {
    console.log('\nAn interrupted roadmap migration requires transactional recovery.');
    console.log(`  Journal: ${normalizeDiagnosticPath(relative(prepared.input.cwd, prepared.journalPath))}`);
    console.log(`  Backup: ${normalizeDiagnosticPath(relative(prepared.input.cwd, prepared.backupPath))}`);
    console.log(dryRun
      ? '  Dry run made no changes; rerun without --dry-run to recover and apply.\n'
      : '  Recovery will restore the original bytes before replanning.\n');
    return;
  }
  const plan = prepared.plan;
  const archives = plan.sources.filter(source => source.classification === 'archive').length;
  const historyUnverified = plan.sources.filter(source => source.classification === 'history_unverified').length;
  console.log(`\nRoadmap migration ${dryRun ? 'dry run' : 'plan'}: ${prepared.sourceRelativePath}`);
  console.log(`  Manifest: ${prepared.manifestRelativePath}`);
  console.log(`  Sources: ${plan.sources.length}; archives: ${archives}; history-unverified: ${historyUnverified}`);
  console.log(`  Normalizations: ${plan.audit.length}; diagnostics: ${plan.diagnostics_total}; unresolved: ${plan.unresolved.length}`);
  for (const diagnostic of plan.diagnostics.slice(0, 10)) {
    console.log(`  ${diagnostic.severity === 'error' ? 'ERROR' : 'WARN'} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (plan.diagnostics_total > 10) console.log(`  ... ${plan.diagnostics_total - 10} additional diagnostic(s)`);
  if (!plan.applicable) {
    console.log('\nExplicit repair mapping required:');
    for (const repair of plan.unresolved.slice(0, 10)) console.log(`  - ${repair.key}: ${repair.message}`);
    if (plan.unresolved.length > 10) console.log(`  - ... ${plan.unresolved.length - 10} additional repair(s)`);
    console.log('\nMapping template:');
    console.log(serializeRoadmapMigrationMappingTemplate(plan).trimEnd());
  }
  console.log('');
}

function validateMigrationArgs(args: string[]): void {
  const seen = new Set<string>();
  for (const arg of args) {
    const match = arg.match(/^--(path|source|mapping)=(.+)$/);
    const key = arg === '--dry-run' ? 'dry-run' : match?.[1];
    if (!key) throw new Error(`Unknown roadmap migrate option: ${arg}`);
    if (seen.has(key)) throw new Error(`Duplicate roadmap migrate option: --${key}`);
    seen.add(key);
  }
}

function migrateSourcesSubcommand(flags: Record<string, string>, cwd: string, args: string[]): void {
  const dryRun = flags['dry-run'] === 'true';
  try {
    validateMigrationArgs(args);
    const prepared = prepareRoadmapSourceMigration({
      cwd,
      path: flags.path,
      source: flags.source,
      mapping: flags.mapping,
    });
    printMigrationPlan(prepared, dryRun);
    if (dryRun) {
      if (prepared.status === 'blocked' || prepared.status === 'recovery_required') process.exit(1);
      return;
    }
    if (prepared.status === 'blocked') {
      console.error('Roadmap migration is blocked until the explicit mapping is complete.\n');
      process.exit(1);
      return;
    }
    const result = applyRoadmapSourceMigration(prepared);
    console.log(`Roadmap migration ${result.status}: ${prepared.manifestRelativePath}`);
    console.log(`  Receipt: ${result.receipt.receipt_path}`);
    console.log(`  Sources: ${result.sources}; archives: ${result.archives}; history-unverified: ${result.historyUnverified}\n`);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
  }
}

function validateSourcesSubcommand(flags: Record<string, string>, cwd: string): void {
  const explicitSource = Object.prototype.hasOwnProperty.call(flags, 'source');
  let sourceExists: boolean;
  try {
    sourceExists = hasModularRoadmapSources(cwd, flags.source);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
    return;
  }
  if (!sourceExists) {
    if (explicitSource) {
      console.error(`\nModular roadmap manifest not found: ${flags.source || '(empty)'}\n`);
      process.exit(1);
      return;
    }
    console.log('\nSingle-file roadmap mode; run `slope roadmap validate` for docs/backlog/roadmap.json.\n');
    return;
  }

  let store;
  try {
    store = loadRoadmapSourceStore(cwd, flags.source);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
    return;
  }
  const validation = validateRoadmapSourceStore(store);
  console.log(`\nModular roadmap sources: ${displayPath(cwd, store.manifestPath)}`);
  console.log('═'.repeat(40));
  if (validation.valid) {
    console.log('\n✓ Modular sources and compiled projection are valid');
  } else {
    console.log(`\n✗ ${validation.errors.length} source error${validation.errors.length === 1 ? '' : 's'} found`);
  }
  for (const issue of validation.errors) {
    console.log(`  ✗ ${issue.source ? `[${issue.source}] ` : ''}${issue.message}`);
  }
  for (const issue of validation.warnings) {
    console.log(`  ⚠ ${issue.source ? `[${issue.source}] ` : ''}${issue.message}`);
  }
  console.log(`\n  Sources: ${store.sources.length}; phases: ${store.roadmap.phases.length}; sprints: ${store.roadmap.sprints.length}\n`);
  if (!validation.valid) process.exit(1);
}

function archiveSourcesSubcommand(flags: Record<string, string>, cwd: string): void {
  if (!Object.prototype.hasOwnProperty.call(flags, 'through') || flags.through === 'true') {
    console.error('\nMissing required --through=N for roadmap archive.');
    console.error('Usage: slope roadmap archive --through=N [--source=<file>] [--dry-run]\n');
    process.exit(1);
    return;
  }
  const through = parseSprintNumber(flags.through);
  if (through == null) {
    console.error(`\nInvalid archive boundary: ${flags.through || '(empty)'}\n`);
    process.exit(1);
    return;
  }

  try {
    const store = loadRoadmapSourceStore(cwd, flags.source);
    const projectionBefore = existsSync(store.outputPath) ? readFileSync(store.outputPath, 'utf8') : null;
    const plan = planRoadmapSourceArchive(store, through);
    console.log(`\nRoadmap archive through Sprint ${through}:`);
    if (plan.moves.length === 0) {
      console.log('  No complete live phases are eligible.\n');
      return;
    }
    for (const move of plan.moves) console.log(`  ${move.from} -> ${move.to}`);
    if (flags['dry-run'] === 'true') {
      console.log('\n  --dry-run: source files, manifest, and projection are unchanged.\n');
      return;
    }

    applyRoadmapSourceArchive(store, plan);
    const reloaded = loadRoadmapSourceStore(cwd, flags.source);
    const validation = validateRoadmapSourceStore(reloaded);
    if (!validation.valid || readFileSync(reloaded.outputPath, 'utf8') !== projectionBefore) {
      throw new Error('Archive verification failed: compiled projection changed or archived evidence is invalid.');
    }
    console.log(`\n  Archived ${plan.moves.length} phase source${plan.moves.length === 1 ? '' : 's'}; compatibility projection unchanged.\n`);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
  }
}

function printFullRoadmapStatus(
  roadmap: RoadmapDefinition,
  currentSprint: number,
  completedSprints: Set<number>,
): void {
  console.log(`\n# Roadmap Status — ${roadmap.name}`);
  console.log('\u2550'.repeat(40));
  console.log(`\nCurrent sprint: ${formatSprintLabel(currentSprint)}`);
  console.log('');

  for (const phase of roadmap.phases || []) {
    if (!phase.sprints || !Array.isArray(phase.sprints)) {
      console.log(`## ${phase.name || 'Unnamed Phase'} (0/0)`);
      console.log('  No sprints defined for this phase');
      console.log('');
      continue;
    }

    const phaseSprints = roadmap.sprints.filter(s => phase.sprints.includes(s.id));
    const completed = phaseSprints.filter(s => isTerminalRoadmapSprint(s, completedSprints)).length;
    console.log(`## ${phase.name || 'Unnamed Phase'} (${completed}/${phaseSprints.length})`);

    for (const sprint of phaseSprints) {
      const explicitStatus = getRoadmapStatus(sprint);
      const isCompleted = completedSprints.has(sprint.id) || explicitStatus === 'complete';
      const isSuperseded = explicitStatus === 'superseded';
      const isCurrent = sprint.id === currentSprint;

      // Check if blocked: all dependencies must be completed
      const blockedBy = (sprint.depends_on ?? []).filter(dep => {
        const dependency = roadmap.sprints.find(s => s.id === dep);
        return dependency ? !isTerminalRoadmapSprint(dependency, completedSprints) : !completedSprints.has(dep);
      });
      const isBlocked = !isCompleted && !isSuperseded && blockedBy.length > 0;

      let status: string;
      if (isSuperseded) {
        status = '\u21B7 superseded';
      } else if (isCompleted) {
        status = '\u2713 completed';
      } else if (isCurrent) {
        status = '\u25B6 active';
      } else if (isBlocked) {
        status = `\u2718 blocked by ${blockedBy.map(formatSprintLabel).join(', ')}`;
      } else {
        status = '\u25CB pending';
      }

      const theme = sprint.theme || 'Untitled Sprint';
      console.log(`  ${formatSprintLabel(sprint.id)} ${theme.padEnd(30)} ${status}`);
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

function printCompactRoadmapStatus(
  roadmap: RoadmapDefinition,
  currentSprint: number,
  completedSprints: Set<number>,
  cwd: string,
): void {
  const current = roadmap.sprints.find(s => s.id === currentSprint);
  const currentLabel = current
    ? `${formatSprintLabel(current.id)} ${current.theme || 'Untitled Sprint'}`
    : `${formatSprintLabel(currentSprint)} (not found in roadmap)`;
  const currentIsPending = current ? isRoadmapSprintPending(current) : false;
  const currentPhase = phaseForSprint(roadmap, currentSprint);
  const pendingAfterCurrent = sortedRoadmapSprints(roadmap)
    .filter(s => isRoadmapSprintPending(s) && s.id !== currentSprint && compareSprintIds(s.id, currentSprint) > 0);
  const nextReady = pendingAfterCurrent.find(s => blockedByForSprint(roadmap, s, completedSprints).length === 0);
  const upcoming = pendingAfterCurrent.slice(0, DEFAULT_UPCOMING_LIMIT);
  const realityLines = formatRoadmapRealitySection(buildRoadmapReality(cwd, roadmap), undefined, 5).slice(1);

  console.log(`\n# Roadmap Status - ${roadmap.name}`);
  console.log('\u2550'.repeat(40));
  console.log(`\nCurrent: ${currentLabel}`);
  if (currentPhase) console.log(`Phase: ${formatPhaseProgress(roadmap, currentPhase, completedSprints)}`);

  console.log('\nReality checks:');
  if (realityLines.length === 0) {
    console.log('  None');
  } else {
    for (const line of realityLines) console.log(`  ${line.trim()}`);
  }

  console.log('\nActive sprint:');
  if (!current) {
    console.log(`  ${formatSprintLabel(currentSprint)} is not defined in the roadmap.`);
  } else {
    console.log(`  ${formatSprintLabel(current.id)} ${current.theme || 'Untitled Sprint'} - ${statusLabelForSprint(roadmap, current, currentSprint, completedSprints)}`);
    if ((current.depends_on ?? []).length > 0) {
      const deps = current.depends_on!.map(dep => {
        const sprint = roadmap.sprints.find(s => s.id === dep);
        if (!sprint) return `${formatSprintLabel(dep)} missing`;
        return `${formatSprintLabel(dep)} ${statusLabelForSprint(roadmap, sprint, currentSprint, completedSprints).replace(/^[^\w]+ /, '')}`;
      });
      console.log(`  Dependencies: ${deps.join(', ')}`);
    }
    for (const ticket of current.tickets ?? []) {
      console.log(`  - ${ticket.key}: ${ticket.title}`);
    }
  }

  console.log('\nNext ready:');
  if (nextReady) {
    console.log(`  ${formatSprintLabel(nextReady.id)} ${nextReady.theme || 'Untitled Sprint'} - ${statusLabelForSprint(roadmap, nextReady, currentSprint, completedSprints)}`);
  } else {
    console.log('  None yet');
  }

  console.log(`\nUpcoming (${upcoming.length}/${Math.min(DEFAULT_UPCOMING_LIMIT, pendingAfterCurrent.length)}):`);
  if (upcoming.length === 0) {
    console.log('  None');
  } else {
    for (const sprint of upcoming) {
      console.log(`  ${formatSprintLabel(sprint.id)} ${sprint.theme || 'Untitled Sprint'} - ${statusLabelForSprint(roadmap, sprint, currentSprint, completedSprints)}`);
    }
  }

  console.log('\nRecommended next action:');
  if (realityLines.some(line => line.includes('[error]'))) {
    console.log('  Resolve the first roadmap reality error before advancing the lane.');
  } else if (currentIsPending && current?.tickets?.length) {
    const first = current.tickets[0];
    console.log(`  Work ${first.key}: ${first.title}`);
  } else if (nextReady) {
    console.log(`  Start ${formatSprintLabel(nextReady.id)}: ${nextReady.theme || 'Untitled Sprint'}`);
  } else {
    console.log('  No roadmap action is currently ready.');
  }

  console.log('\nFor the full roadmap history, run: slope roadmap status --full\n');
}

function showSubcommand(flags: Record<string, string>, cwd: string): void {
  const roadmap = loadRoadmapFile(flags, cwd);
  if (!roadmap) { process.exit(1); return; }

  console.log('');
  console.log(formatRoadmapSummary(roadmap));

  const realityLines = formatRoadmapRealitySection(buildRoadmapReality(cwd, roadmap));
  if (realityLines.length > 0) {
    console.log(realityLines.join('\n'));
    console.log('');
  }
}

const CLUB_TO_COMPLEXITY: Record<string, RoadmapTicket['complexity']> = {
  putter: 'trivial',
  wedge: 'small',
  short_iron: 'standard',
  long_iron: 'moderate',
  driver: 'moderate',
};

function scorecardToSprint(card: GolfScorecard): RoadmapSprint {
  const tickets: RoadmapTicket[] = card.shots.map(shot => ({
    key: shot.ticket_key,
    title: shot.title,
    club: shot.club as RoadmapClub,
    complexity: CLUB_TO_COMPLEXITY[shot.club] ?? 'standard',
  }));

  return {
    id: card.sprint_number,
    theme: card.theme,
    par: card.par as 3 | 4 | 5,
    slope: card.slope,
    type: card.type ?? 'standard',
    tickets,
  };
}

function ticketIdentity(ticket: RoadmapTicket): string {
  return ticket.key || ticket.id || '';
}

function mergeScorecardTickets(existingTickets: RoadmapTicket[], scorecardTickets: RoadmapTicket[]): RoadmapTicket[] {
  const existingByKey = new Map(existingTickets.map(ticket => [ticketIdentity(ticket), ticket]));

  return scorecardTickets.map(ticket => {
    const existing = existingByKey.get(ticketIdentity(ticket));
    return existing ? { ...existing, ...ticket } : ticket;
  });
}

function modularAuthorityBlocksProjectionMutation(
  flags: Record<string, string>,
  cwd: string,
  action: 'sync' | 'generate',
): boolean {
  let defaultExists = false;
  let explicitExists = false;
  try {
    defaultExists = hasModularRoadmapSources(cwd);
    if (!defaultExists && Object.prototype.hasOwnProperty.call(flags, 'source')) {
      explicitExists = hasModularRoadmapSources(cwd, flags.source);
    }
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(1);
    return true;
  }

  if (!defaultExists && Object.prototype.hasOwnProperty.call(flags, 'source') && !explicitExists) {
    console.error(`\nModular roadmap manifest not found: ${flags.source || '(empty)'}\n`);
    process.exit(1);
    return true;
  }
  if (!defaultExists && !explicitExists) return false;

  console.error(`\nModular roadmap sources are authoritative; \`roadmap ${action}\` cannot edit the generated projection.`);
  console.error('Update the source YAML and run `slope roadmap compile`.\n');
  process.exit(1);
  return true;
}

function syncSubcommand(flags: Record<string, string>, cwd: string): void {
  if (modularAuthorityBlocksProjectionMutation(flags, cwd, 'sync')) return;
  const dryRun = flags['dry-run'] === 'true';
  const path = resolveRoadmapPath(flags, cwd);
  const config = loadConfig(cwd);
  const scorecards = loadScorecards(config, cwd);

  if (scorecards.length === 0) {
    console.log('\nNo scorecards found. Nothing to sync.\n');
    return;
  }

  // Load existing roadmap (or start fresh)
  let roadmap: RoadmapDefinition;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
    const parsed = parseRoadmap(raw);
    if (!parsed.roadmap) {
      console.error('\nRoadmap file has structural errors — fix before syncing.\n');
      process.exit(1);
    }
    roadmap = parsed.roadmap;
  } catch {
    console.error(`\nNo roadmap file found at: ${path}`);
    console.error('Create one with "slope init" or specify --path=<file>\n');
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  const existingById = new Map(roadmap.sprints.map(s => [s.id, s]));
  let updated = 0;
  let added = 0;

  for (const card of scorecards) {
    const fromCard = scorecardToSprint(card);
    const existing = existingById.get(card.sprint_number);

    if (existing) {
      // Update scorecard-derived fields, preserve manually-authored fields
      existing.theme = fromCard.theme;
      existing.par = fromCard.par;
      existing.slope = fromCard.slope;
      existing.type = fromCard.type;
      existing.tickets = mergeScorecardTickets(existing.tickets, fromCard.tickets);
      (existing as RoadmapSprint & { status?: string }).status = 'complete';
      // Preserve: sprint depends_on and ticket metadata such as depends_on/github_issue.
      updated++;
    } else {
      roadmap.sprints.push({ ...fromCard, status: 'complete' } as RoadmapSprint);
      added++;
    }
  }

  // Sort sprints by id
  roadmap.sprints.sort((a, b) => a.id - b.id);

  // Build output
  const output = JSON.stringify(roadmap, null, 2) + '\n';

  console.log(`\nRoadmap sync: ${path}`);
  console.log('\u2550'.repeat(40));
  console.log(`  Scorecards: ${scorecards.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Added: ${added}`);
  console.log(`  Total sprints: ${roadmap.sprints.length}`);

  if (dryRun) {
    console.log('\n  --dry-run: no changes written.\n');
    return;
  }

  writeFileSync(path, output);
  console.log(`\n  Written to ${path}\n`);
}

async function generateSubcommand(flags: Record<string, string>, cwd: string): Promise<void> {
  if (modularAuthorityBlocksProjectionMutation(flags, cwd, 'generate')) return;
  const vision = loadVision(cwd);
  if (!vision) {
    console.error('\nNo vision found. Create one first:');
    console.error('  slope vision create --purpose="..." --priorities="a,b,c"\n');
    process.exit(1);
  }

  console.log('\nGenerating roadmap from vision + concrete backlog signals...');

  const localBacklog = await analyzeBacklog(cwd);
  const backlog = mergeBacklogs(localBacklog);

  let complexity;
  try {
    const profile = await runAnalyzers({ cwd, analyzers: ['stack', 'structure', 'git', 'testing', 'ci', 'docs'] });
    complexity = estimateComplexity(profile);
  } catch {
    console.log('  Warning: Could not estimate complexity, using defaults.');
  }

  let roadmap: ReturnType<typeof generateRoadmapFromVision>;
  try {
    roadmap = generateRoadmapFromVision(vision, backlog, complexity);
  } catch (err) {
    if (err instanceof RoadmapGenerationError) {
      console.error(`\nError: ${err.message}`);
      console.error('\nTo generate a useful roadmap, provide at least one concrete backlog signal:');
      console.error('  - add TODO/FIXME/HACK comments in source files');
      console.error('  - sync or provide issue data before generation');
      console.error('  - write the roadmap manually when the vision is intentionally high-level\n');
      process.exit(1);
    }
    throw err;
  }

  const validation = validateRoadmap(roadmap);
  if (!validation.valid) {
    console.error('\nGenerated roadmap has validation errors:');
    for (const e of validation.errors) {
      console.error(`  \u2717 ${e.message}`);
    }
    console.error('');
    process.exit(1);
  }

  const path = resolveRoadmapPath(flags, cwd);
  const dryRun = flags['dry-run'] === 'true';

  if (dryRun) {
    // Preview only \u2014 don't write to disk (GH #304)
    console.log(`\n  [dry-run] Would write to ${path}`);
    console.log(`  Sprints: ${roadmap.sprints.length}`);
    console.log(`  Tickets: ${roadmap.sprints.reduce((s: number, sp: RoadmapSprint) => s + sp.tickets.length, 0)}`);
    console.log(`  Phases: ${roadmap.phases.length}`);
    if (validation.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const w of validation.warnings) {
        console.log(`  \u26A0 ${w.message}`);
      }
    }
    console.log('\n  Re-run without --dry-run to write the file.\n');
    return;
  }

  const dir = join(cwd, 'docs', 'backlog');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(roadmap, null, 2) + '\n');

  console.log(`\n  Roadmap written to ${path}`);
  console.log(`  Sprints: ${roadmap.sprints.length}`);
  console.log(`  Tickets: ${roadmap.sprints.reduce((s: number, sp: RoadmapSprint) => s + sp.tickets.length, 0)}`);
  console.log(`  Phases: ${roadmap.phases.length}`);

  if (validation.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of validation.warnings) {
      console.log(`  \u26A0 ${w.message}`);
    }
  }
  console.log('');
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
    case 'focus':
      focusSubcommand(flags, cwd);
      break;
    case 'migrate':
      migrateSourcesSubcommand(flags, cwd, args.slice(1));
      break;
    case 'compile':
      compileSourcesSubcommand(flags, cwd);
      break;
    case 'validate-sources':
      validateSourcesSubcommand(flags, cwd);
      break;
    case 'archive':
      archiveSourcesSubcommand(flags, cwd);
      break;
    case 'show':
      showSubcommand(flags, cwd);
      break;
    case 'sync':
      syncSubcommand(flags, cwd);
      break;
    case 'generate':
      await generateSubcommand(flags, cwd);
      break;
    case 'interview':
      await interviewCommand(args.slice(1));
      break;
    default:
      console.log(`
slope roadmap — Strategic planning tools

Usage:
  slope roadmap interview [--agent] [--force] [--allow-no-git]  Run project interview for planning input
  slope roadmap validate [--path=<file>]     Schema + dependency graph checks
  slope roadmap review [--path=<file>]       Automated architect review
  slope roadmap status [--path=<file>] [--sprint=N] [--full]  Compact current progress
  slope roadmap focus --sprint=N [--path=<file>] [--json]     Bounded sprint context
  slope roadmap migrate [--path=<file>] [--source=<file>] [--mapping=<file>] [--dry-run]
                                                Plan or apply single-file federation migration
  slope roadmap compile [--source=<file>] [--dry-run|--check] Compile modular YAML sources
  slope roadmap validate-sources [--source=<file>]            Validate sources and projection drift
  slope roadmap archive --through=N [--source=<file>] [--dry-run] Archive whole terminal phases
  slope roadmap show [--path=<file>]         Render summary (critical path, parallel tracks)
  slope roadmap sync [--path=<file>] [--dry-run]     Sync scorecards into roadmap
  slope roadmap generate [--path=<file>] [--dry-run] Generate from vision + concrete backlog signals

Options:
  --path=<file>    Path to roadmap JSON (default: docs/backlog/roadmap.json)
  --sprint=N       Select a sprint (required for focus; override for status)
  --json           Emit machine-readable focus JSON
  --source=<file>  Modular roadmap manifest (default: docs/roadmap/project.yaml)
  --mapping=<file> Explicit ownership and legacy repair mapping for migrate
  --check          Fail when the compiled roadmap projection has drifted
  --full           Show full roadmap history for status
  --dry-run        Show what would change without writing (for sync and generate)

Interview delegates to \`slope interview\`. Use \`--agent\` for JSON I/O, or
\`slope vision create/update\` plus \`slope roadmap generate\` when you already
have planning answers.
Use \`--allow-no-git\` only for degraded projects where commit-backed completion
evidence is unavailable.

Generate requires concrete backlog signals from source TODO/FIXME/HACK comments
or synced issue data. It fails instead of creating placeholder planning tickets
when there is nothing concrete to mine.
`);
      if (sub) process.exit(1);
  }
}
