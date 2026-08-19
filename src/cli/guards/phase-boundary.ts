import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { castRoadmapStructure, loadConfig, loadScorecards, parseRoadmap, parseSprintNumber, roadmapSprintOrderValue } from '../../core/index.js';
import { isPhaseComplete, pendingPhaseGates } from '../phase-cleanup.js';
import { shellCommandSegments } from './command-parse.js';

/** Extract phase number from name like "Phase 7 — Helmsman 3D". Falls back to array index + 1. */
function extractPhaseNumber(name: string, index: number): number {
  const match = name.match(/Phase\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : index + 1;
}

/**
 * Phase-boundary guard: fires PreToolUse on Bash.
 * Blocks starting a sprint in Phase N+1 if Phase N cleanup is incomplete.
 */
export async function phaseBoundaryGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const command = (input.tool_input?.command as string) ?? '';
  const slopeArgs = extractRelevantSlopeArgs(command);

  // Match actual slope sprint-start, sprint-run, or claim invocations.
  if (!slopeArgs) return {};

  // If we can't determine the target sprint, allow (don't block blindly)
  const targetSprint = targetSprintFromSlopeArgs(slopeArgs);
  if (targetSprint === null) return {};

  // Load roadmap to determine phase mapping
  const config = loadConfig(cwd);
  let roadmap;
  try {
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return {};
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const result = parseRoadmap(raw);
    roadmap = result.roadmap ?? castRoadmapStructure(raw);
  } catch {
    return {
      context: [
        'SLOPE advisory (non-blocking) — phase-boundary could not read the roadmap, so this command is allowed.',
        'Run `slope roadmap validate` for the parse error. This advisory does not grant or deny host tool permission.',
      ].join('\n'),
    };
  }

  if (!roadmap || !roadmap.phases) {
    return {
      context: [
        'SLOPE advisory (non-blocking) — phase-boundary could not map roadmap phases, so this command is allowed.',
        'Run `slope roadmap validate` for the structural error. This advisory does not grant or deny host tool permission.',
      ].join('\n'),
    };
  }

  // Build phase-to-number mapping (RoadmapPhase has name + sprints[], no id)
  const phaseNumbers = roadmap.phases.map((p, i) => extractPhaseNumber(p.name, i));

  // Find which phase the target sprint belongs to
  let targetPhaseIdx = -1;
  for (let i = 0; i < roadmap.phases.length; i++) {
    if (Array.isArray(roadmap.phases[i].sprints) && roadmap.phases[i].sprints.includes(targetSprint)) {
      targetPhaseIdx = i;
      break;
    }
  }

  if (targetPhaseIdx < 0) return {}; // Sprint not in any phase — allow
  if (targetPhaseIdx === 0) return {}; // First phase — no previous phase to check

  const targetPhaseNum = phaseNumbers[targetPhaseIdx];
  // Use array order (not phase number arithmetic) to find the previous phase.
  // This correctly handles non-sequential numbering: [Phase 1, Phase 3] → check Phase 1 before Phase 3.
  const prevPhaseIdx = targetPhaseIdx - 1;
  const prevPhaseNum = phaseNumbers[prevPhaseIdx];

  // Check if previous phase cleanup is complete
  if (isPhaseComplete(cwd, prevPhaseNum)) return {};

  // Staleness heuristic (#621): the phase ledger can silently fall behind
  // reality (phases ship without `slope phase complete` ever running). When a
  // scorecard exists for a ROADMAP sprint at or past the target phase's first
  // sprint, the boundary is history — warn instead of blocking on ancient
  // state. Orders resolve through the roadmap so legacy encoded ids (235 ~
  // S23.5) cannot skew the boundary, and only roadmap-member scorecards count
  // as evidence, so a stray high-numbered recovery scorecard cannot downgrade
  // every earlier boundary.
  const orderOf = (id: number): number => roadmapSprintOrderValue(roadmap, id);
  const targetPhaseSprints = (roadmap.phases[targetPhaseIdx].sprints ?? [])
    .filter((id): id is number => typeof id === 'number')
    .map(orderOf);
  const boundaryOrder = targetPhaseSprints.length > 0 ? Math.min(...targetPhaseSprints) : null;
  if (boundaryOrder !== null) {
    try {
      const roadmapOrdersAtOrPastBoundary = new Set(
        roadmap.sprints.map(sprint => orderOf(sprint.id)).filter(order => order >= boundaryOrder),
      );
      const scorecardOrders = loadScorecards(config, cwd).map(card => orderOf(card.sprint_number));
      if (scorecardOrders.some(order => roadmapOrdersAtOrPastBoundary.has(order))) {
        const pendingGates = pendingPhaseGates(cwd, prevPhaseNum);
        return {
          context: [
            `SLOPE advisory (non-blocking) — Phase ${prevPhaseNum} cleanup was never recorded, but scorecards already exist at or past Phase ${targetPhaseNum}, so the phase ledger looks stale rather than the work incomplete.`,
            ...(pendingGates.length > 0 ? [`Unrecorded Phase ${prevPhaseNum} gates: ${pendingGates.join('; ')}`] : []),
            `Review those gates, then reconcile the ledger with: slope phase complete ${prevPhaseNum} (manual override — it records all gates without validation).`,
            'This advisory does not grant or deny host tool permission.',
          ].join('\n'),
        };
      }
    } catch {
      // Scorecard evidence is advisory; fall through to the normal block.
    }
  }

  // Previous phase cleanup incomplete — block with suggestion
  const pending = pendingPhaseGates(cwd, prevPhaseNum);

  const suggestion: Suggestion = {
    id: 'phase-boundary',
    title: 'Phase Boundary',
    context: `Phase ${prevPhaseNum} cleanup is incomplete. Complete these gates before starting Sprint ${targetSprint} (Phase ${targetPhaseNum}).`,
    options: [
      ...pending.map((gate, i) => ({
        id: `gate-${i}`,
        label: gate,
      })),
      {
        id: 'override',
        label: 'Mark phase complete (manual override)',
        command: `slope phase complete ${prevPhaseNum}`,
      },
    ],
    requiresDecision: true,
    priority: 'critical',
  };

  return {
    decision: 'deny',
    suggestion,
  };
}

function extractRelevantSlopeArgs(command: string): string[] | null {
  // shellCommandSegments skips heredoc bodies and flags quoted tokens, so
  // documentation about a command can no longer read as the command (#683).
  for (const { words } of shellCommandSegments(command)) {
    const slopeIndex = findSlopeExecutableIndex(words);
    if (slopeIndex < 0) continue;

    const args = words.slice(slopeIndex + 1);
    if (args[0] === 'sprint' && (args[1] === 'start' || args[1] === 'run')) return args;
    if (args[0] === 'start') return args;
    if (args[0] === 'claim') return args;
  }

  return null;
}

function targetSprintFromSlopeArgs(args: string[]): number | null {
  if (args[0] === 'sprint' && (args[1] === 'start' || args[1] === 'run')) {
    return targetSprintFromValues(args.slice(2), ['--sprint', '--target', '--ticket'], true);
  }
  if (args[0] === 'start') {
    return targetSprintFromValues(args.slice(1), ['--sprint', '--target', '--ticket'], true);
  }
  if (args[0] === 'claim') {
    return targetSprintFromValues(args.slice(1), ['--target', '--ticket', '--sprint'], true);
  }
  return null;
}

function targetSprintFromValues(args: string[], flags: string[], allowPositional: boolean): number | null {
  for (const flag of flags) {
    const value = flagValue(args, flag);
    const sprint = sprintFromValue(value);
    if (sprint !== null) return sprint;
  }

  if (!allowPositional) return null;
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    const sprint = sprintFromValue(arg);
    if (sprint !== null) return sprint;
  }
  return null;
}

function flagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) return args[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

function sprintFromValue(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  const ticketMatch = normalized.match(/^S?(\d+(?:\.\d+)?)(?:-\d+)?$/i);
  return parseSprintNumber(ticketMatch?.[1] ?? normalized);
}



function findSlopeExecutableIndex(words: string[]): number {
  let i = 0;
  if (words[i] === 'env') i++;
  while (isEnvAssignment(words[i])) i++;
  if (words[i] === 'command') i++;

  if (words[i] === 'slope') return i;
  if ((words[i] === 'npx' || words[i] === 'bunx') && words[i + 1] === 'slope') return i + 1;
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(words[i])) {
    if (words[i + 1] === 'exec' && words[i + 2] === 'slope') return i + 2;
    if (words[i + 1] === 'slope') return i + 1;
  }

  return -1;
}

function isEnvAssignment(word: string | undefined): boolean {
  return !!word && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}
