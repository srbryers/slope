import { checkConflicts } from '../../core/index.js';
import type { SprintClaim, SlopeSession } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { resolveStore } from '../store.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function resolveSprint(flags: Record<string, string>, cwd: string): number {
  if (flags.sprint) return parseInt(flags.sprint, 10);
  const config = loadConfig(cwd);
  if (config.currentSprint) return config.currentSprint;
  const scorecards = loadScorecards(config, cwd);
  if (scorecards.length === 0) return 1;
  const maxSprint = Math.max(...scorecards.map(s => s.sprint_number));
  return maxSprint + 1;
}

export async function statusCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();
  const store = await resolveStore(cwd);

  try {
    const swarmId = flags.swarm;

    if (swarmId) {
      await showSwarmStatus(store, swarmId);
    } else {
      const sprintNumber = resolveSprint(flags, cwd);
      await showSprintStatus(store, sprintNumber);
    }
  } finally {
    store.close();
  }
}

async function showSprintStatus(store: { list: (n: number) => Promise<SprintClaim[]>; close: () => void }, sprintNumber: number): Promise<void> {
  const claims = await store.list(sprintNumber);

  console.log(`\nSprint ${sprintNumber} — Course Status`);
  console.log('═'.repeat(40));

  if (claims.length === 0) {
    console.log('\n  No claims registered.\n');
    return;
  }

  // Group by player
  const byPlayer = new Map<string, SprintClaim[]>();
  for (const claim of claims) {
    const list = byPlayer.get(claim.player) || [];
    list.push(claim);
    byPlayer.set(claim.player, list);
  }

  for (const [player, playerClaims] of byPlayer) {
    console.log(`\n  ${player}:`);
    for (const c of playerClaims) {
      const scopeTag = c.scope === 'area' ? '[area]' : '[ticket]';
      const notes = c.notes ? ` — ${c.notes}` : '';
      console.log(`    ${scopeTag} ${c.target}${notes}  (${c.id})`);
    }
  }

  // Check conflicts
  const conflicts = checkConflicts(claims);
  if (conflicts.length > 0) {
    console.log(`\n  Conflicts (${conflicts.length}):`);
    for (const c of conflicts) {
      const icon = c.severity === 'overlap' ? '!!' : '~';
      console.log(`    [${icon}] ${c.reason} (${c.severity})`);
    }
  }

  console.log('');
}

async function showSwarmStatus(
  store: {
    getSessionsBySwarm: (id: string) => Promise<SlopeSession[]>;
    getActiveClaims: (n?: number) => Promise<SprintClaim[]>;
    getEventsBySession: (id: string) => Promise<{ type: string }[]>;
    close: () => void;
  },
  swarmId: string,
): Promise<void> {
  const sessions = await store.getSessionsBySwarm(swarmId);

  console.log(`\nSwarm "${swarmId}" — Overview`);
  console.log('═'.repeat(40));

  if (sessions.length === 0) {
    console.log('\n  No agents in this swarm.\n');
    return;
  }

  const allClaims = await store.getActiveClaims();
  const swarmSessionIds = new Set(sessions.map(s => s.session_id));
  const swarmClaims = allClaims.filter(c => c.session_id && swarmSessionIds.has(c.session_id));

  // Summary
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000;
  const activeAgents = sessions.filter(s =>
    now - new Date(s.last_heartbeat_at).getTime() <= staleThreshold,
  );
  const staleAgents = sessions.filter(s =>
    now - new Date(s.last_heartbeat_at).getTime() > staleThreshold,
  );

  console.log(`\n  Agents: ${activeAgents.length} active, ${staleAgents.length} stale`);
  console.log(`  Claims: ${swarmClaims.length} active`);
  console.log(`  Tickets in progress: ${swarmClaims.filter(c => c.scope === 'ticket').length}`);

  // Per-agent breakdown
  console.log('');
  for (const s of sessions) {
    const agentClaims = swarmClaims.filter(c => c.session_id === s.session_id);
    const isStale = now - new Date(s.last_heartbeat_at).getTime() > staleThreshold;
    const statusTag = isStale ? ' [STALE]' : '';
    const roleTag = s.agent_role ? ` (${s.agent_role})` : '';

    console.log(`  ${s.session_id}${roleTag}${statusTag}`);
    console.log(`    IDE: ${s.ide}  Branch: ${s.branch ?? '-'}`);
    if (agentClaims.length > 0) {
      for (const c of agentClaims) {
        console.log(`    → ${c.target} (${c.scope})`);
      }
    } else {
      console.log('    → no active claims');
    }
  }

  // Swarm conflicts
  if (swarmClaims.length > 1) {
    const conflicts = checkConflicts(swarmClaims);
    if (conflicts.length > 0) {
      console.log(`\n  Conflicts (${conflicts.length}):`);
      for (const c of conflicts) {
        const icon = c.severity === 'overlap' ? '!!' : '~';
        console.log(`    [${icon}] ${c.reason}`);
      }
    }
  }

  // Recent blockers from standups
  let hasBlockers = false;
  for (const s of sessions) {
    const events = await store.getEventsBySession(s.session_id);
    const standups = events.filter(e => e.type === 'standup');
    if (standups.length > 0) {
      const latest = standups[standups.length - 1] as { data?: Record<string, unknown> };
      const blockers = (latest.data?.blockers as string[]) ?? [];
      if (blockers.length > 0) {
        if (!hasBlockers) {
          console.log('\n  Active blockers:');
          hasBlockers = true;
        }
        const roleTag = s.agent_role ? ` (${s.agent_role})` : '';
        for (const b of blockers) {
          console.log(`    ${s.session_id}${roleTag}: ${b}`);
        }
      }
    }
  }

  console.log('');
}
