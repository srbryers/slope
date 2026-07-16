import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateStandup,
  formatStandup,
  parseStandup,
  extractRelevantHandoffs,
  aggregateStandups,
  formatTeamStandup,
} from '../../core/index.js';
import type { SlopeEvent, SprintClaim, StandupContext, StandupReport } from '../../core/index.js';
import { readTranscript } from '../../core/transcript.js';
import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { scorecardExistsForSprint } from '../workflow-resync.js';
import { resolveStore } from '../store.js';

/** Gather repo-derived standup context; every probe is best-effort. (#619) */
function gatherStandupContext(
  cwd: string,
  config: ReturnType<typeof loadConfig>,
  sessionId: string,
  sprintNumber: number | undefined,
  sessionStartedAt: string | undefined,
): StandupContext {
  const context: StandupContext = {};

  try {
    const sprint = sprintNumber ?? inferSprintContext(cwd, config).sprint;
    if (sprint != null) {
      context.sprint = sprint;
      context.scorecard = scorecardExistsForSprint(cwd, sprint) ? 'present' : 'missing';
    }
  } catch {
    // Sprint inference is advisory.
  }

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (branch) {
      context.branch = branch;
      if (sessionStartedAt) {
        const log = execSync(
          `git log --oneline --since=${JSON.stringify(sessionStartedAt)}`,
          { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
        ).toString().trim();
        const commits = log ? log.split('\n') : [];
        context.commits = {
          count: commits.length,
          ...(commits.length > 0 ? { latest: commits[0].replace(/^\S+\s+/, '') } : {}),
        };
      }
    }
  } catch {
    // Not a git checkout, or git unavailable.
  }

  try {
    const dir = join(cwd, config.transcriptsPath ?? '.slope/transcripts');
    const turns = readTranscript(dir, sessionId);
    if (turns.length > 0) {
      let toolCalls = 0;
      let earliest = Number.POSITIVE_INFINITY;
      let latest = Number.NEGATIVE_INFINITY;
      for (const turn of turns) {
        toolCalls += turn.tool_calls?.length ?? 0;
        const time = new Date(turn.timestamp).getTime();
        if (!Number.isFinite(time)) continue;
        if (time < earliest) earliest = time;
        if (time > latest) latest = time;
      }
      context.transcript = {
        turns: turns.length,
        toolCalls,
        durationMin: Number.isFinite(earliest) && latest > earliest ? Math.round((latest - earliest) / 60000) : 0,
      };
    }
  } catch {
    // Transcript capture may be disabled.
  }

  return context;
}

export async function standupCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig();

  // Parse args
  let sessionId: string | undefined;
  let ingestPath: string | undefined;
  let roleId: string | undefined;
  let sprintNumber: number | undefined;

  let aggregate = false;

  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      sessionId = arg.slice('--session='.length).trim();
    } else if (arg.startsWith('--ingest=')) {
      ingestPath = arg.slice('--ingest='.length).trim();
    } else if (arg === '--ingest') {
      ingestPath = '-'; // stdin
    } else if (arg.startsWith('--role=')) {
      roleId = arg.slice('--role='.length).trim();
    } else if (arg.startsWith('--sprint=')) {
      sprintNumber = parseInt(arg.slice('--sprint='.length), 10);
    } else if (arg === '--aggregate') {
      aggregate = true;
    }
  }

  const store = await resolveStore(cwd);

  try {
    if (aggregate) {
      // Aggregate mode: load all standup events for current sprint
      const sprint = sprintNumber ?? config.currentSprint ?? 1;
      const events = await store.getEventsBySprint(sprint);

      // Filter to standup events and parse them
      const standupEvents = events.filter(e => e.type === 'standup');
      const standupReports: StandupReport[] = [];

      for (const e of standupEvents) {
        const report = parseStandup(e.data);
        if (report) {
          standupReports.push(report);
        }
      }

      if (standupReports.length === 0) {
        console.log(`No standup reports found for sprint ${sprint}`);
        return;
      }

      const teamStandup = aggregateStandups(standupReports);
      console.log('');
      console.log(formatTeamStandup(teamStandup));

      if (args.includes('--json')) {
        console.log('---');
        console.log(JSON.stringify(teamStandup, null, 2));
      }
    } else if (ingestPath) {
      // Ingest mode: read another agent's standup and surface handoffs
      let raw: string;
      if (ingestPath === '-') {
        raw = readFileSync('/dev/stdin', 'utf8');
      } else {
        raw = readFileSync(ingestPath, 'utf8');
      }

      const data = JSON.parse(raw);
      const standup = parseStandup(data);
      if (!standup) {
        console.error('Invalid standup format — missing sessionId, status, or progress');
        process.exit(1);
      }

      // Store as event
      await store.insertEvent({
        session_id: standup.sessionId,
        type: 'standup',
        data: data,
        sprint_number: sprintNumber ?? config.currentSprint,
      });

      // Show relevant handoffs
      const handoffs = extractRelevantHandoffs(standup, roleId);
      console.log(`\nIngested standup from ${standup.sessionId} (${standup.status})`);

      if (handoffs.length > 0) {
        console.log('\nRelevant handoffs:');
        for (const h of handoffs) {
          const forRole = h.for_role ? ` (for: ${h.for_role})` : '';
          console.log(`  - ${h.target}: ${h.description}${forRole}`);
        }
      }

      if (standup.blockers.length > 0) {
        console.log('\nBlockers:');
        for (const b of standup.blockers) {
          console.log(`  - ${b}`);
        }
      }
    } else {
      // Generate mode: create standup from current session
      if (!sessionId) {
        // Find most recent session
        const sessions = await store.getActiveSessions();
        if (sessions.length === 0) {
          console.error('No active sessions. Start a session with: slope session start');
          process.exit(1);
        }
        sessionId = sessions[0].session_id;
      }

      // Load session events and claims
      const events = await store.getEventsBySession(sessionId);
      const sprint = sprintNumber ?? config.currentSprint ?? 1;
      const claims = await store.getActiveClaims(sprint);

      // Find agent_role from session
      const sessions = await store.getActiveSessions();
      const session = sessions.find(s => s.session_id === sessionId);
      const agent_role = session?.agent_role;

      const report = generateStandup({
        sessionId,
        agent_role,
        events,
        claims,
        context: gatherStandupContext(cwd, config, sessionId, sprintNumber, session?.started_at),
      });

      // Store standup as event
      await store.insertEvent({
        session_id: sessionId,
        type: 'standup',
        data: report as unknown as Record<string, unknown>,
        sprint_number: sprint,
      });

      // Output formatted report
      console.log('');
      console.log(formatStandup(report));

      // Also output JSON for piping to other agents
      if (args.includes('--json')) {
        console.log('---');
        console.log(JSON.stringify(report, null, 2));
      }
    }
  } finally {
    store.close();
  }
}
