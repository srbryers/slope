import { checkConflicts, findShippedSprintsOnMain, formatSprintLabel, parseRoadmap, parseSprintNumber } from '../../core/index.js';
import type { SprintClaim, SlopeSession } from '../../core/index.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { resolveStore } from '../store.js';
import { findStaleWorkflowExecutions, sprintLabelForExecution } from '../workflow-resync.js';
import type { SlopeStore } from '../../core/index.js';

/** Surface dangling workflow executions that would gate a fresh session's
 *  edits, with the command that clears them. Advisory only. (#621) */
async function showDanglingExecutions(cwd: string, store: unknown): Promise<void> {
  const candidate = store as Partial<Pick<SlopeStore, 'listExecutions' | 'getActiveSessions'>>;
  if (typeof candidate.listExecutions !== 'function') return;
  try {
    const stale = await findStaleWorkflowExecutions(
      cwd,
      candidate as Pick<SlopeStore, 'listExecutions'> & Partial<Pick<SlopeStore, 'getActiveSessions'>>,
    );
    if (stale.length === 0) return;
    console.log(`  Dangling workflow executions (${stale.length}) — these can gate file edits:`);
    for (const { exec, reason } of stale) {
      console.log(`    ${sprintLabelForExecution(exec)} (${exec.workflow_name}) — ${reason}`);
    }
    console.log('  Clear with: slope sprint workflow cleanup --stale');
    console.log('');
  } catch {
    // Diagnostics must never break status output.
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function resolveSprint(flags: Record<string, string>, cwd: string): number | null {
  if (flags.sprint) return parseSprintNumber(flags.sprint);
  const config = loadConfig(cwd);
  return inferSprintContext(cwd, config).sprint;
}

export async function statusCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const cwd = process.cwd();
  const swarmId = flags.swarm;

  if (!swarmId) {
    const sprintNumber = resolveSprint(flags, cwd);
    if (!sprintNumber) {
      console.error('Error: --sprint must be a positive sprint id, e.g. 114 or 114.5');
      process.exit(1);
    }

    const store = await resolveStore(cwd);
    try {
      await showSprintStatus(store, sprintNumber);
      await showDanglingExecutions(cwd, store);
    } finally {
      store.close();
    }
    return;
  }

  const store = await resolveStore(cwd);
  try {
    await showSwarmStatus(store, swarmId);
  } finally {
    store.close();
  }
}

async function showSprintStatus(store: { list: (n: number) => Promise<SprintClaim[]>; close: () => void }, sprintNumber: number): Promise<void> {
  const claims = await store.list(sprintNumber);

  console.log(`\n${formatSprintLabel(sprintNumber)} — Course Status`);
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

  // Surface scorecard drift — shipped sprints with no scorecard on disk.
  // Helps remind users to run `slope retro backfill` when post-hole work
  // has been skipped (#318).
  const drift = computeScorecardDrift(process.cwd());
  if (drift.missing.length > 0) {
    console.log(`\n  Scorecard drift: ${drift.missing.length} shipped sprint(s) without scorecards`);
    const sample = drift.missing.slice(0, 5).map(n => `S${n}`).join(', ');
    const more = drift.missing.length > 5 ? `, ...` : '';
    console.log(`    Missing: ${sample}${more}`);
    console.log(`    Backfill: slope retro backfill --all-missing`);
  }

  console.log('');
}

/** Detect shipped sprints with no scorecard on disk. Used by status to
 *  surface the "post-hole skipped" pattern (#318). */
export function computeScorecardDrift(cwd: string): { missing: number[] } {
  try {
    const config = loadConfig(cwd);
    const retroDir = join(cwd, config.scorecardDir);
    const pattern = config.scorecardPattern;
    const shipped = findShippedSprintsOnMain(cwd);
    const roadmapIds = loadRoadmapSprintIds(cwd, config.roadmapPath);
    const missing: number[] = [];
    for (const id of [...shipped].sort((a, b) => a - b)) {
      if (roadmapIds && !roadmapIds.has(id)) continue;
      const scorecardPath = join(retroDir, pattern.replaceAll('*', String(id)));
      if (!existsSync(scorecardPath)) missing.push(id);
    }
    return { missing };
  } catch {
    return { missing: [] };
  }
}

function loadRoadmapSprintIds(cwd: string, roadmapPath: string): Set<number> | null {
  try {
    const path = join(cwd, roadmapPath);
    if (!existsSync(path)) return null;
    const parsed = parseRoadmap(JSON.parse(readFileSync(path, 'utf8')));
    const roadmap = parsed.roadmap;
    if (!roadmap) return null;
    return new Set(roadmap.sprints.map(s => s.id));
  } catch {
    return null;
  }
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
