import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  DEFAULT_SKILLS_PATH,
  discoverScorecardFiles,
  loadSkillRegistry,
  parseSprintNumber,
  skillIds,
  sprintNumberFromScorecardFile,
  validateScorecard,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { updateGate } from '../sprint-state.js';
import { completeRoadmapSourceSprint } from '../roadmap-source-store.js';
import type { RoadmapSourceError } from '../../core/index.js';

export function validateCommand(input?: string | string[]): void {
  const args = Array.isArray(input) ? input : input ? [input] : [];
  const validateSkills = args.includes('--skills');
  const readOnly = args.includes('--read-only');
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
  const validScorecards: Array<{ sprint: number; path: string }> = [];

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
      if (typeof card.sprint_number === 'number') validScorecards.push({ sprint: card.sprint_number, path: file });
    } else if (result.valid) {
      console.log(`\u2713 ${sprintLabel}: Valid (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`);
      for (const w of result.warnings) {
        console.log(`  \u26A0 [${w.code}] ${w.message}`);
      }
      if (typeof card.sprint_number === 'number') validScorecards.push({ sprint: card.sprint_number, path: file });
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
    updateGate(cwd, 'scorecard', true);
    reconciled = reconcileModularRoadmapSources(cwd, validScorecards);
  } else if (readOnly) {
    // `validate` writes tracked files as a side effect: it marks the scorecard
    // gate, reconciles scorecard indexes and sprint status into the phase YAML,
    // and regenerates the compiled projection. Surprising for a read-sounding
    // command, so --read-only offers a pure check (GH #644, #637 fix 3). The
    // default is unchanged, because the closeout workflow depends on that
    // reconciliation.
    console.log('  (--read-only: skipped gate update and roadmap source reconciliation)\n');
  }

  process.exit(allValid && registryAvailable && reconciled ? 0 : 1);
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
  scorecards: Array<{ sprint: number; path: string }>,
): boolean {
  if (!existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))) return true;
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
      console.log(`  Roadmap source reconciled: S${scorecard.sprint} -> complete (${result.source}; projection ${result.projection})`);
      if (result.reformatted) {
        console.log(`  ⚠ ${result.source} could not be patched surgically and was rewritten in canonical YAML style.`);
      }
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

function parseRequestedSprint(args: string[], sprintArgIndex: number): number | null {
  if (sprintArgIndex < 0) return null;
  const arg = args[sprintArgIndex];
  const raw = arg.startsWith('--sprint=')
    ? arg.slice('--sprint='.length)
    : args[sprintArgIndex + 1];
  const sprint = parseSprintNumber(raw ?? '');
  if (sprint == null) {
    console.error('Error: --sprint must be a valid sprint number.');
    process.exit(1);
  }
  return sprint;
}
