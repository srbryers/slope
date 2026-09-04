import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, SprintId, Suggestion } from '../../core/index.js';
import {
  loadConfig,
  parseRoadmap,
  roadmapSprintKeyFromId,
  findRoadmapSprint,
  readCompletedTicketKeys,
} from '../../core/index.js';
import { loadSprintState } from '../sprint-state.js';
import { loadSessionState, updateSessionState } from '../session-state.js';
import { extractPhaseNumber, isPhaseComplete, pendingPhaseGates, regressionCommand } from '../phase-cleanup.js';
import { resolveStore } from '../store.js';

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

  // Dedup: fire once per push (track push count, not session boolean)
  const sessionId = input.session_id;
  if (!sessionId) return {};

  const sessionState = loadSessionState(cwd);
  const pushCount = parseInt(sessionState.push_count ?? '0', 10) || 0;
  const lastPushCmd = sessionState.last_push_command as string | undefined;

  // Skip if this is the same push command repeated (e.g., retry)
  if (lastPushCmd === command) return {};

  // Track the push
  updateSessionState(cwd, 'push_count', String(pushCount + 1));
  updateSessionState(cwd, 'last_push_command', command);

  // Determine workflow context
  const sprintState = loadSprintState(cwd);

  let contextText: string;
  let options: Suggestion['options'] = [];

  if (sprintState && sprintState.phase === 'implementing') {
    // Check how many claims remain
    const remainingClaims = await countSprintClaims(cwd, sprintState.sprint);
    const completedTickets = await countRecordedCompletions(cwd, sprintState.sprint);

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
        // Derived from the lockfile. This is an actual command field, not a
        // label, so hardcoding `bun test` handed a pnpm project a command it
        // could not run (#696).
        { id: 'run-tests', label: 'Run tests', command: regressionCommand(cwd) },
      ];
    } else {
      // "No claims" is not "all tickets done". It is also the state of a
      // ticket nobody ever claimed, and the state `slope ticket done` leaves
      // behind on success. Inferring completion from claims is the #697
      // mistake, so read the ledger and say which it is.
      // The options are the actionable half, so they follow the ledger too.
      // Offering the closeout workflow on a sprint with unfinished tickets is
      // the same wrong answer as the old "all tickets done" text.
      const allDone = completedTickets !== null
        && completedTickets.recorded === completedTickets.total;
      if (allDone) {
        contextText = `Sprint S${sprintState.sprint} — all ${completedTickets.total} tickets recorded done. Scoring workflow: auto-card, validate, review, PR.`;
        options = [
          { id: 'auto-card', label: 'Generate scorecard', command: 'slope auto-card' },
          { id: 'validate', label: 'Validate scorecard', command: 'slope validate' },
          { id: 'review', label: 'Generate review', command: `slope review --sprint=${sprintState.sprint}` },
        ];
      } else {
        contextText = completedTickets === null
          ? `Sprint S${sprintState.sprint} — no active claims, ${pendingGateCount} gate(s) pending.`
          : `Sprint S${sprintState.sprint} — ${completedTickets.recorded}/${completedTickets.total} tickets recorded done, none claimed.`;
        options = [
          { id: 'next-ticket', label: 'Claim the next ticket', command: 'slope now' },
          { id: 'run-tests', label: 'Run tests', command: regressionCommand(cwd) },
        ];
      }
    }
  } else if (sprintState && sprintState.phase === 'scoring') {
    contextText = `Sprint S${sprintState.sprint} — scoring phase. Complete remaining gates.`;
    const pending = Object.entries(sprintState.gates)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    options = pending.map(g => ({
      id: `gate-${g}`,
      label: `Complete ${g}`,
      command: g === 'scorecard'
        ? 'slope validate'
        : g === 'review_md'
          ? `slope review --sprint=${sprintState.sprint}`
          : (g === 'code_review' || g === 'architect_review')
              ? `slope sprint gate ${g} --reviewer=<id> --evidence=<path-or-url>`
              : `slope sprint gate ${g}`,
    }));
  } else {
    contextText = 'No active sprint. Run `slope briefing` or start a new sprint.';
    options = [
      { id: 'briefing', label: 'Run briefing', command: 'slope briefing' },
      { id: 'start-sprint', label: 'Start new sprint' },
    ];
  }

  // Auto-detect phase completion (#250)
  if (sprintState) {
    try {
      const config = loadConfig(cwd);
      const roadmapPath = join(cwd, config.roadmapPath);
      if (existsSync(roadmapPath)) {
        const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
        const { roadmap } = parseRoadmap(raw);
        if (roadmap?.phases) {
          const currentKey = roadmapSprintKeyFromId(roadmap, sprintState.sprint);
          for (let i = 0; i < roadmap.phases.length; i++) {
            const phase = roadmap.phases[i];
            const phaseKeys = (phase.sprint_keys ?? phase.sprints.map(String))
              .map(id => roadmapSprintKeyFromId(roadmap, id))
              .filter((id): id is string => id !== null);
            if (currentKey !== null && phaseKeys.includes(currentKey)) {
              // Current sprint is in this phase — check if all sprints in phase have scorecards
              const allDone = phaseKeys.every(sn =>
                existsSync(join(cwd, config.scorecardDir, `sprint-${sn}.json`)),
              );
              // Shared with the phase-boundary guard and the gate writers.
              // This was a third inline copy of the same regex.
              const phaseNum = extractPhaseNumber(phase.name, i);
              if (allDone && !isPhaseComplete(cwd, phaseNum)) {
                contextText += `\n\nPhase ${phaseNum} (${phase.name}) is now complete — run phase boundary cleanup before starting the next phase.`;
                // Name the gates, not the override. Offering `phase complete`
                // as the cleanup step is what taught people the override is
                // the normal path (#696).
                const pending = pendingPhaseGates(cwd, phaseNum);
                for (const [i2, gate] of pending.entries()) {
                  options.push({ id: `phase-gate-${i2}`, label: gate });
                }
                options.push({
                  id: 'phase-override',
                  label: `Phase ${phaseNum} cleanup (manual override — records every gate without checking)`,
                  command: `slope phase complete ${phaseNum}`,
                });
              }
              break;
            }
          }
        }
      }
    } catch { /* roadmap unavailable — skip phase check */ }
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

/**
 * Recorded completions against the sprint's roadmap ticket count, or null when
 * either is unavailable.
 *
 * Null is the honest answer for "cannot tell". Returning 0/0 would let the
 * caller print "all tickets recorded done" for a sprint whose ledger simply
 * could not be read.
 */
async function countRecordedCompletions(
  cwd: string,
  sprintNumber: SprintId,
): Promise<{ recorded: number; total: number } | null> {
  let total: number;
  let ticketKeys: string[];
  try {
    const config = loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return null;
    const roadmap = parseRoadmap(JSON.parse(readFileSync(roadmapPath, 'utf8'))).roadmap;
    if (!roadmap) return null;
    const sprint = findRoadmapSprint(roadmap, sprintNumber);
    if (!sprint || sprint.tickets.length === 0) return null;
    total = sprint.tickets.length;
    ticketKeys = sprint.tickets.map(t => t.key);
  } catch {
    return null;
  }
  let store: Awaited<ReturnType<typeof resolveStore>> | null = null;
  try {
    store = await resolveStore(cwd);
    const completed = await readCompletedTicketKeys(store, sprintNumber);
    // Count only this sprint's roadmap tickets. The ledger can hold keys the
    // sprint does not list, which made the raw set size report "3/2 tickets
    // recorded done" and never reach the all-done branch.
    return { recorded: ticketKeys.filter(key => completed.has(key)).length, total };
  } catch {
    return null;
  } finally {
    store?.close();
  }
}

async function countSprintClaims(cwd: string, sprintNumber: SprintId): Promise<number> {
  let store: Awaited<ReturnType<typeof resolveStore>> | null = null;
  try {
    store = await resolveStore(cwd);
    return (await store.list(sprintNumber)).length;
  } catch {
    return 0;
  } finally {
    store?.close();
  }
}
