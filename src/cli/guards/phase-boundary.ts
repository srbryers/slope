import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { loadConfig, parseRoadmap } from '../../core/index.js';
import { isPhaseComplete, pendingPhaseGates } from '../phase-cleanup.js';

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

  // Only match sprint-start or claim commands
  if (!/\bslope\s+(sprint\s+start|claim)\b/.test(command)) return {};

  // Parse target sprint number from command args
  const sprintMatch = command.match(/--sprint[=\s]+(\d+)/i) ??
    command.match(/\bS(\d+)\b/i) ??
    command.match(/--target[=\s]+S?(\d+)/i);

  // If we can't determine the target sprint, allow (don't block blindly)
  if (!sprintMatch) return {};
  const targetSprint = parseInt(sprintMatch[1], 10);

  // Load roadmap to determine phase mapping
  const config = loadConfig(cwd);
  let roadmap;
  try {
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return {};
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const result = parseRoadmap(raw);
    roadmap = result.roadmap;
  } catch {
    return {
      decision: 'deny',
      blockReason: 'SLOPE phase-boundary: Cannot determine phase — roadmap unreadable. Run `slope roadmap validate`.',
    };
  }

  if (!roadmap || !roadmap.phases) return {};

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
  const prevPhaseIdx = targetPhaseIdx - 1;
  const prevPhaseNum = phaseNumbers[prevPhaseIdx];

  // Check if previous phase cleanup is complete
  if (isPhaseComplete(cwd, prevPhaseNum)) return {};

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
