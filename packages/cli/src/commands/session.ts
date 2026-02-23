import { randomUUID } from 'node:crypto';
import { checkConflicts } from '@srbryers/core';
import { resolveStore } from '../store.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

export async function sessionCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseArgs(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'start':
      await startSession(flags, cwd);
      break;
    case 'end':
      await endSession(flags, cwd);
      break;
    case 'heartbeat':
      await heartbeat(flags, cwd);
      break;
    case 'list':
      await listSessions(flags, cwd);
      break;
    default:
      console.log(`
slope session — Manage live agent/IDE sessions

Usage:
  slope session start [--role=primary] [--ide=claude-code] [--branch=<b>]
  slope session start --swarm=<id> --agent-role=<role>   Join a swarm
  slope session end [--session-id=<id>]
  slope session heartbeat [--session-id=<id>]
  slope session list [--swarm=<id>]
`);
      if (sub) process.exit(1);
  }
}

async function startSession(flags: Record<string, string>, cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const sessionId = flags['session-id'] || randomUUID();
    const role = (flags.role ?? 'primary') as 'primary' | 'secondary' | 'observer';
    const ide = flags.ide ?? 'unknown';
    const branch = flags.branch;
    const worktreePath = flags['worktree-path'];
    const swarmId = flags.swarm;
    const agentRole = flags['agent-role'];

    const session = await store.registerSession({
      session_id: sessionId,
      role,
      ide,
      ...(branch ? { branch } : {}),
      ...(worktreePath ? { worktree_path: worktreePath } : {}),
      ...(swarmId ? { swarm_id: swarmId } : {}),
      ...(agentRole ? { agent_role: agentRole } : {}),
    });

    console.log(`\nSession started:`);
    console.log(`  ID:   ${session.session_id}`);
    console.log(`  Role: ${session.role}`);
    console.log(`  IDE:  ${session.ide}`);
    if (session.agent_role) console.log(`  Agent Role: ${session.agent_role}`);
    if (session.swarm_id) console.log(`  Swarm: ${session.swarm_id}`);
    if (session.branch) console.log(`  Branch: ${session.branch}`);
    console.log(`  Started: ${session.started_at}`);

    // Show swarm members if in a swarm
    if (swarmId) {
      const swarmSessions = await store.getSessionsBySwarm(swarmId);
      const others = swarmSessions.filter(s => s.session_id !== session.session_id);
      if (others.length > 0) {
        console.log(`\n  Swarm members (${others.length}):`);
        for (const s of others) {
          const roleTag = s.agent_role ? ` (${s.agent_role})` : '';
          console.log(`    ${s.session_id} [${s.role}]${roleTag} ${s.ide}`);
        }
      }

      // Check claim conflicts within swarm
      const claims = await store.getActiveClaims();
      const swarmSessionIds = new Set(swarmSessions.map(s => s.session_id));
      const swarmClaims = claims.filter(c => c.session_id && swarmSessionIds.has(c.session_id));
      if (swarmClaims.length > 0) {
        const conflicts = checkConflicts(swarmClaims);
        if (conflicts.length > 0) {
          console.log(`\n  Swarm conflicts (${conflicts.length}):`);
          for (const c of conflicts) {
            const icon = c.severity === 'overlap' ? '!!' : '~';
            console.log(`    [${icon}] ${c.reason}`);
          }
          // Log conflict events
          for (const c of conflicts) {
            await store.insertEvent({
              session_id: sessionId,
              type: 'hazard',
              data: { reason: c.reason, severity: c.severity, swarm_id: swarmId },
              sprint_number: undefined,
            });
          }
        }
      }
    } else {
      // Show other active sessions (non-swarm)
      const active = await store.getActiveSessions();
      const others = active.filter(s => s.session_id !== session.session_id);
      if (others.length > 0) {
        console.log(`\n  Other active sessions (${others.length}):`);
        for (const s of others) {
          const roleTag = s.agent_role ? ` (${s.agent_role})` : '';
          console.log(`    ${s.session_id} [${s.role}]${roleTag} ${s.ide} — ${s.branch ?? 'no branch'}`);
        }
      }
    }
    console.log('');
  } finally {
    store.close();
  }
}

async function endSession(flags: Record<string, string>, cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const sessionId = flags['session-id'];
    if (!sessionId) {
      console.error('Error: --session-id is required');
      process.exit(1);
    }

    const removed = await store.removeSession(sessionId);
    if (removed) {
      console.log(`\nSession ended: ${sessionId}`);
      console.log('  All associated claims have been released.\n');
    } else {
      console.error(`Session "${sessionId}" not found.`);
      process.exit(1);
    }
  } finally {
    store.close();
  }
}

async function heartbeat(flags: Record<string, string>, cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const sessionId = flags['session-id'];
    if (!sessionId) {
      console.error('Error: --session-id is required');
      process.exit(1);
    }

    await store.updateHeartbeat(sessionId);
    console.log(`Heartbeat updated for session ${sessionId}`);
  } finally {
    store.close();
  }
}

async function listSessions(flags: Record<string, string>, cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const swarmId = flags.swarm;
    const sessions = swarmId
      ? await store.getSessionsBySwarm(swarmId)
      : await store.getActiveSessions();

    if (sessions.length === 0) {
      const label = swarmId ? `No sessions in swarm "${swarmId}"` : 'No active sessions';
      console.log(`\n${label}.\n`);
      return;
    }

    const header = swarmId
      ? `Swarm "${swarmId}" — ${sessions.length} agent${sessions.length === 1 ? '' : 's'}`
      : `Active sessions (${sessions.length})`;
    console.log(`\n${header}:\n`);

    const allClaims = await store.getActiveClaims();

    for (const s of sessions) {
      const sessionClaims = allClaims.filter(c => c.session_id === s.session_id);
      const agentTag = s.agent_role ? ` (${s.agent_role})` : '';
      const swarmTag = s.swarm_id && !swarmId ? ` swarm:${s.swarm_id}` : '';

      console.log(`  ${s.session_id}${agentTag}${swarmTag}`);
      console.log(`    Role: ${s.role}  IDE: ${s.ide}  Branch: ${s.branch ?? '-'}`);
      console.log(`    Started: ${s.started_at}  Heartbeat: ${s.last_heartbeat_at}`);
      if (sessionClaims.length > 0) {
        console.log(`    Claims: ${sessionClaims.length}`);
        for (const c of sessionClaims) {
          console.log(`      ${c.target} (${c.scope}) — sprint ${c.sprint_number}`);
        }
      }
    }

    // Swarm-specific: show conflicts and stale agents
    if (swarmId && sessions.length > 1) {
      const swarmSessionIds = new Set(sessions.map(s => s.session_id));
      const swarmClaims = allClaims.filter(c => c.session_id && swarmSessionIds.has(c.session_id));
      if (swarmClaims.length > 0) {
        const conflicts = checkConflicts(swarmClaims);
        if (conflicts.length > 0) {
          console.log(`\n  Conflicts (${conflicts.length}):`);
          for (const c of conflicts) {
            const icon = c.severity === 'overlap' ? '!!' : '~';
            console.log(`    [${icon}] ${c.reason}`);
          }
        }
      }

      // Check for stale agents (heartbeat > 5 min old)
      const staleThreshold = 5 * 60 * 1000;
      const now = Date.now();
      const stale = sessions.filter(s => {
        const hb = new Date(s.last_heartbeat_at).getTime();
        return now - hb > staleThreshold;
      });
      if (stale.length > 0) {
        console.log(`\n  Stale agents (${stale.length}):`);
        for (const s of stale) {
          const age = Math.round((now - new Date(s.last_heartbeat_at).getTime()) / 60000);
          const roleTag = s.agent_role ? ` (${s.agent_role})` : '';
          console.log(`    ${s.session_id}${roleTag} — last heartbeat ${age}m ago`);
        }
      }
    }
    console.log('');
  } finally {
    store.close();
  }
}
