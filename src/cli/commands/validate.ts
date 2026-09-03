import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  DEFAULT_SKILLS_PATH,
  discoverScorecardFiles,
  loadSkillRegistry,
  skillIds,
  sprintIdKey,
  sprintNumberFromScorecardFile,
  validateScorecard,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { updateGate, sprintStateLocation } from '../sprint-state.js';
import { completeRoadmapSourceSprint } from '../roadmap-source-store.js';
import { sprintLabelForExecution } from '../workflow-resync.js';
import { reconcileWorkflowCloseout, WORKFLOW_EXECUTION_ID_ENV } from '../workflow-closeout.js';
import type { RoadmapSourceError, SprintId } from '../../core/index.js';

export async function validateCommand(input?: string | string[]): Promise<void> {
  const args = Array.isArray(input) ? input : input ? [input] : [];
  const validateSkills = args.includes('--skills');
  // Both spellings. Sibling roadmap commands used --dry-run for the same
  // idea, and a reader who types the safe-sounding word on the command #706
  // names must not get the full write path.
  const readOnly = args.includes('--read-only') || args.includes('--dry-run');
  const sprintArgIndex = args.findIndex(arg => arg === '--sprint' || arg.startsWith('--sprint='));
  const requestedSprint = parseRequestedSprint(args, sprintArgIndex);
  const path = args.find((arg, index) => {
    if (arg.startsWith('--')) return false;
    if (sprintArgIndex >= 0 && args[sprintArgIndex] === '--sprint' && index === sprintArgIndex + 1) return false;
    return true;
  });
  const cwd = process.cwd();
  const config = loadConfig();
  const files: string[] = [];
  let knownSkillIds: Set<string> | null = null;
  let registryAvailable = true;

  if (validateSkills) {
    const registryPath = join(cwd, config.skillsPath ?? DEFAULT_SKILLS_PATH);
    const registry = loadSkillRegistry(registryPath);
    if (!registry) {
      console.log(`\n✗ Skill registry not found or invalid at ${registryPath}. Run \`slope skills scan\` first.`);
      registryAvailable = false;
    } else {
      knownSkillIds = skillIds(registry);
    }
  }

  if (path) {
    files.push(isAbsolute(path) ? path : join(cwd, path));
  } else {
    const discovered = discoverScorecardFiles(config, cwd);
    files.push(...(requestedSprint == null
      ? discovered
      : discovered.filter(file => sprintNumberFromScorecardFile(file, config) === requestedSprint)));
  }

  if (files.length === 0) {
    if (requestedSprint != null) {
      console.log(`\nNo scorecard found for Sprint ${requestedSprint}.\n`);
      process.exit(1);
    }
    console.log('\nNo scorecards found to validate.\n');
    process.exit(0);
  }

  let allValid = true;
  const validScorecards: Array<{ sprint: SprintId; path: string }> = [];

  for (const file of files) {
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.log(`\n\u2717 ${file}: Failed to parse JSON`);
      allValid = false;
      continue;
    }

    const card = { ...raw, sprint_number: raw.sprint_number ?? raw.sprint };
    const result = validateScorecard(card, knownSkillIds ? { knownSkillIds } : {});

    const sprintLabel = card.sprint_number ? `Sprint ${card.sprint_number}` : file;

    if (result.valid && result.warnings.length === 0) {
      console.log(`\u2713 ${sprintLabel}: Valid (no errors, no warnings)`);
      const sprint = sprintIdKey(card.sprint_number as string | number);
      if (sprint) validScorecards.push({ sprint, path: file });
    } else if (result.valid) {
      console.log(`\u2713 ${sprintLabel}: Valid (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`);
      for (const w of result.warnings) {
        console.log(`  \u26A0 [${w.code}] ${w.message}`);
      }
      const sprint = sprintIdKey(card.sprint_number as string | number);
      if (sprint) validScorecards.push({ sprint, path: file });
    } else {
      console.log(`\u2717 ${sprintLabel}: INVALID (${result.errors.length} error${result.errors.length === 1 ? '' : 's'}, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`);
      for (const e of result.errors) {
        console.log(`  \u2717 [${e.code}] ${e.message}${e.field ? ` (${e.field})` : ''}`);
      }
      for (const w of result.warnings) {
        console.log(`  \u26A0 [${w.code}] ${w.message}`);
      }
      allValid = false;
    }
  }

  console.log('');

  // Mark scorecard gate complete on successful validation
  let reconciled = true;
  if (allValid && registryAvailable && !readOnly) {
    // Say so. This was the one write validate never mentioned, so a reader
    // watching the output had no way to know sprint state had moved (#706).
    if (updateGate(cwd, 'scorecard', true)) {
      console.log(`  Marked the scorecard gate complete in ${sprintStateLocation(cwd)}`);
    }
    const completedRoadmapSprints = new Set<SprintId>();
    reconciled = reconcileModularRoadmapSources(cwd, validScorecards, completedRoadmapSprints);
    if (reconciled && completedRoadmapSprints.size > 0) {
      reconciled = await reconcileValidatedWorkflowExecutions(cwd, completedRoadmapSprints);
    }
  } else if (readOnly) {
    // `validate` writes tracked files as a side effect: it marks the scorecard
    // gate, reconciles scorecard indexes and sprint status into the phase YAML,
    // and regenerates the compiled projection. Surprising for a read-sounding
    // command, so --read-only offers a pure check (GH #644, #637 fix 3).
    //
    // The default stays a writer, decided again under #706. The closeout
    // workflow depends on the reconciliation, and flipping it would mean every
    // sprint close needs a second command that people would forget, trading a
    // surprising write for a silent omission. The mitigation is that the
    // writes now name every file they touch, so the surprise is visible rather
    // than removed. `--read-only` and `--dry-run` are accepted on validate,
    // roadmap compile and roadmap complete alike.
    console.log('  (--read-only: skipped gate update and roadmap source reconciliation)\n');
  }

  process.exit(allValid && registryAvailable && reconciled ? 0 : 1);
}

async function reconcileValidatedWorkflowExecutions(cwd: string, sprints: Iterable<SprintId>): Promise<boolean> {
  const invokingExecutionId = process.env[WORKFLOW_EXECUTION_ID_ENV]?.trim();
  const result = await reconcileWorkflowCloseout(cwd, sprints, {
    ...(invokingExecutionId ? { preserveExecutionIds: [invokingExecutionId] } : {}),
    preserveNewestPerSprint: true,
  });
  for (const exec of result.completed) {
    console.log(`  Workflow execution reconciled: ${sprintLabelForExecution(exec)} duplicate -> completed (${exec.id})`);
  }
  if (result.warning) {
    console.error(`  \u2717 Workflow execution reconciliation failed: ${result.warning}`);
    return false;
  }
  return true;
}

/**
 * Reconcile closeout status into the modular sources.
 *
 * Returns false when reconciliation was blocked by a refusal to discard authored
 * projection content. That must fail the command: exiting 0 while planning work
 * is silently destroyed is the defect itself (GH #637).
 */
export function reconcileModularRoadmapSources(
  cwd: string,
  scorecards: Array<{ sprint: SprintId; path: string }>,
  completedSprints: Set<SprintId> = new Set(),
): boolean {
  if (!existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))) {
    for (const scorecard of scorecards) completedSprints.add(scorecard.sprint);
    return true;
  }
  let ok = true;
  for (const scorecard of scorecards) {
    try {
      const result = completeRoadmapSourceSprint(cwd, scorecard.sprint, {
        scorecardPath: relative(cwd, scorecard.path).replace(/\\/g, '/'),
      });
      if (result.skipped === 'status_conflict') {
        // A scorecard exists but the sprint carries a deliberate disposition
        // (absorbed, blocked, deferred, ...). Reconciliation must not overwrite
        // it back to complete (GH #660) — surface the mismatch and leave the
        // authored status alone. This is a legitimate state, not a failure.
        console.log(`  ⚠ Roadmap source left as-authored: S${scorecard.sprint} has a scorecard but status '${result.authoredStatus}' (${result.source}).`);
        console.log('    A scorecard records how the sprint was played, not its disposition; leaving the status untouched.');
        console.log(`    To intentionally mark it complete, run: slope roadmap complete --sprint=${scorecard.sprint}`);
        continue;
      }
      // Name the files this rewrote. A read-sounding command that changes
      // tracked files should say which ones, by path (#706).
      const projectionNote = result.projection === 'written'
        ? `wrote ${result.projectionPath}`
        : `${result.projectionPath} unchanged`;
      console.log(`  Roadmap source reconciled: S${scorecard.sprint} -> complete (rewrote ${result.source}; ${projectionNote})`);
      if (result.reformatted) {
        console.log(result.commentsPreserved
          ? `  ⚠ ${result.source} could not be patched surgically, so its formatting was normalised. Comments are preserved.`
          : `  ⚠ ${result.source} could not be edited in place and was rebuilt from its parsed contents. COMMENTS IN THIS FILE WERE LOST; recover them from git.`);
      }
      completedSprints.add(scorecard.sprint);
    } catch (error) {
      if ((error as RoadmapSourceError).projectionContentLoss) {
        // Report once, not per scorecard \u2014 the cause is the projection, not the sprint.
        if (ok) console.error(`\n\u2717 ${(error as Error).message}\n`);
        ok = false;
        continue;
      }
      console.log(`  \u26A0 Roadmap source not reconciled for S${scorecard.sprint}: ${(error as Error).message}`);
      console.log(`    Run: slope roadmap complete --sprint=${scorecard.sprint}`);
    }
  }
  return ok;
}

function parseRequestedSprint(args: string[], sprintArgIndex: number): string | null {
  if (sprintArgIndex < 0) return null;
  const arg = args[sprintArgIndex];
  const raw = arg.startsWith('--sprint=')
    ? arg.slice('--sprint='.length)
    : args[sprintArgIndex + 1];
  const sprint = sprintIdKey(raw ?? '');
  if (sprint == null) {
    console.error('Error: --sprint must be a valid sprint number.');
    process.exit(1);
  }
  return sprint;
}
