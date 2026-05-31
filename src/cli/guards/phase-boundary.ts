import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult, Suggestion } from '../../core/index.js';
import { castRoadmapStructure, loadConfig, parseRoadmap } from '../../core/index.js';
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
  const slopeArgs = extractRelevantSlopeArgs(command);

  // Match actual slope sprint-start, sprint-run, or claim invocations.
  if (!slopeArgs) return {};

  // Parse target sprint number from command args
  const argText = slopeArgs.join(' ');
  const sprintMatch = argText.match(/--sprint[=\s]+(\d+)/i) ??
    argText.match(/\bS(\d+)\b/i) ??
    argText.match(/--target[=\s]+S?(\d+)/i);

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
    roadmap = result.roadmap ?? castRoadmapStructure(raw);
  } catch {
    return {
      context: 'SLOPE phase-boundary: Cannot determine phase because the roadmap is unreadable. Allowing command; run `slope roadmap validate`.',
    };
  }

  if (!roadmap || !roadmap.phases) {
    return {
      context: 'SLOPE phase-boundary: Cannot determine phase because the roadmap is structurally invalid. Allowing command; run `slope roadmap validate`.',
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
  for (const segment of splitShellSegments(command)) {
    const words = tokenizeShellWords(segment);
    const slopeIndex = findSlopeExecutableIndex(words);
    if (slopeIndex < 0) continue;

    const args = words.slice(slopeIndex + 1);
    if (args[0] === 'sprint' && (args[1] === 'start' || args[1] === 'run')) return args;
    if (args[0] === 'claim') return args;
  }

  return null;
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      current += char;
      if (i + 1 < command.length) current += command[++i];
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (!quote && (char === ';' || char === '\n' || (char === '&' && command[i + 1] === '&') || (char === '|' && command[i + 1] === '|'))) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if (char === '&' || char === '|') i++;
      continue;
    }
    current += char;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function tokenizeShellWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    if (char === '\\' && quote !== "'") {
      if (i + 1 < segment.length) current += segment[++i];
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) words.push(current);
  return words;
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
