/**
 * `slope retro` — Retrospective scorecard utilities.
 *
 * Currently exposes one subcommand:
 *   slope retro backfill --sprint=N         Generate a scorecard from git
 *   slope retro backfill --all-missing      Backfill all shipped-but-missing
 *
 * Closes the tooling part of GH #318. The data backfill for S70 + S74-S83
 * shipped earlier in S86-4 (one-shot script); this command makes the
 * pattern repeatable for future sprints that ship without their post-hole.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findShippedSprintsOnMain, parseRoadmap, castRoadmapStructure } from '../../core/index.js';
import type { RoadmapDefinition, RoadmapSprint } from '../../core/index.js';
import { loadConfig } from '../config.js';

interface BackfillOptions {
  sprint?: number;
  allMissing?: boolean;
  dryRun?: boolean;
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

Output: docs/retros/sprint-N.json with _backfilled:true marker.

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
      const path = join(retroDir, pattern.replace('*', String(id)));
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
    const path = join(retroDir, pattern.replace('*', String(sid)));
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
