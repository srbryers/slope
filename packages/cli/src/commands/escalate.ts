import {
  detectEscalation,
  buildEscalationEvent,
  checkConflicts,
} from '@srbryers/core';
import type { EscalationResult } from '@srbryers/core';
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

export async function escalateCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  // Manual escalation: slope escalate --reason="description" [--session-id=<id>]
  if (flags.reason) {
    await manualEscalation(flags, cwd, config);
    return;
  }

  // Auto-detect: slope escalate --swarm=<id> [--sprint=<N>]
  if (flags.swarm) {
    await detectSwarmEscalations(flags, cwd, config);
    return;
  }

  console.log(`
slope escalate — Detect and manage escalation conditions

Usage:
  slope escalate --swarm=<id> [--sprint=<N>]   Auto-detect escalations in a swarm
  slope escalate --reason="<description>"       Manual escalation
    [--session-id=<id>] [--sprint=<N>]
`);
}

async function manualEscalation(
  flags: Record<string, string>,
  cwd: string,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const sessionId = flags['session-id'] ?? 'manual';
    const sprintNumber = flags.sprint ? parseInt(flags.sprint, 10) : undefined;
    const reason = flags.reason;

    const escalation: EscalationResult = {
      trigger: 'manual',
      severity: 'warning',
      description: reason,
      session_id: sessionId,
      actions: config.orchestration?.escalation?.actions ?? ['log_event', 'notify_standup'],
    };

    const event = buildEscalationEvent(escalation, sessionId, sprintNumber);
    await store.insertEvent(event);

    console.log(`\n  Escalation logged:`);
    console.log(`    Trigger: manual`);
    console.log(`    Reason: ${reason}`);
    console.log(`    Session: ${sessionId}`);
    if (sprintNumber) console.log(`    Sprint: ${sprintNumber}`);
    console.log('');
  } finally {
    store.close();
  }
}

async function detectSwarmEscalations(
  flags: Record<string, string>,
  cwd: string,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const swarmId = flags.swarm;
    const sprintNumber = flags.sprint ? parseInt(flags.sprint, 10) : undefined;

    const sessions = await store.getSessionsBySwarm(swarmId);
    if (sessions.length === 0) {
      console.log(`\n  No sessions found for swarm "${swarmId}".\n`);
      return;
    }

    // Gather standups from latest standup events per session
    const standups = [];
    for (const s of sessions) {
      const events = await store.getEventsBySession(s.session_id);
      const standupEvents = events.filter(e => e.type === 'standup');
      if (standupEvents.length > 0) {
        const latest = standupEvents[standupEvents.length - 1];
        const rawStatus = (latest.data?.status as string) ?? 'working';
        const status = (['working', 'blocked', 'complete'].includes(rawStatus)
          ? rawStatus
          : 'working') as 'working' | 'blocked' | 'complete';
        standups.push({
          sessionId: s.session_id,
          agent_role: s.agent_role,
          status,
          progress: (latest.data?.progress as string) ?? '',
          blockers: (latest.data?.blockers as string[]) ?? [],
          decisions: (latest.data?.decisions as string[]) ?? [],
          handoffs: (latest.data?.handoffs as Array<{ target: string; description: string; for_role?: string }>) ?? [],
          timestamp: latest.timestamp,
        });
      }
    }

    // Gather conflicts
    const allClaims = await store.getActiveClaims(sprintNumber);
    const swarmSessionIds = new Set(sessions.map(s => s.session_id));
    const swarmClaims = allClaims.filter(c => c.session_id && swarmSessionIds.has(c.session_id));
    const conflicts = swarmClaims.length > 1 ? checkConflicts(swarmClaims) : [];

    // Gather failure events across swarm
    const allEvents = [];
    for (const s of sessions) {
      const events = await store.getEventsBySession(s.session_id);
      allEvents.push(...events);
    }

    // Detect
    const escalations = detectEscalation({
      config: config.orchestration?.escalation,
      standups,
      conflicts,
      events: allEvents,
    });

    if (escalations.length === 0) {
      console.log(`\n  Swarm "${swarmId}" — no escalation conditions detected.\n`);
      return;
    }

    console.log(`\n  Swarm "${swarmId}" — ${escalations.length} escalation${escalations.length === 1 ? '' : 's'} detected:`);
    console.log('');

    for (const esc of escalations) {
      const icon = esc.severity === 'critical' ? '!!' : '~';
      console.log(`    [${icon}] ${esc.trigger}: ${esc.description}`);

      // Log event
      if (esc.actions.includes('log_event')) {
        const sessionId = esc.session_id ?? sessions[0].session_id;
        const event = buildEscalationEvent(esc, sessionId, sprintNumber);
        await store.insertEvent(event);
      }
    }

    console.log('');
  } finally {
    store.close();
  }
}
