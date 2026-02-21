import { randomUUID } from 'node:crypto';
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
      await listSessions(cwd);
      break;
    default:
      console.log(`
slope session — Manage live agent/IDE sessions

Usage:
  slope session start [--role=primary] [--ide=claude-code] [--branch=<b>]
  slope session end [--session-id=<id>]
  slope session heartbeat [--session-id=<id>]
  slope session list
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

    const session = await store.registerSession({
      session_id: sessionId,
      role,
      ide,
      ...(branch ? { branch } : {}),
      ...(worktreePath ? { worktree_path: worktreePath } : {}),
    });

    console.log(`\nSession started:`);
    console.log(`  ID:   ${session.session_id}`);
    console.log(`  Role: ${session.role}`);
    console.log(`  IDE:  ${session.ide}`);
    if (session.branch) console.log(`  Branch: ${session.branch}`);
    console.log(`  Started: ${session.started_at}`);

    // Show other active sessions
    const active = await store.getActiveSessions();
    const others = active.filter(s => s.session_id !== session.session_id);
    if (others.length > 0) {
      console.log(`\n  Other active sessions (${others.length}):`);
      for (const s of others) {
        console.log(`    ${s.session_id} [${s.role}] ${s.ide} — ${s.branch ?? 'no branch'}`);
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

async function listSessions(cwd: string): Promise<void> {
  const store = await resolveStore(cwd);
  try {
    const sessions = await store.getActiveSessions();
    if (sessions.length === 0) {
      console.log('\nNo active sessions.\n');
      return;
    }

    console.log(`\nActive sessions (${sessions.length}):\n`);
    for (const s of sessions) {
      const claims = await store.getActiveClaims();
      const sessionClaims = claims.filter(c => c.session_id === s.session_id);
      console.log(`  ${s.session_id}`);
      console.log(`    Role: ${s.role}  IDE: ${s.ide}  Branch: ${s.branch ?? '-'}`);
      console.log(`    Started: ${s.started_at}  Heartbeat: ${s.last_heartbeat_at}`);
      console.log(`    Claims: ${sessionClaims.length}`);
      for (const c of sessionClaims) {
        console.log(`      ${c.target} (${c.scope}) — sprint ${c.sprint_number}`);
      }
    }
    console.log('');
  } finally {
    store.close();
  }
}
