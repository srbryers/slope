import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadSprintState } from '../sprint-state.js';
import { loadSessionState, updateSessionState } from '../session-state.js';
import { resolveStore } from '../store.js';

/**
 * Claim-required guard: fires PreToolUse on Edit|Write.
 * Warns (not blocks) when editing code without an active sprint claim.
 * Also detects cross-session claim overlaps for multi-agent coordination.
 * Uses session dedup — warns once per session only.
 */
export async function claimRequiredGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const sessionId = input.session_id;
  if (!sessionId) return {};

  // Session dedup: warn once only
  const sessionState = loadSessionState(cwd);
  if (sessionState.claim_warned_session_id === sessionId) return {};

  // Check if there's an active sprint with claims
  const sprintState = loadSprintState(cwd);
  if (sprintState && sprintState.phase === 'implementing') {
    // Active sprint in implementing phase — check for claims
    try {
      const claimsPath = join(cwd, '.slope', 'claims.json');
      if (existsSync(claimsPath)) {
        const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
        if (Array.isArray(claims) && claims.length > 0) {
          // Has claims — check for cross-session overlaps
          const overlapWarning = await detectCrossSessionOverlap(input, cwd, sprintState.sprint);
          if (overlapWarning) return { context: overlapWarning };
          return {}; // No overlaps
        }
      }
    } catch { /* claims unavailable */ }
  } else if (!sprintState) {
    // No sprint state — adhoc work, no warning needed (#263)
    return {};
  } else {
    // Sprint exists but not in implementing phase — passthrough
    return {};
  }

  // Mark as warned
  updateSessionState(cwd, 'claim_warned_session_id', sessionId);

  return {
    context: 'SLOPE: No active sprint claim. Consider running `slope claim` to track this work.',
  };
}

/**
 * Pure overlap predicate for a single claim. Anchors area-scope prefix matches
 * with a path separator so a claim on "src/core" does NOT match edits in
 * "src/core-helpers". Exported for unit testing.
 */
export function claimOverlapsPath(
  scope: string,
  target: string,
  relativePath: string,
  fileArea: string,
): boolean {
  if (scope !== 'area') return relativePath === target;
  const areaPrefix = target.endsWith('/') ? target : `${target}/`;
  return (
    relativePath === target || relativePath.startsWith(areaPrefix) ||
    fileArea === target || fileArea.startsWith(areaPrefix)
  );
}

/**
 * Detect if the current file edit overlaps with another agent's claimed area.
 * Returns a warning string if overlap found, null otherwise.
 */
async function detectCrossSessionOverlap(
  input: HookInput,
  cwd: string,
  sprintNumber: number,
): Promise<string | null> {
  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return null;

  const relativePath = filePath.startsWith(cwd)
    ? filePath.slice(cwd.length + 1)
    : filePath;
  const fileArea = dirname(relativePath);

  try {
    const store = await resolveStore(cwd);
    const claims = await store.list(sprintNumber);
    const sessions = await store.getActiveSessions();
    store.close();

    // Find claims from OTHER sessions that overlap with this file's area
    const otherClaims = claims.filter(c =>
      c.session_id && c.session_id !== input.session_id,
    );

    for (const claim of otherClaims) {
      const overlaps = claimOverlapsPath(claim.scope, claim.target, relativePath, fileArea);

      if (overlaps) {
        const agent = sessions.find(s => s.session_id === claim.session_id);
        const agentDesc = agent?.agent_role ?? agent?.role ?? 'another agent';
        return `SLOPE multi-agent: ${relativePath} overlaps with ${agentDesc}'s claim on "${claim.target}". Coordinate to avoid conflicts.`;
      }
    }
  } catch { /* store unavailable — skip overlap check */ }

  return null;
}
