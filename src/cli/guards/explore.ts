import { existsSync, readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadSessionState, updateSessionState } from '../session-state.js';

const DEFAULT_INDEX_PATHS = ['CODEBASE.md', '.slope/index.json', 'docs/architecture.md'];
const DEFAULT_STALE_WARN_AT = 11;
const DEFAULT_STALE_BLOCK_AT = 31;

/**
 * Explore guard: fires on Read|Glob|Grep|Edit|Write (PreToolUse).
 * Suggests checking codebase map before deep exploration.
 * Includes tiered staleness awareness when CODEBASE.md has YAML frontmatter:
 *   0–10 commits stale  → no warning (within tolerance)
 *   11–30 commits stale → warning with commit count
 *   31+ commits stale   → block Edit/Write (don't block Read/Glob/Grep)
 */
export async function exploreGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Post-compaction handoff injection: on first tool call, check for handoff files
  const handoffContext = readHandoffIfAvailable(input, cwd);

  const config = loadConfig(cwd);
  const indexPaths = config.guidance?.indexPaths ?? DEFAULT_INDEX_PATHS;

  // Find which index files exist
  const found: string[] = [];
  for (const p of indexPaths) {
    const full = join(cwd, p);
    if (existsSync(full)) {
      found.push(p);
    }
  }

  if (found.length === 0) {
    // No index — still inject handoff if available
    return handoffContext ? { context: handoffContext } : {};
  }

  // Check if CODEBASE.md exists and assess staleness
  const mapPath = join(cwd, 'CODEBASE.md');
  if (existsSync(mapPath)) {
    const staleness = checkMapStaleness(mapPath, cwd, config);

    if (staleness.level === 'block') {
      // Only block Edit/Write — let Read/Glob/Grep through with a warning
      const toolName = input.tool_name ?? '';
      const isWriteTool = /^(Edit|Write)$/i.test(toolName);
      if (isWriteTool) {
        return {
          decision: 'deny',
          blockReason: prependHandoff(handoffContext, `SLOPE: Codebase map is ${staleness.distance} commits stale. Run \`slope map\` to refresh before editing.`),
        };
      }
      // Read/Glob/Grep — warn but don't block
      return {
        context: prependHandoff(handoffContext, `SLOPE: Codebase map is ${staleness.distance} commits stale. Run \`slope map\` to refresh.`),
      };
    }

    if (staleness.level === 'warn') {
      return {
        context: prependHandoff(handoffContext, `SLOPE: Codebase map at CODEBASE.md is ${staleness.distance} commits stale. Run 'slope map' to refresh, or explore if needed.`),
      };
    }

    // Current map — estimate token size
    const content = readFileSync(mapPath, 'utf8');
    const approxTokens = Math.round(content.length / 4 / 1000);

    return {
      context: prependHandoff(handoffContext, `SLOPE: Codebase map at CODEBASE.md (~${approxTokens}k tokens, L1). Try \`context_search\` (L1.5) before reading full files (L2).`),
    };
  }

  // Fallback: other index files found but no CODEBASE.md
  return {
    context: prependHandoff(handoffContext, `SLOPE: Codebase index available at: ${found.join(', ')} — check before deep exploration.`),
  };
}

/** Prepend handoff context if available. */
function prependHandoff(handoff: string | null, context: string): string {
  return handoff ? `${handoff}\n\n${context}` : context;
}

/**
 * Read the most recent handoff file from .slope/handoffs/ if this is the
 * first file-read of the session (post-compaction recovery).
 * Returns formatted context string or null. One-shot: deletes after reading.
 */
function readHandoffIfAvailable(input: HookInput, cwd: string): string | null {
  const sessionId = input.session_id;
  if (!sessionId) return null;

  // Dedup: only check once per session
  const sessionState = loadSessionState(cwd);
  if (sessionState.handoff_read_session_id === sessionId) return null;

  const config = loadConfig(cwd);
  const handoffsDir = join(cwd, config.guidance?.handoffsDir ?? '.slope/handoffs');
  if (!existsSync(handoffsDir)) return null;

  try {
    const files = readdirSync(handoffsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, mtime: statSync(join(handoffsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    // Only use handoffs less than 1 hour old
    const latest = files[0];
    const ageMs = Date.now() - latest.mtime;
    if (ageMs > 3600 * 1000) return null;

    const handoff = JSON.parse(readFileSync(join(handoffsDir, latest.name), 'utf8'));

    // Mark as read (one-shot)
    updateSessionState(cwd, 'handoff_read_session_id', sessionId);

    // Delete handoff file after reading
    try { unlinkSync(join(handoffsDir, latest.name)); } catch { /* best-effort */ }

    // Clean up old handoff files (>24h)
    for (const f of files.slice(1)) {
      if (Date.now() - f.mtime > 24 * 3600 * 1000) {
        try { unlinkSync(join(handoffsDir, f.name)); } catch { /* best-effort */ }
      }
    }

    // Format handoff as context
    const lines: string[] = ['SLOPE session handoff (post-compaction recovery):'];
    if (handoff.git) {
      lines.push(`  Branch: ${handoff.git.branch}, ${handoff.git.uncommitted} uncommitted, ${handoff.git.unpushed} unpushed`);
    }
    if (handoff.sprint_phase) {
      lines.push(`  Sprint phase: ${handoff.sprint_phase}`);
    }
    if (handoff.claims?.length) {
      const targets = handoff.claims.map((c: { target?: string }) => c.target ?? 'unknown').join(', ');
      lines.push(`  Active claims: ${targets}`);
    }
    if (handoff.review) {
      lines.push(`  Review: ${handoff.review.tier} (${handoff.review.rounds_completed}/${handoff.review.rounds_required} rounds)`);
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

interface StalenessResult {
  level: 'current' | 'warn' | 'block';
  distance: number;
}

function checkMapStaleness(
  mapPath: string,
  cwd: string,
  config?: { guidance?: { mapStaleWarnAt?: number; mapStaleBlockAt?: number } },
): StalenessResult {
  const warnAt = config?.guidance?.mapStaleWarnAt ?? DEFAULT_STALE_WARN_AT;
  const blockAt = config?.guidance?.mapStaleBlockAt ?? DEFAULT_STALE_BLOCK_AT;

  try {
    const content = readFileSync(mapPath, 'utf8');
    const metaMatch = content.match(/^---\n([\s\S]*?)\n---/m);
    if (!metaMatch) return { level: 'current', distance: 0 }; // No metadata — can't check

    const gitShaMatch = metaMatch[1].match(/git_sha:\s*"?([^"\n]+)"?/);
    if (!gitShaMatch) return { level: 'current', distance: 0 };

    const distance = parseInt(
      execSync(`git rev-list --count ${gitShaMatch[1]}..HEAD 2>/dev/null`, { cwd, encoding: 'utf8', timeout: 5000 }).trim() || '0',
      10,
    );

    if (distance >= blockAt) return { level: 'block', distance };
    if (distance >= warnAt) return { level: 'warn', distance };
    return { level: 'current', distance };
  } catch {
    return { level: 'current', distance: 0 }; // Can't determine — assume current
  }
}
