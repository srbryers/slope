import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadScorecards,
  parseRoadmap,
  roadmapSprintKey,
  roadmapSprintKeyFromId,
} from '../core/index.js';
import type { SlopeConfig } from '../core/index.js';
import { loadConfig } from './config.js';
import {
  extractPhaseNumber,
  isPhaseComplete,
  markPhaseGate,
  type PhaseGateName,
} from './phase-cleanup.js';

type RoadmapLike = NonNullable<ReturnType<typeof parseRoadmap>['roadmap']>;

/**
 * Sprint statuses that never produce a scorecard.
 *
 * `ROADMAP_TERMINAL_STATUSES` minus `complete`. Ten sprints across six phases
 * in this repo carry `superseded`, so a phase containing one could otherwise
 * never satisfy a gate.
 */
const UNSCORED_STATUSES = new Set([
  'superseded',
  'skipped',
  'cancelled',
  'cancelled-absorbed',
  'absorbed',
]);

interface PhaseCloseout {
  /** Phase number these gates belong to. */
  number: number;
  /** Canonical sprint keys the phase needs scored, never-scored ones excluded. */
  requiredSprints: string[];
}

/**
 * The phase currently being closed out, or null when there is not one.
 *
 * Three earlier attempts at this each got a different case wrong, so the rule
 * is spelled out rather than inferred from a single sprint:
 *
 * - The last phase, in roadmap order, whose work is finished. Resolving from
 *   the current sprint recorded against the NEXT phase, because after a phase
 *   closes the current sprint is already the first sprint of the one after.
 * - Finished means every sprint that can produce a scorecard has one.
 *   Requiring one from every listed sprint would permanently lock out the six
 *   phases in this repo that contain superseded sprints.
 * - Unfinished phases do not qualify at all, so ordinary post-hole hygiene
 *   mid-phase cannot open the boundary on work that has not happened.
 * - Sprints outside every phase are ignored. Reading the highest scorecard
 *   number let one stray recovery card, `sprint-999.json`, silently veto all
 *   gate recording with no message.
 * - A phase already recorded complete returns null: nothing left to close.
 */
function phaseBeingClosedOut(
  cwd: string,
  config: SlopeConfig,
  roadmap: RoadmapLike,
): PhaseCloseout | null {
  const scored = new Set(
    loadScorecards(config, cwd)
      .map(card => roadmapSprintKeyFromId(roadmap, card.sprint_number))
      .filter((key): key is string => key !== null),
  );
  // Sprints that will never produce a scorecard, so requiring one from them
  // would lock their phase out of gate recording permanently. Deliberately
  // NOT `isRoadmapSprintTerminal`, which counts `complete` as terminal: that
  // is the status of exactly the sprints whose scorecards this needs.
  const neverScored = new Set(
    (roadmap.sprints ?? [])
      .filter(sprint => UNSCORED_STATUSES.has((sprint as { status?: string }).status ?? ''))
      .map(sprint => roadmapSprintKey(roadmap, sprint)),
  );

  let candidate: PhaseCloseout | null = null;
  const phases = roadmap.phases ?? [];
  for (let i = 0; i < phases.length; i++) {
    const members = (phases[i].sprint_keys ?? phases[i].sprints)
      .map(id => roadmapSprintKeyFromId(roadmap, id))
      .filter((key): key is string => key !== null);
    const required = members.filter(key => !neverScored.has(key));
    if (required.length === 0) continue;
    if (!required.every(key => scored.has(key))) continue;
    candidate = { number: extractPhaseNumber(phases[i].name, i), requiredSprints: required };
  }

  if (!candidate) return null;
  return isPhaseComplete(cwd, candidate.number) ? null : candidate;
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
    return phaseBeingClosedOut(cwd, cfg, roadmap)?.number ?? null;
  } catch {
    return null;
  }
}

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
 *
 * `coveredSprints` is for gates whose meaning is plural. Pass the sprints the
 * run actually covered and the gate is refused unless they include the whole
 * phase.
 */
export function recordPhaseGate(
  cwd: string,
  gate: PhaseGateName,
  options: { config?: SlopeConfig; quiet?: boolean; coveredSprints?: ReadonlySet<string> } = {},
): number | null {
  let phase: number | null = null;
  try {
    const config = options.config ?? loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (!existsSync(roadmapPath)) return null;
    const roadmap = parseRoadmap(JSON.parse(readFileSync(roadmapPath, 'utf8'))).roadmap;
    if (!roadmap) return null;

    const closeout = phaseBeingClosedOut(cwd, config, roadmap);
    if (!closeout) return null;

    // Some gates additionally require the run to have covered the whole
    // phase. `slope validate docs/retros/sprint-1.json` validated one file
    // and satisfied a gate that means every scorecard in the phase is valid.
    if (options.coveredSprints) {
      // Normalise through the roadmap on both sides. A caller's sprint ids are
      // raw scorecard values, and a legacy numeric mirror like `458.1` does
      // not compare equal to the canonical `458.10`.
      const covered = new Set(
        [...options.coveredSprints]
          .map(id => roadmapSprintKeyFromId(roadmap, id))
          .filter((key): key is string => key !== null),
      );
      if (!closeout.requiredSprints.every(key => covered.has(key))) return null;
    }

    markPhaseGate(cwd, closeout.number, gate, true);
    phase = closeout.number;
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
