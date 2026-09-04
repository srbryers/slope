import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoadmap, roadmapSprintKeyFromId } from '../core/index.js';
import type { SlopeConfig } from '../core/index.js';
import { loadConfig } from './config.js';
import { recordPhaseGateForSprint, type PhaseGateName } from './phase-cleanup.js';
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

    const sprint = inferSprintContext(cwd, config).sprint;
    const sprintKey = roadmapSprintKeyFromId(roadmap, sprint);
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
