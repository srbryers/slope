import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { resolveStore } from '../store.js';

interface HandoffData {
  session_id: string;
  timestamp: string;
  git?: {
    branch: string;
    uncommitted: number;
    unpushed: number;
    recent_commits: string[];
  };
  sprint?: {
    number?: number;
  };
  claims?: Array<{ target: string; scope: string; player: string }>;
}

/**
 * Compaction handoff guard: fires on PreCompact.
 * Saves structured handoff (git state, sprint context, claims) before
 * context compaction so the session can be resumed with full context.
 */
export async function compactionGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const sessionId = input.session_id;
  if (!sessionId) return {};

  const config = loadConfig();
  const handoffsDir = join(cwd, config.guidance?.handoffsDir ?? '.slope/handoffs');

  const handoff: HandoffData = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
  };

  // Gather git state
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8' }).trim();

    const statusOut = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    const uncommitted = statusOut ? statusOut.split('\n').filter(Boolean).length : 0;

    let unpushed = 0;
    try {
      const unpushedOut = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
      unpushed = unpushedOut ? unpushedOut.split('\n').filter(Boolean).length : 0;
    } catch { /* no upstream */ }

    const logOut = execSync('git log -5 --oneline 2>/dev/null', { cwd, encoding: 'utf8' }).trim();
    const recentCommits = logOut ? logOut.split('\n').filter(Boolean) : [];

    handoff.git = { branch, uncommitted, unpushed, recent_commits: recentCommits };
  } catch { /* not a git repo */ }

  // Gather sprint context
  try {
    handoff.sprint = { number: config.currentSprint };
  } catch { /* skip */ }

  // Gather active claims from store
  try {
    const store = await resolveStore(cwd);
    const claims = await store.getActiveClaims();
    if (claims.length > 0) {
      handoff.claims = claims.map(c => ({ target: c.target, scope: c.scope, player: c.player }));
    }
    store.close();
  } catch { /* store not available */ }

  // Write handoff file (primary output)
  try {
    if (!existsSync(handoffsDir)) {
      mkdirSync(handoffsDir, { recursive: true });
    }
    const prefix = sessionId.slice(0, 8);
    const handoffPath = join(handoffsDir, `${prefix}.json`);
    writeFileSync(handoffPath, JSON.stringify(handoff, null, 2) + '\n');
  } catch { /* fs write failed */ }

  // Record compaction event in store (secondary/best-effort)
  try {
    const store = await resolveStore(cwd);
    await store.insertEvent({
      session_id: sessionId,
      type: 'compaction',
      data: {
        trigger: 'pre_compact',
        description: 'Context compaction with handoff',
        handoff_path: join(handoffsDir, `${sessionId.slice(0, 8)}.json`),
      },
    });
    store.close();
  } catch { /* store not available — handoff file is the primary record */ }

  return {};
}
