import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScorecard, buildAgentBreakdowns, computeSlope, parseTestOutput, classifyShotFromSignals, buildGhCommand, parsePRJson, mergePRChecksWithCI } from '../../core/index.js';
import type { ShotRecord, CISignal, PRSignal, ShotResult, AgentBreakdown } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { resolveStore } from '../store.js';

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

export async function autoCardCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const config = loadConfig();

  const sprintNumber = parseInt(opts.sprint ?? '', 10);
  if (!sprintNumber) {
    console.error('\nUsage: slope auto-card --sprint=<N> [--since=<date>] [--branch=<ref>] [--theme=<text>] [--player=<name>] [--test-output=<file>] [--pr=<number>] [--swarm=<id>] [--dry-run]\n');
    console.error('  --sprint       Sprint number (required)');
    console.error('  --since        Git log start date, e.g. "2026-02-20" (optional)');
    console.error('  --branch       Git ref to scan (default: HEAD)');
    console.error('  --theme        Sprint theme (default: auto-generated)');
    console.error('  --player       Player name for multi-developer repos');
    console.error('  --test-output  Path to test runner output file (Vitest/Jest) for CI-aware scoring');
    console.error('  --pr           PR number to fetch review/check metadata via `gh` CLI');
    console.error('  --swarm        Swarm ID — map commits to agents for per-agent breakdowns');
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

  // Fetch PR metadata if --pr provided
  let prSignal: PRSignal | undefined;
  if (opts.pr) {
    const prNumber = parseInt(opts.pr, 10);
    if (prNumber > 0) {
      try {
        const cmd = buildGhCommand(prNumber);
        const raw = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const json = JSON.parse(raw) as Record<string, unknown>;
        prSignal = parsePRJson(json);
        // Merge PR check data with CI signal
        ciSignal = mergePRChecksWithCI(prSignal, ciSignal);
      } catch {
        console.error(`  Warning: Could not fetch PR #${prNumber} via gh CLI. Is gh installed and authenticated?`);
      }
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
      pr: prSignal,
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

  // Build per-agent breakdowns when --swarm is provided
  let agents: AgentBreakdown[] | undefined;
  if (opts.swarm) {
    agents = await buildSwarmAgents(opts.swarm, commits, shots);
  }

  const card = buildScorecard({
    sprint_number: sprintNumber,
    theme,
    par: shots.length <= 2 ? 3 : shots.length <= 4 ? 4 : 5,
    slope: computeSlope(slopeFactors),
    date: new Date().toISOString().split('T')[0],
    shots,
    ...(opts.player ? { player: opts.player } : {}),
    ...(agents ? { agents } : {}),
  });

  const output = {
    ...card,
    slope_factors: slopeFactors,
    _auto_generated: true,
    _commits: commits.length,
    _ci_signal: ciSignal ? { runner: ciSignal.runner, passed: ciSignal.test_passed, failed: ciSignal.test_failed } : null,
    _pr_signal: prSignal ? { pr_number: prSignal.pr_number, review_cycles: prSignal.review_cycles, change_requests: prSignal.change_request_count, review_decision: prSignal.review_decision } : null,
    _note: prSignal
      ? 'Auto-generated with CI + PR signals. Review shot results before filing.'
      : ciSignal
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
  if (prSignal) {
    console.log(`  PR: #${prSignal.pr_number} — ${prSignal.review_decision}, ${prSignal.review_cycles} review cycle(s), ${prSignal.change_request_count} change request(s)`);
  }
  if (card.agents && card.agents.length > 0) {
    console.log(`  Agents: ${card.agents.length} (${card.agents.map(a => `${a.agent_role}: ${a.shots.length} shots`).join(', ')})`);
  }
  console.log(`\n  Review shot results before filing.\n`);
}

/**
 * Build per-agent breakdowns by mapping commits to swarm sessions via branch.
 * Commits whose branch matches a session's branch are attributed to that agent.
 * Unmatched commits are grouped under an "unknown" agent.
 */
async function buildSwarmAgents(
  swarmId: string,
  commits: CommitInfo[],
  shots: ShotRecord[],
): Promise<AgentBreakdown[]> {
  const cwd = process.cwd();
  const store = await resolveStore(cwd);
  try {
    const sessions = await store.getSessionsBySwarm(swarmId);
    if (sessions.length === 0) {
      console.error(`  Warning: No sessions found for swarm "${swarmId}". Skipping agent breakdowns.`);
      return [];
    }

    // Map branches to sessions
    const branchToSession = new Map<string, { session_id: string; agent_role: string }>();
    for (const s of sessions) {
      if (s.branch) {
        branchToSession.set(s.branch, {
          session_id: s.session_id,
          agent_role: s.agent_role ?? 'generalist',
        });
      }
    }

    // Map each commit to an agent by checking which branches contain it
    const agentShots = new Map<string, { session_id: string; agent_role: string; shots: ShotRecord[] }>();

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const shot = shots[i];
      let matched = false;

      for (const [branch, agent] of branchToSession) {
        // Check if this commit is reachable from this branch
        const isAncestor = git(`merge-base --is-ancestor ${commit.hash} ${branch} 2>/dev/null && echo yes || echo no`);
        if (isAncestor === 'yes') {
          const key = agent.session_id;
          if (!agentShots.has(key)) {
            agentShots.set(key, { ...agent, shots: [] });
          }
          agentShots.get(key)!.shots.push(shot);
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Fall back: attribute to first session or "unknown"
        const fallbackKey = '_unmatched';
        if (!agentShots.has(fallbackKey)) {
          agentShots.set(fallbackKey, { session_id: 'unmatched', agent_role: 'unknown', shots: [] });
        }
        agentShots.get(fallbackKey)!.shots.push(shot);
      }
    }

    return buildAgentBreakdowns(
      Array.from(agentShots.values()).map(a => ({
        session_id: a.session_id,
        agent_role: a.agent_role,
        shots: a.shots,
      })),
    );
  } finally {
    store.close();
  }
}
