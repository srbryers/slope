import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadLoopConfig, resolveLoopConfig } from '../loop/config.js';
import { loadBacklog, getRemainingSprintIds } from '../loop/backlog.js';
import { selectModel } from '../loop/model-selector.js';
import { createLogger } from '../loop/logger.js';
import type { LoopConfig, ConfigSource, BacklogSprint } from '../loop/types.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function loopCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseArgs(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'status':
      statusSubcommand(flags, cwd);
      break;
    case 'config':
      configSubcommand(flags, cwd);
      break;
    case 'run':
      await runSubcommand(flags, cwd);
      break;
    case 'continuous':
      await continuousSubcommand(flags, cwd);
      break;
    case 'parallel':
      await parallelSubcommand(flags, cwd);
      break;
    case 'results':
      resultsSubcommand(flags, cwd);
      break;
    case 'analyze':
      await analyzeSubcommand(flags, cwd);
      break;
    case 'models':
      modelsSubcommand(flags, cwd);
      break;
    case 'guide':
      guideSubcommand(flags, cwd);
      break;
    case 'clean':
      cleanSubcommand(flags, cwd);
      break;
    default:
      console.log(`
slope loop — Autonomous sprint execution loop

Usage:
  slope loop status [--sprint=ID]           Show loop progress, next sprint, config
  slope loop config [--show] [--set k=v]    Loop configuration management
  slope loop run [--sprint=ID] [--dry-run]  Single sprint execution
  slope loop continuous [--max=N] [--pause=S] [--dry-run]  Multi-sprint loop
  slope loop parallel [--dry-run]           Dual-sprint parallel execution
  slope loop results [--sprint=ID] [--json] Format/display sprint results
  slope loop analyze [--regenerate]         Mine scorecards → generate backlog
  slope loop models [--analyze] [--show]    Model selection analytics
  slope loop guide [--check] [--synthesize] SKILL.md word count, hazard check
  slope loop clean [--results] [--logs] [--worktrees] [--all]  Cleanup artifacts
`);
      if (sub) process.exit(1);
  }
}

// ── status ──────────────────────────────────────────

function statusSubcommand(flags: Record<string, string>, cwd: string): void {
  const config = resolveLoopConfig(cwd);
  const log = createLogger('loop');

  console.log('\n=== Slope Loop Status ===\n');

  // Show specific sprint or next sprint
  const sprintId = flags.sprint;
  try {
    const backlog = loadBacklog(cwd, config);
    const remaining = getRemainingSprintIds(backlog, cwd, config);
    const completed = backlog.sprints.length - remaining.length;

    console.log(`Backlog: ${backlog.sprints.length} sprints (${completed} completed, ${remaining.length} remaining)`);

    if (sprintId) {
      const sprint = backlog.sprints.find(s => s.id === sprintId);
      if (sprint) {
        printSprintSummary(sprint, config, cwd);
      } else {
        console.log(`Sprint ${sprintId} not found in backlog.`);
      }
    } else if (remaining.length > 0) {
      console.log(`Next sprint: ${remaining[0]}`);
      const next = backlog.sprints.find(s => s.id === remaining[0]);
      if (next) printSprintSummary(next, config, cwd);
    } else {
      console.log('All sprints completed. Run: slope loop analyze --regenerate');
    }
  } catch (err) {
    log.warn(`No backlog found. Run: slope loop analyze --regenerate`);
  }

  // Show result count
  const resultsDir = join(cwd, config.resultsDir);
  if (existsSync(resultsDir)) {
    const resultFiles = readdirSync(resultsDir).filter(f => f.endsWith('.json'));
    console.log(`\nResults: ${resultFiles.length} sprint result(s) in ${config.resultsDir}/`);
  }

  console.log('');
}

function printSprintSummary(sprint: BacklogSprint, config: LoopConfig, cwd: string): void {
  console.log(`\n  Sprint: ${sprint.id} — ${sprint.title}`);
  console.log(`  Strategy: ${sprint.strategy} | Par: ${sprint.par} | Slope: ${sprint.slope} | Type: ${sprint.type}`);
  console.log(`  Tickets (${sprint.tickets.length}):`);
  for (const t of sprint.tickets) {
    const model = selectModel(t.club, t.max_files, t.estimated_tokens ?? 0, config, cwd, sprint.strategy);
    const modelShort = model.split('/').pop();
    console.log(`    ${t.key}: ${t.title} [${t.club}, ${t.max_files} file(s) → ${modelShort}]`);
  }
}

// ── config ──────────────────────────────────────────

function configSubcommand(flags: Record<string, string>, cwd: string): void {
  const set = flags.set;

  if (set) {
    const eqIdx = set.indexOf('=');
    if (eqIdx === -1) {
      console.error('Error: --set requires key=value format');
      process.exit(1);
    }
    const key = set.slice(0, eqIdx);
    const value = set.slice(eqIdx + 1);

    const configPath = join(cwd, '.slope/loop.config.json');
    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch { /* start fresh */ }
    }

    // Parse numeric/boolean values
    if (value === 'true') existing[key] = true;
    else if (value === 'false') existing[key] = false;
    else if (!isNaN(Number(value)) && value !== '') existing[key] = Number(value);
    else existing[key] = value;

    const dir = join(cwd, '.slope');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
    console.log(`Set ${key}=${value} in .slope/loop.config.json`);
    return;
  }

  // Default: --show
  const { config, sources } = loadLoopConfig(cwd);
  const sourceColor: Record<ConfigSource, string> = {
    env: '\x1b[33m',    // yellow
    file: '\x1b[36m',   // cyan
    default: '\x1b[90m', // gray
  };
  const reset = '\x1b[0m';

  console.log('\n=== Loop Configuration ===\n');
  for (const [key, value] of Object.entries(config)) {
    const source = sources[key as keyof LoopConfig];
    const color = sourceColor[source];
    console.log(`  ${key}: ${JSON.stringify(value)} ${color}(${source})${reset}`);
  }
  console.log('');
}

// ── run ─────────────────────────────────────────────

async function runSubcommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const { runSprint } = await import('../loop/executor.js');
  await runSprint(flags, cwd);
}

// ── continuous ──────────────────────────────────────

async function continuousSubcommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const { runContinuous } = await import('../loop/continuous.js');
  await runContinuous(flags, cwd);
}

// ── parallel ────────────────────────────────────────

async function parallelSubcommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const { runParallel } = await import('../loop/parallel.js');
  await runParallel(flags, cwd);
}

// ── results ─────────────────────────────────────────

function resultsSubcommand(flags: Record<string, string>, cwd: string): void {
  const config = resolveLoopConfig(cwd);
  const resultsDir = join(cwd, config.resultsDir);
  const json = flags.json === 'true';
  const sprintFilter = flags.sprint;

  if (!existsSync(resultsDir)) {
    console.log('No results directory found.');
    return;
  }

  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.log('No sprint results found.');
    return;
  }

  const results = files.map(f => {
    try {
      return JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);

  if (sprintFilter) {
    const result = results.find((r: Record<string, unknown>) => r.sprint_id === sprintFilter);
    if (!result) {
      console.log(`No result found for sprint ${sprintFilter}`);
      return;
    }
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result);
    }
    return;
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Summary view
  console.log('\n=== Sprint Results ===\n');
  let totalPassing = 0;
  let totalTickets = 0;
  let totalNoop = 0;

  for (const r of results) {
    const status = r.merge_status === 'merged' ? 'merged' :
                   r.merge_status === 'blocked' ? 'BLOCKED' : '-';
    console.log(`  ${r.sprint_id}: ${r.title} — ${r.tickets_passing}/${r.tickets_total} passing, ${r.tickets_noop} noop [${status}]`);
    totalPassing += r.tickets_passing ?? 0;
    totalTickets += r.tickets_total ?? 0;
    totalNoop += r.tickets_noop ?? 0;
  }

  console.log(`\nTotal: ${results.length} sprints, ${totalPassing}/${totalTickets} tickets passing, ${totalNoop} noop`);
  console.log('');
}

function printResult(r: Record<string, unknown>): void {
  console.log(`\n=== ${r.sprint_id} — ${r.title} ===`);
  console.log(`Strategy: ${r.strategy} | Completed: ${r.completed_at}`);
  console.log(`Branch: ${r.branch}`);
  console.log(`Tickets: ${r.tickets_passing}/${r.tickets_total} passing, ${r.tickets_noop} noop`);
  if (r.pr_number) console.log(`PR: #${r.pr_number} (${r.merge_status})`);
  if (r.merge_block_reason) console.log(`Block reason: ${r.merge_block_reason}`);
  const tickets = r.tickets as Record<string, unknown>[] | undefined;
  if (tickets) {
    console.log('\nTickets:');
    for (const t of tickets) {
      const status = t.noop ? 'noop' : t.tests_passing ? 'pass' : 'FAIL';
      const esc = t.escalated ? ' (escalated)' : '';
      console.log(`  ${t.ticket}: ${t.title} — ${status}${esc} [${t.final_model}]`);
    }
  }
  console.log('');
}

// ── analyze ─────────────────────────────────────────

async function analyzeSubcommand(_flags: Record<string, string>, cwd: string): Promise<void> {
  const { runAnalyze } = await import('../loop/analyze.js');
  await runAnalyze(_flags, cwd);
}

// ── models ──────────────────────────────────────────

function modelsSubcommand(flags: Record<string, string>, cwd: string): void {
  const configPath = join(cwd, 'slope-loop/model-config.json');
  if (!existsSync(configPath)) {
    console.log('No model-config.json found. Run: slope loop models --analyze');
    return;
  }

  try {
    const mc = JSON.parse(readFileSync(configPath, 'utf8'));
    console.log('\n=== Model Selection Analytics ===\n');
    console.log(`Generated: ${mc.generated_at}`);
    console.log(`Total tickets analyzed: ${mc.ticket_count}`);
    console.log(`Escalation save rate: ${(mc.escalation_save_rate * 100).toFixed(1)}%`);

    console.log('\nSuccess Rates:');
    for (const [key, data] of Object.entries(mc.success_rates ?? {})) {
      const d = data as { total: number; passing: number; rate: number };
      console.log(`  ${key}: ${d.passing}/${d.total} (${(d.rate * 100).toFixed(1)}%)`);
    }

    console.log('\nRecommendations:');
    for (const [club, rec] of Object.entries(mc.recommendations ?? {})) {
      const r = rec as { model: string; reason: string };
      console.log(`  ${club}: → ${r.model} (${r.reason})`);
    }

    if (mc.notes?.length > 0) {
      console.log('\nNotes:');
      for (const note of mc.notes) console.log(`  - ${note}`);
    }
    console.log('');
  } catch {
    console.error('Error reading model-config.json');
    process.exit(1);
  }
}

// ── guide ───────────────────────────────────────────

function guideSubcommand(flags: Record<string, string>, cwd: string): void {
  const config = resolveLoopConfig(cwd);
  const guidePath = join(cwd, config.agentGuide);

  if (!existsSync(guidePath)) {
    console.log(`Agent guide not found: ${guidePath}`);
    return;
  }

  const content = readFileSync(guidePath, 'utf8');
  const words = content.split(/\s+/).length;
  const limit = config.agentGuideMaxWords;
  const status = words > limit ? 'OVER LIMIT' : 'ok';
  const color = words > limit ? '\x1b[31m' : '\x1b[32m';
  const reset = '\x1b[0m';

  console.log(`\nAgent Guide: ${guidePath}`);
  console.log(`  Words: ${color}${words}/${limit} (${status})${reset}`);

  if (flags.check === 'true' && words > limit) {
    console.log(`  Warning: SKILL.md exceeds ${limit} words — needs synthesis`);
    process.exit(1);
  }
  console.log('');
}

// ── clean ───────────────────────────────────────────

function cleanSubcommand(flags: Record<string, string>, cwd: string): void {
  const config = resolveLoopConfig(cwd);
  const all = flags.all === 'true';
  const cleanResults = all || flags.results === 'true';
  const cleanLogs = all || flags.logs === 'true';
  const cleanWorktrees = all || flags.worktrees === 'true';
  const log = createLogger('loop:clean');

  if (!cleanResults && !cleanLogs && !cleanWorktrees) {
    console.log('Specify what to clean: --results, --logs, --worktrees, or --all');
    return;
  }

  if (cleanResults) {
    const dir = join(cwd, config.resultsDir);
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      log.info(`Cleaning ${files.length} file(s) from ${config.resultsDir}/`);
      for (const f of files) {
        try { unlinkSync(join(dir, f)); } catch { /* skip */ }
      }
    }
  }

  if (cleanLogs) {
    const dir = join(cwd, config.logDir);
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      log.info(`Cleaning ${files.length} file(s) from ${config.logDir}/`);
      for (const f of files) {
        try { unlinkSync(join(dir, f)); } catch { /* skip */ }
      }
    }
  }

  if (cleanWorktrees) {
    try {
      execSync('git worktree prune', { cwd, stdio: 'pipe' });
    } catch { /* ok */ }

    const worktreePattern = '.slope-loop-worktree-';
    const entries = readdirSync(cwd).filter(e => e.startsWith(worktreePattern));
    for (const wt of entries) {
      log.info(`Removing worktree: ${wt}`);
      try {
        execSync(`git worktree remove "${join(cwd, wt)}" --force`, { cwd, stdio: 'pipe' });
      } catch {
        log.warn(`Failed to remove worktree ${wt}`);
      }
    }
  }

  log.info('Clean complete');
}
