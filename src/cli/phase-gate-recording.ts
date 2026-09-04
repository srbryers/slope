import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLatestSprint, parseRoadmap, roadmapSprintKeyFromId } from '../core/index.js';
import type { SlopeConfig } from '../core/index.js';
import { loadConfig } from './config.js';
import { phaseNumberForSprint, recordPhaseGateForSprint, type PhaseGateName } from './phase-cleanup.js';
import { inferSprintContext } from './sprint-inference.js';

/**
 * Record a phase cleanup gate from the command that satisfies it (#696).
 *
 * The phase-boundary guard listed five gates and named a command beside each,
 * but only `slope phase audit` ever wrote one. So running every command the
 * guard asked for still left four gates unset, and the only way past the
 * boundary was `slope phase complete`, which the guard itself labels a manual
 * override. A boundary whose only reachable exit is the override teaches
 * people that the override is the normal path.
 *
 * These commands know nothing about phases, so each has to find the phase that
 * owns the sprint it is working on. When that cannot be resolved, nothing is
 * recorded and nothing is claimed: recording against a guessed phase would open
 * a boundary on evidence belonging elsewhere, which is worse than not recording.
 */
/**
 * The sprint whose phase these gates belong to.
 *
 * The latest sprint with a scorecard, not the next pending one. Cleanup runs
 * after the last sprint of a phase closes, and at that moment the "current"
 * sprint by inference is already the first sprint of the NEXT phase. Recording
 * there marks gates on a phase whose work has not started, and leaves the
 * phase actually being closed still blocking the boundary.
 */
function closeoutSprint(cwd: string, config: SlopeConfig): string {
  const latest = detectLatestSprint(config, cwd);
  if (latest !== '0') return latest;
  // No scorecards yet: fall back to whatever sprint context says, so a
  // first-phase project is not left with nowhere to record.
  return inferSprintContext(cwd, config).sprint;
}

/**
 * The phase owning the current sprint, or null when it cannot be resolved.
 *
 * Lets `slope phase regression` and `slope phase gate` default to the phase
 * being worked on, so the common case needs no number, while an explicit one
 * still wins.
 */
export function currentPhaseNumber(cwd: string, config?: SlopeConfig): number | null {
  try {
    const cfg = config ?? loadConfig(cwd);
    const roadmapPath = join(cwd, cfg.roadmapPath);
    if (!existsSync(roadmapPath)) return null;
    const roadmap = parseRoadmap(JSON.parse(readFileSync(roadmapPath, 'utf8'))).roadmap;
    if (!roadmap) return null;
    const sprintKey = roadmapSprintKeyFromId(roadmap, closeoutSprint(cwd, cfg));
    if (sprintKey === null) return null;
    return phaseNumberForSprint(roadmap, sprintKey, id => roadmapSprintKeyFromId(roadmap, id));
  } catch {
    return null;
  }
}

export function recordPhaseGate(
  cwd: string,
  gate: PhaseGateName,
  options: { config?: SlopeConfig; quiet?: boolean } = {},
): number | null {
  let phase: number | null = null;
  try {
    const config = options.config ?? loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return null;
    const roadmap = parseRoadmap(JSON.parse(readFileSync(roadmapPath, 'utf8'))).roadmap;
    if (!roadmap) return null;

    const sprintKey = roadmapSprintKeyFromId(roadmap, closeoutSprint(cwd, config));
    if (sprintKey === null) return null;

    phase = recordPhaseGateForSprint(
      cwd,
      roadmap,
      sprintKey,
      id => roadmapSprintKeyFromId(roadmap, id),
      gate,
    );
  } catch {
    // Gate recording is a side effect of a command that has already done its
    // real work and reported success. It must never turn that into a failure.
    return null;
  }

  if (phase != null && !options.quiet) {
    console.log(`Phase ${phase} gate recorded: ${gate}`);
  }
  return phase;
}
