import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkConflicts } from '../../core/index.js';
import { STALE_SESSION_THRESHOLD_MS } from '../../core/constants.js';
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
    case 'dashboard':
      await dashboardCommand(flags, cwd);
      break;
    case 'handoff':
      await handoffCommand(flags, cwd);
      break;
    case 'assign':
      await assignCommand(flags, cwd);
      break;
    case 'plan':
      await planCommand(flags, cwd);
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

    await store.cleanStaleSessions(STALE_SESSION_THRESHOLD_MS);

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

// ── T4: Dashboard ────────────────────────────────────

async function dashboardCommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    await store.cleanStaleSessions(STALE_SESSION_THRESHOLD_MS);
    const sessions = await store.getActiveSessions();
    const now = Date.now();

    if (sessions.length === 0) {
      console.log('\nNo active sessions.\n');
      return;
    }

    // Collect claims across sessions
    const allClaims: Array<{ target: string; scope: string; session_id?: string; player: string; sprint_number: number }> = [];
    const sprintNumbers = new Set<number>();
    for (const s of sessions) {
      const meta = s.metadata as Record<string, unknown> | undefined;
      if (meta?.sprint) sprintNumbers.add(Number(meta.sprint));
    }
    for (const sn of sprintNumbers) {
      const claims = await store.list(sn);
      allClaims.push(...claims);
    }

    if (flags.json) {
      console.log(JSON.stringify({ sessions, claims: allClaims }, null, 2));
      return;
    }

    const red = '\x1b[31m';
    const yellow = '\x1b[33m';
    const green = '\x1b[32m';
    const gray = '\x1b[90m';
    const reset = '\x1b[0m';

    console.log(`\n=== Agent Session Dashboard === (${sessions.length} active)\n`);

    const swarms = new Map<string, typeof sessions>();
    const unswarm: typeof sessions = [];
    for (const s of sessions) {
      if (s.swarm_id) {
        const group = swarms.get(s.swarm_id) ?? [];
        group.push(s);
        swarms.set(s.swarm_id, group);
      } else {
        unswarm.push(s);
      }
    }

    const printSession = (s: typeof sessions[0]): void => {
      const hbAge = Math.round((now - new Date(s.last_heartbeat_at).getTime()) / 60000);
      const isStale = (now - new Date(s.last_heartbeat_at).getTime()) > STALE_SESSION_THRESHOLD_MS;
      const roleTag = s.agent_role ? ` [${s.agent_role}]` : '';
      const branchTag = s.branch ? ` on ${s.branch}` : '';
      const staleTag = isStale ? ` ${yellow}stale (${hbAge}m)${reset}` : ` ${gray}(${hbAge}m ago)${reset}`;
      const color = isStale ? yellow : green;
      console.log(`  ${color}*${reset} ${s.session_id.slice(0, 12)}  ${s.role}${roleTag}${branchTag}${staleTag}`);
      const myClaims = allClaims.filter(c => c.session_id === s.session_id);
      for (const c of myClaims) console.log(`    - ${c.scope}: ${c.target}`);
    };

    for (const s of unswarm) printSession(s);
    for (const [swarmId, members] of swarms) {
      console.log(`\n  Swarm: ${swarmId} (${members.length} agents)`);
      for (const s of members) printSession(s);
      const swarmClaims = allClaims.filter(c => members.some(m => m.session_id === c.session_id)) as import('../../core/index.js').SprintClaim[];
      if (swarmClaims.length > 1) {
        const conflicts = checkConflicts(swarmClaims);
        if (conflicts.length > 0) {
          console.log(`  ${red}${conflicts.length} conflict(s):${reset}`);
          for (const c of conflicts) console.log(`    ${red}${c.severity}: ${c.reason}${reset}`);
        }
      }
    }
    console.log('');
  } finally {
    store.close();
  }
}

// ── T2: Handoff ──────────────────────────────────────

async function handoffCommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const handoffsDir = join(cwd, '.slope/handoffs');

  if (flags.list) {
    if (!existsSync(handoffsDir)) { console.log('\nNo handoffs directory.\n'); return; }
    const files = readdirSync(handoffsDir).filter(f => f.startsWith('transfer-') && f.endsWith('.json'));
    if (files.length === 0) { console.log('\nNo pending handoffs.\n'); return; }
    console.log(`\n=== Pending Handoffs (${files.length}) ===\n`);
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(handoffsDir, f), 'utf8'));
        console.log(`  ${data.from?.slice(0, 12)} -> ${data.to?.slice(0, 12)}  ${data.message ?? '(no message)'}  ${data.timestamp}`);
      } catch { console.log(`  ${f} (unreadable)`); }
    }
    console.log('');
    return;
  }

  const to = flags.to;
  const from = flags.from;
  if (!to || !from) {
    console.error('Usage: slope session handoff --from=<id> --to=<id> [--message="..."]');
    console.error('       slope session handoff --list');
    process.exit(1);
  }

  const store = await resolveStore(cwd);
  try {
    const sessions = await store.getActiveSessions();
    const fromSession = sessions.find(s => s.session_id.startsWith(from));
    if (!fromSession) { console.error(`Source session not found: ${from}`); process.exit(1); }

    const meta = fromSession.metadata as Record<string, unknown> | undefined;
    const sprintNumber = meta?.sprint ? Number(meta.sprint) : undefined;
    const claims = sprintNumber ? await store.list(sprintNumber) : [];
    const fromClaims = claims.filter(c => c.session_id === fromSession.session_id);

    mkdirSync(handoffsDir, { recursive: true });
    const handoff = { from: fromSession.session_id, to, claims: fromClaims.map(c => ({ target: c.target, scope: c.scope })), message: flags.message ?? '', timestamp: new Date().toISOString() };
    const filename = `transfer-${fromSession.session_id.slice(0, 8)}-${to.slice(0, 8)}.json`;
    writeFileSync(join(handoffsDir, filename), JSON.stringify(handoff, null, 2) + '\n');

    console.log(`\nHandoff created: ${filename}`);
    console.log(`  From: ${fromSession.session_id}`);
    console.log(`  To: ${to}`);
    console.log(`  Claims: ${fromClaims.length}`);
    console.log('');
  } finally {
    store.close();
  }
}

// ── T3: Assign + Plan ────────────────────────────────

async function assignCommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const ticket = flags.ticket;
  const agent = flags.agent;
  if (!ticket || !agent) {
    console.error('Usage: slope session assign --ticket=S72-1 --agent=<session-id> [--sprint=N]');
    process.exit(1);
  }

  const store = await resolveStore(cwd);
  try {
    const sessions = await store.getActiveSessions();
    const target = sessions.find(s => s.session_id.startsWith(agent));
    if (!target) { console.error(`Agent session not found: ${agent}`); process.exit(1); }

    const meta = target.metadata as Record<string, unknown> | undefined;
    const sprintNumber = flags.sprint ? Number(flags.sprint) : (meta?.sprint ? Number(meta.sprint) : undefined);
    if (!sprintNumber) { console.error('Sprint number required (--sprint=N).'); process.exit(1); }

    // Pre-flight conflict check
    const existingClaims = await store.list(sprintNumber);
    const newClaim = { sprint_number: sprintNumber, player: target.agent_role ?? target.role ?? 'agent', target: ticket, scope: 'ticket' as const, session_id: target.session_id, id: '', claimed_at: '' };
    const conflicts = checkConflicts([...existingClaims, newClaim]);
    if (conflicts.length > 0) {
      console.log(`\n\x1b[33m⚠ Conflicts detected:\x1b[0m`);
      for (const c of conflicts) console.log(`  ${c.severity}: ${c.reason}`);
      console.log('  Use slope session assign --force to override.\n');
      if (!flags.force) { store.close(); process.exit(1); }
    }

    await store.claim({
      sprint_number: sprintNumber,
      player: target.agent_role ?? target.role ?? 'agent',
      target: ticket,
      scope: 'ticket',
      session_id: target.session_id,
    });

    console.log(`\nAssigned ${ticket} to ${target.session_id.slice(0, 12)} (sprint S${sprintNumber})\n`);
  } finally {
    store.close();
  }
}

async function planCommand(flags: Record<string, string>, cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const sessions = await store.getActiveSessions();
    if (sessions.length === 0) { console.log('\nNo active sessions.\n'); return; }

    const firstMeta = sessions.find(s => (s.metadata as Record<string, unknown>)?.sprint)?.metadata as Record<string, unknown> | undefined;
    const sprintNumber = flags.sprint ? Number(flags.sprint) : (firstMeta?.sprint ? Number(firstMeta.sprint) : undefined);
    if (!sprintNumber) { console.log('\nNo sprint context. Use --sprint=N.\n'); return; }

    const claims = await store.list(sprintNumber);

    if (flags.json) {
      console.log(JSON.stringify({ sprint: sprintNumber, assignments: claims, sessions }, null, 2));
      return;
    }

    console.log(`\n=== Sprint S${sprintNumber} — Ticket Assignments ===\n`);
    const byAgent = new Map<string, typeof claims>();
    const unassigned: typeof claims = [];
    for (const c of claims) {
      if (c.session_id) {
        const group = byAgent.get(c.session_id) ?? [];
        group.push(c);
        byAgent.set(c.session_id, group);
      } else {
        unassigned.push(c);
      }
    }

    for (const [sid, agentClaims] of byAgent) {
      const session = sessions.find(s => s.session_id === sid);
      const role = session?.agent_role ?? session?.role ?? 'agent';
      console.log(`  ${sid.slice(0, 12)} (${role}):`);
      for (const c of agentClaims) console.log(`    ${c.scope}: ${c.target}`);
    }
    if (unassigned.length > 0) {
      console.log(`\n  Unassigned:`);
      for (const c of unassigned) console.log(`    ${c.scope}: ${c.target}`);
    }
    console.log('');
  } finally {
    store.close();
  }
}
