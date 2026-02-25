import { readFileSync } from 'node:fs';
import {
  generateStandup,
  formatStandup,
  parseStandup,
  extractRelevantHandoffs,
  aggregateStandups,
  formatTeamStandup,
} from '../../core/index.js';
import type { SlopeEvent, SprintClaim, StandupReport } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { resolveStore } from '../store.js';

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
