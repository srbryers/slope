import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScorecard, computeSlope, parseTestOutput, classifyShotFromSignals } from '@slope-dev/core';
import type { ShotRecord, CISignal, ShotResult } from '@slope-dev/core';
import { loadConfig } from '../config.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

interface CommitInfo {
  hash: string;
  subject: string;
  filesChanged: number;
}

function getCommits(since?: string, branch?: string): CommitInfo[] {
  const ref = branch ?? 'HEAD';
  const sinceArg = since ? `--since="${since}"` : '';
  const log = git(`log ${ref} ${sinceArg} --format="%H|||%s" --no-merges`);
  if (!log) return [];

  return log.split('\n').filter(Boolean).map((line) => {
    const [hash, subject] = line.split('|||');
    const stat = git(`diff-tree --no-commit-id --name-only -r ${hash}`);
    return {
      hash,
      subject: subject ?? '',
      filesChanged: stat ? stat.split('\n').filter(Boolean).length : 0,
    };
  });
}

function inferTicketKey(subject: string, index: number, sprintNumber: number): string {
  const ticketMatch = subject.match(/\b[A-Z]+-\d+\b/) ?? subject.match(/\bS\d+-\d+\b/i);
  if (ticketMatch) return ticketMatch[0];
  return `S${sprintNumber}-${index + 1}`;
}

function inferClub(filesChanged: number): ShotRecord['club'] {
  if (filesChanged >= 10) return 'driver';
  if (filesChanged >= 5) return 'long_iron';
  if (filesChanged >= 2) return 'short_iron';
  return 'wedge';
}

function inferSlopeFactors(commits: CommitInfo[]): string[] {
  const factors: string[] = [];
  const allSubjects = commits.map((c) => c.subject.toLowerCase()).join(' ');

  if (allSubjects.includes('migration') || allSubjects.includes('schema')) factors.push('schema_migration');
  if (allSubjects.includes('deploy') || allSubjects.includes('ci') || allSubjects.includes('docker')) factors.push('deployment');
  if (commits.some((c) => c.filesChanged > 15)) factors.push('large_scope');
  if (allSubjects.includes('refactor')) factors.push('refactor');
  if (new Set(commits.flatMap((c) => c.subject.match(/packages\/\w+/g) ?? [])).size > 1) factors.push('cross_package');

  return factors;
}

export function autoCardCommand(args: string[]): void {
  const opts = parseArgs(args);
  const config = loadConfig();

  const sprintNumber = parseInt(opts.sprint ?? '', 10);
  if (!sprintNumber) {
    console.error('\nUsage: slope auto-card --sprint=<N> [--since=<date>] [--branch=<ref>] [--theme=<text>] [--test-output=<file>] [--dry-run]\n');
    console.error('  --sprint       Sprint number (required)');
    console.error('  --since        Git log start date, e.g. "2026-02-20" (optional)');
    console.error('  --branch       Git ref to scan (default: HEAD)');
    console.error('  --theme        Sprint theme (default: auto-generated)');
    console.error('  --test-output  Path to test runner output file (Vitest/Jest) for CI-aware scoring');
    console.error('  --dry-run      Print scorecard JSON without writing to disk\n');
    process.exit(1);
  }

  const commits = getCommits(opts.since, opts.branch);

  if (commits.length === 0) {
    console.error('\nNo commits found. Try specifying --since or --branch.\n');
    process.exit(1);
  }

  // Parse CI output if provided
  let ciSignal: CISignal | undefined;
  if (opts['test-output']) {
    try {
      const raw = readFileSync(opts['test-output'], 'utf8');
      ciSignal = parseTestOutput(raw);
    } catch {
      console.error(`  Warning: Could not read test output from ${opts['test-output']}`);
    }
  }

  const shots: ShotRecord[] = commits.map((commit, i) => {
    const files = git(`diff-tree --no-commit-id --name-only -r ${commit.hash}`)
      .split('\n').filter(Boolean);

    // Classify using combined signals
    const classification = classifyShotFromSignals({
      trace: {
        planned_scope_paths: files,
        modified_files: files,
        test_results: [],
        reverts: 0,
        elapsed_minutes: 0,
        hazards_encountered: [],
      },
      ci: ciSignal,
    });

    return {
      ticket_key: inferTicketKey(commit.subject, i, sprintNumber),
      title: commit.subject,
      club: inferClub(commit.filesChanged),
      result: classification.result as ShotResult,
      hazards: [],
      notes: `${commit.filesChanged} files changed (${classification.reasoning})`,
    };
  });

  const slopeFactors = inferSlopeFactors(commits);
  const theme = opts.theme ?? `Sprint ${sprintNumber}`;

  const card = buildScorecard({
    sprint_number: sprintNumber,
    theme,
    par: shots.length <= 2 ? 3 : shots.length <= 4 ? 4 : 5,
    slope: computeSlope(slopeFactors),
    date: new Date().toISOString().split('T')[0],
    shots,
  });

  const output = {
    ...card,
    slope_factors: slopeFactors,
    _auto_generated: true,
    _commits: commits.length,
    _ci_signal: ciSignal ? { runner: ciSignal.runner, passed: ciSignal.test_passed, failed: ciSignal.test_failed } : null,
    _note: ciSignal
      ? 'Auto-generated with CI signals. Review shot results before filing.'
      : 'Auto-generated from git only (no CI). Shots default to green. Provide --test-output for better scoring.',
  };

  const json = JSON.stringify(output, null, 2);

  if (args.includes('--dry-run')) {
    console.log('\n' + json + '\n');
    return;
  }

  const cwd = process.cwd();
  const outPath = join(cwd, config.scorecardDir, `sprint-${sprintNumber}.json`);

  if (existsSync(outPath)) {
    console.error(`\n  ${outPath} already exists. Use --dry-run to preview, then write manually.\n`);
    process.exit(1);
  }

  writeFileSync(outPath, json + '\n');
  console.log(`\n  Written to ${outPath}`);
  console.log(`  ${commits.length} commits → ${shots.length} shots`);
  console.log(`  Par: ${card.par} | Slope: ${card.slope} (${slopeFactors.join(', ') || 'none'})`);
  if (ciSignal) {
    console.log(`  CI: ${ciSignal.runner} — ${ciSignal.test_passed}/${ciSignal.test_total} tests pass`);
  } else {
    console.log(`  No CI output — shots default to green. Use --test-output for better scoring.`);
  }
  console.log(`\n  Review shot results before filing.\n`);
}
