/**
 * `slope retro` — Retrospective scorecard utilities.
 *
 * Currently exposes two subcommands:
 *   slope retro backfill --sprint=N         Generate a scorecard from git
 *   slope retro backfill --all-missing      Backfill all shipped-but-missing
 *   slope retro post-merge --sprint=N       Capture post-merge learnings
 *
 * Closes the tooling part of GH #318. The data backfill for S70 + S74-S83
 * shipped earlier in S86-4 (one-shot script); this command makes the
 * pattern repeatable for future sprints that ship without their post-hole.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  findShippedSprintsOnMain,
  parseRoadmap,
  castRoadmapStructure,
  buildPostMergeRetro,
  buildRetroMemoryPlans,
  persistRetroMemories,
  parseSprintNumber,
} from '../../core/index.js';
import type {
  MemoryCategory,
  PostMergeRetroResult,
  RetroLearningInput,
  RetroOutcome,
  RoadmapDefinition,
  RoadmapSprint,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { updateSprintPhaseForSprint } from '../sprint-state.js';

interface BackfillOptions {
  sprint?: number;
  allMissing?: boolean;
  dryRun?: boolean;
}

interface ParsedArgs {
  flags: Map<string, string[]>;
  positionals: string[];
}

interface PostMergeOptions {
  sprint?: number;
  pr?: number;
  outcome?: RetroOutcome;
  mergedAt?: string;
  summary?: string;
  learnings: RetroLearningInput[];
  hazards: string[];
  followUps: string[];
  sourceSessionId?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface SavedPostMergeRetro {
  retro: PostMergeRetroResult;
  memory: {
    added: string[];
    skipped: number;
    planned: number;
  };
}

export async function retroCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === '--help' || sub === '-h' || sub === undefined) {
    printHelp();
    return;
  }

  if (sub === 'backfill') {
    await backfillSubcommand(args.slice(1));
    return;
  }

  if (sub === 'post-merge') {
    await postMergeSubcommand(args.slice(1));
    return;
  }

  console.error(`\nUnknown retro subcommand: ${sub}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`
slope retro — Retrospective scorecard utilities

Usage:
  slope retro backfill --sprint=N [--dry-run]   Generate a scorecard from git
                                                 history for sprint N.
  slope retro backfill --all-missing [--dry-run] Backfill every shipped sprint
                                                 that has no scorecard.
  slope retro post-merge --sprint=N [--pr=N]    Capture a post-PR-merge retro,
    [--summary=TEXT] [--learning=TEXT]...       persist learnings to memory,
    [--hazard=TEXT]... [--follow-up=TEXT]...    and save the retro record.
    [--outcome=success|mixed|follow_up] [--json] [--dry-run]
    Learning prefixes: category[:weight]:TEXT where category is workflow,
    style, project, hazard, or other; process aliases to workflow; weight is 1-10.

Output: docs/retros/sprint-N.json with _backfilled:true marker.
Post-merge output: .slope/retros/post-merge/sprint-N[-pr-M].json.

Limitations:
  - Lossy: original CI/PR signals are not recoverable from commit log.
  - Defaults all shots to "green" — score:par. Reviewers can amend
    afterward via \`slope review findings add\` + \`slope review amend\`.
`);
}

function parseFlags(args: string[]): BackfillOptions {
  const opts: BackfillOptions = {};
  for (const a of args) {
    if (a.startsWith('--sprint=')) opts.sprint = parseInt(a.slice('--sprint='.length), 10);
    else if (a === '--all-missing') opts.allMissing = true;
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

const VALUE_FLAGS = new Set([
  'sprint',
  'pr',
  'outcome',
  'merged-at',
  'summary',
  'learning',
  'hazard',
  'follow-up',
  'session-id',
]);

const VALID_OUTCOMES: RetroOutcome[] = ['success', 'mixed', 'follow_up'];
const VALID_MEMORY_CATEGORIES: MemoryCategory[] = ['workflow', 'style', 'project', 'hazard', 'other'];
const MEMORY_CATEGORY_ALIASES: Record<string, MemoryCategory> = {
  process: 'workflow',
};

function parseArgs(args: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    let name: string;
    let value: string;
    if (eq >= 0) {
      name = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      name = arg.slice(2);
      const next = args[i + 1];
      if (VALUE_FLAGS.has(name) && next && !next.startsWith('--')) {
        value = next;
        i++;
      } else {
        value = 'true';
      }
    }

    const existing = flags.get(name) ?? [];
    existing.push(value);
    flags.set(name, existing);
  }

  return { flags, positionals };
}

function firstFlag(flags: Map<string, string[]>, name: string): string | undefined {
  return flags.get(name)?.at(-1);
}

function allFlags(flags: Map<string, string[]>, name: string): string[] {
  return flags.get(name) ?? [];
}

function positiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function positiveSprintNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseSprintNumber(value);
  if (parsed === null) {
    throw new TypeError(`${label} must be a positive sprint id, e.g. 137 or 146.1.`);
  }
  return parsed;
}

function normalizeOutcome(value: string | undefined): RetroOutcome | undefined {
  if (!value) return undefined;
  const normalized = value.replace('-', '_');
  if (VALID_OUTCOMES.includes(normalized as RetroOutcome)) return normalized as RetroOutcome;
  throw new TypeError('--outcome must be one of: success, mixed, follow_up.');
}

function parseLearningSpec(value: string): RetroLearningInput {
  const trimmed = value.trim();
  const match = trimmed.match(/^([a-z][a-z_-]*)(?::([^:]+))?:(.+)$/);
  if (!match) return { text: trimmed };

  const [, rawCategory, rawWeight, text] = match;
  const category = VALID_MEMORY_CATEGORIES.includes(rawCategory as MemoryCategory)
    ? rawCategory as MemoryCategory
    : MEMORY_CATEGORY_ALIASES[rawCategory];
  if (!category) {
    const aliases = Object.entries(MEMORY_CATEGORY_ALIASES)
      .map(([alias, target]) => `${alias}->${target}`)
      .join(', ');
    throw new TypeError(`Unsupported --learning category prefix "${rawCategory}". Use: ${VALID_MEMORY_CATEGORIES.join(', ')}${aliases ? `; aliases: ${aliases}` : ''}.`);
  }

  let weight: number | undefined;
  if (rawWeight !== undefined) {
    weight = parseInt(rawWeight, 10);
    if (!Number.isInteger(weight) || String(weight) !== rawWeight.trim() || weight < 1 || weight > 10) {
      throw new TypeError('--learning weight prefix must be an integer from 1 to 10.');
    }
  }

  return {
    text: text.trim(),
    category,
    ...(weight !== undefined ? { weight } : {}),
  };
}

function parsePostMergeOptions(args: string[]): PostMergeOptions {
  const parsed = parseArgs(args);
  const { flags } = parsed;
  const sprint = positiveSprintNumber(firstFlag(flags, 'sprint'), '--sprint');
  const pr = positiveInteger(firstFlag(flags, 'pr'), '--pr');
  const outcome = normalizeOutcome(firstFlag(flags, 'outcome'));
  const mergedAt = firstFlag(flags, 'merged-at');
  const summary = firstFlag(flags, 'summary') ?? (parsed.positionals.length > 0 ? parsed.positionals.join(' ') : undefined);
  const sourceSessionId = firstFlag(flags, 'session-id');

  return {
    ...(sprint !== undefined ? { sprint } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(outcome ? { outcome } : {}),
    ...(mergedAt ? { mergedAt } : {}),
    ...(summary ? { summary } : {}),
    learnings: allFlags(flags, 'learning').map(parseLearningSpec),
    hazards: allFlags(flags, 'hazard'),
    followUps: allFlags(flags, 'follow-up'),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    dryRun: flags.has('dry-run'),
    json: flags.has('json'),
  };
}

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

interface SprintCommit {
  hash: string;
  isoDate: string;
  subject: string;
}

/** Find commits on main referencing a specific sprint. Matches the same
 *  patterns as findShippedSprintsOnMain but returns the actual commits.
 *  Used to build per-shot data for the backfilled scorecard. */
function commitsForSprint(cwd: string, sprintId: number): SprintCommit[] {
  const ref = git('symbolic-ref --short refs/remotes/origin/HEAD', cwd) || 'main';
  // Pattern matches feat(SXX), (SXX), feat(SXX-N), feat(SXX+SYY) — same shapes
  // findShippedSprintsOnMain detects.
  const pattern = `[(+]S${sprintId}[+):-]`;
  const log = git(`log -E --grep="${pattern}" --format="%H|%aI|%s" -n 100 ${ref}`, cwd);
  if (!log) return [];
  return log.split('\n').filter(Boolean).map(line => {
    const [hash, isoDate, ...rest] = line.split('|');
    return { hash, isoDate, subject: rest.join('|') };
  }).reverse(); // oldest first
}

function loadRoadmap(cwd: string): RoadmapDefinition | null {
  try {
    const config = loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return null;
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    return parseRoadmap(raw).roadmap ?? castRoadmapStructure(raw);
  } catch {
    return null;
  }
}

interface BackfillResult {
  sprint: number;
  path: string;
  shots: number;
  par: number;
  slope: number;
  written: boolean;
  reason?: string;
}

function inferTicketKey(subject: string, idx: number, sprintId: number): string {
  // Try to extract S{N}-{M} or S{N}-T{M} from the subject
  const m = subject.match(/S(\d+)-(T?\d+)/i);
  if (m && parseInt(m[1], 10) === sprintId) {
    return `S${sprintId}-${m[2]}`;
  }
  return `S${sprintId}-${idx + 1}`;
}

function inferClub(filesChanged: number): string {
  if (filesChanged > 15) return 'long_iron';
  if (filesChanged > 5) return 'short_iron';
  if (filesChanged > 1) return 'wedge';
  return 'putter';
}

export function buildBackfillScorecard(
  cwd: string,
  sprintId: number,
  roadmap: RoadmapDefinition | null,
): { scorecard: Record<string, unknown> | null; reason?: string } {
  const commits = commitsForSprint(cwd, sprintId);
  if (commits.length === 0) {
    return { scorecard: null, reason: 'no commits found' };
  }

  const sprint = roadmap?.sprints.find(s => s.id === sprintId);
  const par = (sprint?.par ?? 4) as 3 | 4 | 5;
  const slope = sprint?.slope ?? 1;
  const theme = (sprint as RoadmapSprint & { theme?: string })?.theme
    ?? extractThemeFromCommits(commits, sprintId);

  const shots = commits.map((c, i) => {
    const filesRaw = git(`diff-tree --no-commit-id --name-only -r ${c.hash}`, cwd);
    const filesChanged = filesRaw ? filesRaw.split('\n').filter(Boolean).length : 0;
    return {
      ticket_key: inferTicketKey(c.subject, i, sprintId),
      title: c.subject,
      club: inferClub(filesChanged),
      result: 'green',
      hazards: [],
      notes: `Backfilled from commit ${c.hash.slice(0, 8)} on main. Original CI/PR signals not preserved.`,
    };
  });

  const n = shots.length;
  const scorecard = {
    sprint_number: sprintId,
    theme,
    par,
    slope,
    score: par,
    score_label: 'par',
    date: commits[0].isoDate.split('T')[0],
    shots,
    stats: {
      fairways_hit: n,
      fairways_total: n,
      greens_in_regulation: n,
      greens_total: n,
      putts: 0,
      penalties: 0,
      hazards_hit: 0,
      hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    conditions: [
      `Backfilled retroactively via slope retro backfill`,
      `Source: ${commits.length} commit(s) on main referencing S${sprintId}`,
      'Original CI/PR/test data not recoverable',
    ],
    special_plays: [],
    bunker_locations: [],
    yardage_book_updates: [],
    course_management_notes: [
      `This scorecard was backfilled by the slope retro backfill command — treat scores as placeholder par.`,
    ],
    _backfilled: true,
    _backfill_source: 'main commit log; sub-ticket detail not preserved',
    _auto_generated: true,
  };

  return { scorecard };
}

function extractThemeFromCommits(commits: SprintCommit[], sprintId: number): string {
  // Use the most likely "umbrella" commit subject — usually the last (PR
  // merge commit) since git log is reversed to oldest-first; but for
  // squash-merges that's the only commit. Strip the conventional prefix.
  const subj = commits[commits.length - 1].subject;
  const m = subj.match(/^(?:feat|fix|chore)\([^)]*\):\s*(.+)$/);
  return m ? m[1] : `Sprint ${sprintId}`;
}

function printPostMergeHelp(): void {
  console.log(`
slope retro post-merge - Capture post-PR-merge learnings

Usage:
  slope retro post-merge --sprint=N [--pr=N] [--summary=TEXT]
  slope retro post-merge --sprint=N "summary text"

Flags:
  --learning=TEXT             Durable learning. Repeatable.
  --learning=project:8:TEXT   Optional category/weight prefix.
                              Categories: workflow, style, project, hazard, other.
                              Alias: process -> workflow. Weight: 1-10.
                              Unsupported category prefixes are rejected.
  --hazard=TEXT               Hazard to persist as auto-retro memory. Repeatable.
  --follow-up=TEXT            Follow-up to persist as workflow memory. Repeatable.
  --outcome=success|mixed|follow_up
  --merged-at=ISO_DATE
  --session-id=ID
  --dry-run
  --json

Writes:
  .slope/retros/post-merge/sprint-N[-pr-M].json
  .slope/memories.json or .slope/slope.db memories with source auto-retro
`);
}

function postMergeOutputPath(cwd: string, retro: PostMergeRetroResult): string {
  const prSuffix = retro.pr ? `-pr-${retro.pr}` : '';
  return join(cwd, '.slope', 'retros', 'post-merge', `sprint-${retro.sprint}${prSuffix}.json`);
}

function writePostMergeRetro(cwd: string, record: SavedPostMergeRetro): string {
  const path = postMergeOutputPath(cwd, record.retro);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
  return path;
}

function buildSavedRetro(
  retro: PostMergeRetroResult,
  memory: ReturnType<typeof persistRetroMemories>,
): SavedPostMergeRetro {
  return {
    retro,
    memory: {
      added: memory.added.map(m => m.id),
      skipped: memory.skipped.length,
      planned: buildRetroMemoryPlans(retro).length,
    },
  };
}

async function postMergeSubcommand(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    printPostMergeHelp();
    return;
  }

  let opts: PostMergeOptions;
  try {
    opts = parsePostMergeOptions(args);
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}\n`);
    printPostMergeHelp();
    process.exit(1);
    return;
  }

  if (!opts.sprint) {
    console.error('\nUsage: slope retro post-merge --sprint=N [--pr=N] [--summary=TEXT] [--learning=TEXT]...\n');
    process.exit(1);
    return;
  }

  const cwd = process.cwd();
  let retro: PostMergeRetroResult;
  try {
    retro = buildPostMergeRetro({
      sprint: opts.sprint,
      ...(opts.pr !== undefined ? { pr: opts.pr } : {}),
      ...(opts.outcome ? { outcome: opts.outcome } : {}),
      ...(opts.mergedAt ? { mergedAt: opts.mergedAt } : {}),
      ...(opts.summary ? { summary: opts.summary } : {}),
      learnings: opts.learnings,
      hazards: opts.hazards,
      followUps: opts.followUps,
      ...(opts.sourceSessionId ? { sourceSessionId: opts.sourceSessionId } : {}),
    });
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }

  const dryRunMemory: ReturnType<typeof persistRetroMemories> = { added: [], skipped: [] };
  let memory: ReturnType<typeof persistRetroMemories>;
  try {
    memory = opts.dryRun ? dryRunMemory : persistRetroMemories(cwd, retro);
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }
  const record = buildSavedRetro(retro, memory);
  const path = postMergeOutputPath(cwd, retro);

  if (!opts.dryRun) {
    writePostMergeRetro(cwd, record);
    updateSprintPhaseForSprint(cwd, retro.sprint, 'complete');
  }

  const payload = {
    path,
    dryRun: opts.dryRun === true,
    ...record,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const target = retro.pr ? `S${retro.sprint} PR #${retro.pr}` : `S${retro.sprint}`;
  if (opts.dryRun) {
    console.log(`\n${target}: [dry-run] would write ${path}`);
  } else {
    console.log(`\n${target}: wrote ${path}`);
  }
  console.log(`  Outcome: ${retro.outcome}`);
  if (!opts.dryRun) console.log('  Sprint state: reconciled to complete when local state matched this sprint');
  console.log(`  Memories: ${record.memory.added.length} added, ${record.memory.skipped} skipped, ${record.memory.planned} planned`);
  if (retro.followUps.length > 0) {
    console.log(`  Follow-ups: ${retro.followUps.length}`);
  }
  console.log('');
}

async function backfillSubcommand(args: string[]): Promise<void> {
  const opts = parseFlags(args);

  if (!opts.sprint && !opts.allMissing) {
    console.error('\nUsage: slope retro backfill --sprint=N | --all-missing [--dry-run]\n');
    process.exit(1);
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const retroDir = join(cwd, config.scorecardDir);
  const pattern = config.scorecardPattern;
  const roadmap = loadRoadmap(cwd);

  // Resolve target sprint list
  const targets: number[] = [];
  if (opts.sprint) {
    targets.push(opts.sprint);
  } else {
    const shipped = findShippedSprintsOnMain(cwd);
    for (const id of [...shipped].sort((a, b) => a - b)) {
      const path = join(retroDir, pattern.replaceAll('*', String(id)));
      if (!existsSync(path)) targets.push(id);
    }
    if (targets.length === 0) {
      console.log('\nNo missing scorecards detected.\n');
      return;
    }
    console.log(`\nFound ${targets.length} shipped sprint(s) without scorecards: ${targets.map(t => `S${t}`).join(', ')}\n`);
  }

  const results: BackfillResult[] = [];
  for (const sid of targets) {
    const path = join(retroDir, pattern.replaceAll('*', String(sid)));
    if (existsSync(path)) {
      results.push({ sprint: sid, path, shots: 0, par: 0, slope: 0, written: false, reason: 'already exists' });
      continue;
    }

    const { scorecard, reason } = buildBackfillScorecard(cwd, sid, roadmap);
    if (!scorecard) {
      results.push({ sprint: sid, path, shots: 0, par: 0, slope: 0, written: false, reason });
      continue;
    }

    if (!opts.dryRun) {
      writeFileSync(path, JSON.stringify(scorecard, null, 2) + '\n');
    }
    results.push({
      sprint: sid,
      path,
      shots: (scorecard.shots as unknown[]).length,
      par: scorecard.par as number,
      slope: scorecard.slope as number,
      written: !opts.dryRun,
      reason: opts.dryRun ? 'dry-run' : undefined,
    });
  }

  // Print summary
  for (const r of results) {
    if (r.written) {
      console.log(`  S${r.sprint}: wrote ${r.path} (${r.shots} shots, par ${r.par}, slope ${r.slope})`);
    } else if (r.reason === 'dry-run') {
      console.log(`  S${r.sprint}: [dry-run] would write ${r.path} (${r.shots} shots, par ${r.par}, slope ${r.slope})`);
    } else {
      console.log(`  S${r.sprint}: skipped (${r.reason})`);
    }
  }
  console.log('');
}
