import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DEFAULT_SKILLS_PATH, discoverScorecardFiles, loadSkillRegistry, skillIds, validateScorecard } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { updateGate } from '../sprint-state.js';

export function validateCommand(input?: string | string[]): void {
  const args = Array.isArray(input) ? input : input ? [input] : [];
  const validateSkills = args.includes('--skills');
  const path = args.find(arg => !arg.startsWith('--'));
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
    files.push(...discoverScorecardFiles(config, cwd));
  }

  if (files.length === 0) {
    console.log('\nNo scorecards found to validate.\n');
    process.exit(0);
  }

  let allValid = true;

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
    } else if (result.valid) {
      console.log(`\u2713 ${sprintLabel}: Valid (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`);
      for (const w of result.warnings) {
        console.log(`  \u26A0 [${w.code}] ${w.message}`);
      }
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
  if (allValid && registryAvailable) {
    updateGate(cwd, 'scorecard', true);
  }

  process.exit(allValid && registryAvailable ? 0 : 1);
}
