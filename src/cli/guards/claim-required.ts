import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadSprintState } from '../sprint-state.js';
import { loadSessionState, updateSessionState } from '../session-state.js';

/**
 * Claim-required guard: fires PreToolUse on Edit|Write.
 * Warns (not blocks) when editing code without an active sprint claim.
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
          return {}; // Has active claims — passthrough
        }
      }
    } catch { /* claims unavailable */ }
  } else if (!sprintState) {
    // No sprint state at all — warn
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
