import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateScorecard } from '@slope-dev/core';
import { loadConfig } from '../config.js';

export function validateCommand(path?: string): void {
  const config = loadConfig();
  const files: string[] = [];

  if (path) {
    files.push(path);
  } else {
    // Validate all scorecards matching config
    const dir = join(process.cwd(), config.scorecardDir);
    const patternParts = config.scorecardPattern.split('*');
    const prefix = patternParts[0] ?? '';
    const suffix = patternParts[1] ?? '';
    const regex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

    try {
      const dirFiles = readdirSync(dir)
        .filter((f: string) => {
          const m = f.match(regex);
          return m && parseInt(m[1], 10) >= config.minSprint;
        })
        .sort();
      for (const f of dirFiles) {
        files.push(join(dir, f));
      }
    } catch {
      // Directory doesn't exist
    }
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
    const result = validateScorecard(card);

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
  process.exit(allValid ? 0 : 1);
}
