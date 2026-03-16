import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { loadSprintState } from '../sprint-state.js';
import { loadSessionState, updateSessionState } from '../session-state.js';

/**
 * Post-push guard: fires PostToolUse on Bash.
 * After a successful git push, suggests next workflow step.
 * Context-only (non-blocking), fires once per session.
 */
export async function postPushGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';

  // Only fire after git push commands
  if (!/git\s+push\b/.test(command)) return {};

  // Check exit code — only fire on success
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0' && exitCode !== undefined) return {};

  // Session dedup: fire once per session
  const sessionId = input.session_id;
  if (!sessionId) return {};

  const sessionState = loadSessionState(cwd);
  if (sessionState.push_prompted_session_id === sessionId) return {};

  // Mark as prompted
  updateSessionState(cwd, 'push_prompted_session_id', sessionId);

  // Determine workflow context
  const sprintState = loadSprintState(cwd);

  let contextText: string;
  let options: Suggestion['options'] = [];

  if (sprintState && sprintState.phase === 'implementing') {
    // Check how many claims remain
    let remainingClaims = 0;
    try {
      const claimsPath = join(cwd, '.slope', 'claims.json');
      if (existsSync(claimsPath)) {
        const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
        if (Array.isArray(claims)) remainingClaims = claims.length;
      }
    } catch { /* claims unavailable */ }

    // Check pending gates
    const pendingGateCount = Object.values(sprintState.gates).filter(v => !v).length;

    if (pendingGateCount === 0) {
      contextText = `Sprint S${sprintState.sprint} — all gates complete. Ready for PR.`;
      options = [
        { id: 'create-pr', label: 'Create PR', command: 'gh pr create' },
        { id: 'continue', label: 'Continue working' },
      ];
    } else if (remainingClaims > 0) {
      contextText = `Sprint S${sprintState.sprint} — ${remainingClaims} claim(s) active, ${pendingGateCount} gate(s) pending.`;
      options = [
        { id: 'next-ticket', label: 'Continue with next ticket' },
        { id: 'run-tests', label: 'Run tests', command: 'bun test' },
      ];
    } else {
      contextText = `Sprint S${sprintState.sprint} — all tickets done. Scoring workflow: auto-card, validate, review, PR.`;
      options = [
        { id: 'auto-card', label: 'Generate scorecard', command: 'slope auto-card' },
        { id: 'validate', label: 'Validate scorecard', command: 'slope validate' },
        { id: 'review', label: 'Generate review', command: 'slope review' },
      ];
    }
  } else if (sprintState && sprintState.phase === 'scoring') {
    contextText = `Sprint S${sprintState.sprint} — scoring phase. Complete remaining gates.`;
    const pending = Object.entries(sprintState.gates)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    options = pending.map(g => ({
      id: `gate-${g}`,
      label: `Complete ${g}`,
      command: g === 'scorecard' ? 'slope validate' : g === 'review_md' ? 'slope review' : `slope sprint gate ${g}`,
    }));
  } else {
    contextText = 'No active sprint. Run `slope briefing` or start a new sprint.';
    options = [
      { id: 'briefing', label: 'Run briefing', command: 'slope briefing' },
      { id: 'start-sprint', label: 'Start new sprint' },
    ];
  }

  const suggestion: Suggestion = {
    id: 'post-push',
    title: 'Post-Push',
    context: contextText,
    options,
    requiresDecision: false,
    priority: 'normal',
  };

  return { suggestion };
}
