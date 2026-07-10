import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { loadConfig, parseRoadmap, castRoadmapStructure, formatStrategicContext } from '../../core/index.js';
import { inferSprintContext } from '../sprint-inference.js';
import {
  isActiveSprintState,
  isReviewGateName,
  isReviewGateSatisfied,
  loadSprintState,
  type SprintState,
} from '../sprint-state.js';
import { loadSessionState, updateSessionState, setSessionMode, syncSessionModeWithSprintState } from '../session-state.js';

/**
 * Session-briefing guard: fires PostToolUse on all tools.
 * Injects sprint context on the very first tool call of a session.
 * Non-blocking (context-only) to avoid suggestion fatigue.
 */
export async function sessionBriefingGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const sessionId = input.session_id;
  if (!sessionId) return {};

  // Dedup: only fire once per session
  const sessionState = loadSessionState(cwd);
  if (sessionState.briefing_session_id === sessionId) {
    syncSessionModeWithSprintState(cwd, sessionId);
    return {};
  }

  // Mark as briefed (atomic write)
  updateSessionState(cwd, 'briefing_session_id', sessionId);

  // Gather context
  const config = loadConfig(cwd);
  const sprintState = loadSprintState(cwd);
  const lines: string[] = [];

  // Sprint state + session mode
  const hasActiveSprint = isActiveSprintState(sprintState) && (sprintState.phase === 'implementing' || sprintState.phase === 'scoring');
  const isPlanning = sprintState && sprintState.phase === 'planning';
  if (hasActiveSprint) {
    setSessionMode(cwd, sessionId, 'sprint');
    const gateStatus = Object.entries(sprintState.gates)
      .map(([name, done]) => formatBriefingGateStatus(sprintState, name, done))
      .join('  ');
    lines.push(`Sprint: S${sprintState.sprint}  Phase: ${sprintState.phase}  Gates: ${gateStatus}`);

    // Nudge if no workflow execution is active
    try {
      const { SqliteSlopeStore } = await import('../../store/index.js');
      const storePath = join(cwd, '.slope/slope.db');
      if (existsSync(storePath)) {
        const store = new SqliteSlopeStore(storePath);
        const executions = await store.listExecutions({ status: 'running' });
        store.close();
        if (executions.length === 0) {
          lines.push('No workflow execution active. Consider: slope sprint run --workflow=sprint-standard --var sprint_id=S' + sprintState.sprint);
        }
      }
    } catch { /* store unavailable */ }
  } else if (isPlanning) {
    setSessionMode(cwd, sessionId, 'sprint');
    lines.push(`Sprint: S${sprintState!.sprint}  Phase: planning`);
    lines.push('Start with: slope sprint run --workflow=sprint-standard --var sprint_id=S' + sprintState!.sprint);
    lines.push('Then enter plan mode to write the sprint plan — review guards require plan mode to fire.');
  } else {
    setSessionMode(cwd, sessionId, 'adhoc');
    lines.push('No active sprint. Session mode: adhoc (sprint-workflow guards silenced).');
  }

  // Roadmap context (next sprint)
  try {
    if (config.roadmapPath) {
      const roadmapFile = join(cwd, config.roadmapPath);
      if (existsSync(roadmapFile)) {
        const raw = JSON.parse(readFileSync(roadmapFile, 'utf8'));
        const parsed = parseRoadmap(raw);
        const roadmap = parsed.roadmap ?? castRoadmapStructure(raw);
        if (roadmap) {
          const inferred = inferSprintContext(cwd, config);
          const ctx = inferred.source === 'initial'
            ? null
            : formatStrategicContext(roadmap, inferred.sprint);
          if (ctx) lines.push(ctx);
        }
      }
    }
  } catch { /* roadmap unavailable */ }

  // Active claims
  try {
    const claimsPath = join(cwd, '.slope', 'claims.json');
    if (existsSync(claimsPath)) {
      const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
      if (Array.isArray(claims) && claims.length > 0) {
        const targets = claims.map((c: { target?: string }) => c.target ?? 'unknown').join(', ');
        lines.push(`Active claims: ${targets}`);
      }
    }
  } catch { /* claims unavailable */ }

  // Phase cleanup status
  try {
    const cleanupPath = join(cwd, '.slope', 'phase-cleanup.json');
    if (existsSync(cleanupPath)) {
      const cleanup = JSON.parse(readFileSync(cleanupPath, 'utf8'));
      if (cleanup.phases) {
        const phases = Object.keys(cleanup.phases).sort();
        if (phases.length > 0) {
          const latest = phases[phases.length - 1];
          const gates = cleanup.phases[latest];
          if (gates.completed_at) {
            lines.push(`Phase ${latest} cleanup: COMPLETE`);
          } else {
            const pending = Object.entries(gates)
              .filter(([k, v]) => k !== 'completed_at' && !v)
              .map(([k]) => k);
            lines.push(`Phase ${latest} cleanup: ${pending.length} gate(s) pending`);
          }
        }
      }
    }
  } catch { /* cleanup state unavailable */ }

  // Mention slope status for discoverability
  lines.push('Run `slope status` for full dashboard.');

  const suggestion: Suggestion = {
    id: 'session-briefing',
    title: 'Session Briefing',
    context: lines.join('\n'),
    options: [],
    requiresDecision: false,
    priority: 'normal',
  };

  return { suggestion };
}

function formatBriefingGateStatus(state: SprintState, name: string, done: boolean): string {
  if (!isReviewGateName(name)) {
    return `${done ? '[x]' : '[ ]'} ${name}`;
  }

  const satisfied = isReviewGateSatisfied(state, name);
  const marker = satisfied
    ? state.review_gates[name].provenance === 'independent_review_waived' ? '[~]' : '[x]'
    : done ? '[!]' : '[ ]';
  const review = state.review_gates[name];
  let label = 'pending';
  if (satisfied) {
    label = review.provenance === 'self_review' || review.provenance === 'manual_override'
      ? `${review.provenance}(weaker)`
      : review.provenance === 'independent_review_waived'
        ? 'independent_review_waived(required_downgrade)'
      : review.provenance;
  } else if (done) {
    label = 'review_evidence_missing';
  }

  return `${marker} ${name}:${label}`;
}
