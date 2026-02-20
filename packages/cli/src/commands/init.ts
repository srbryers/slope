import { writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from '../config.js';
import type { SlopeConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXAMPLE_SCORECARD = {
  sprint_number: 1,
  theme: 'Example Sprint',
  par: 3,
  slope: 0,
  score: 3,
  score_label: 'par',
  date: new Date().toISOString().split('T')[0],
  shots: [
    {
      ticket_key: 'S1-1',
      title: 'Set up project',
      club: 'short_iron',
      result: 'green',
      hazards: [],
      notes: 'Clean setup',
    },
    {
      ticket_key: 'S1-2',
      title: 'Add core feature',
      club: 'short_iron',
      result: 'in_the_hole',
      hazards: [],
    },
    {
      ticket_key: 'S1-3',
      title: 'Write tests',
      club: 'wedge',
      result: 'green',
      hazards: [{ type: 'rough', description: 'Flaky test environment' }],
    },
  ],
  conditions: [],
  special_plays: [],
  stats: {
    fairways_hit: 3,
    fairways_total: 3,
    greens_in_regulation: 3,
    greens_total: 3,
    putts: 0,
    penalties: 0,
    hazards_hit: 1,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
  },
  yardage_book_updates: [],
  bunker_locations: [],
  course_management_notes: ['This is an example scorecard — replace with your own sprint data.'],
};

const EXAMPLE_COMMON_ISSUES = {
  recurring_patterns: [
    {
      id: 1,
      title: 'Example pattern',
      category: 'general',
      sprints_hit: [1],
      gotcha_refs: [],
      description: 'This is an example recurring pattern. Replace with your own.',
      prevention: 'Add your prevention strategy here.',
    },
  ],
};

export function initCommand(args: string[]): void {
  const cwd = process.cwd();
  const claudeCode = args.includes('--claude-code');

  // Create .slope directory and config
  const configPath = createConfig(cwd);
  console.log(`  Created ${configPath}`);

  // Create scorecard directory
  const scorecardDir = join(cwd, 'docs', 'retros');
  if (!existsSync(scorecardDir)) {
    mkdirSync(scorecardDir, { recursive: true });
    console.log(`  Created ${scorecardDir}/`);
  }

  // Write example scorecard
  const examplePath = join(scorecardDir, 'sprint-1.json');
  if (!existsSync(examplePath)) {
    writeFileSync(examplePath, JSON.stringify(EXAMPLE_SCORECARD, null, 2) + '\n');
    console.log(`  Created ${examplePath}`);
  }

  // Write example common-issues.json
  const commonIssuesPath = join(cwd, '.slope', 'common-issues.json');
  if (!existsSync(commonIssuesPath)) {
    writeFileSync(commonIssuesPath, JSON.stringify(EXAMPLE_COMMON_ISSUES, null, 2) + '\n');
    console.log(`  Created ${commonIssuesPath}`);
  }

  // Write example sessions.json
  const sessionsPath = join(cwd, '.slope', 'sessions.json');
  if (!existsSync(sessionsPath)) {
    writeFileSync(sessionsPath, JSON.stringify({ sessions: [] }, null, 2) + '\n');
    console.log(`  Created ${sessionsPath}`);
  }

  // Claude Code templates
  if (claudeCode) {
    const templatesRoot = join(__dirname, '..', '..', '..', '..', 'templates', 'claude-code');
    const rulesDir = join(cwd, '.claude', 'rules');
    const hooksDir = join(cwd, '.claude', 'hooks');

    mkdirSync(rulesDir, { recursive: true });
    mkdirSync(hooksDir, { recursive: true });

    // Copy rule templates
    const ruleFiles = ['sprint-checklist.md', 'commit-discipline.md', 'review-loop.md'];
    for (const file of ruleFiles) {
      const src = join(templatesRoot, 'rules', file);
      const dest = join(rulesDir, file);
      if (existsSync(src) && !existsSync(dest)) {
        cpSync(src, dest);
        console.log(`  Created ${dest}`);
      }
    }

    // Copy hook templates
    const hookFiles = ['pre-merge-check.sh'];
    for (const file of hookFiles) {
      const src = join(templatesRoot, 'hooks', file);
      const dest = join(hooksDir, file);
      if (existsSync(src) && !existsSync(dest)) {
        cpSync(src, dest);
        console.log(`  Created ${dest}`);
      }
    }

    console.log('\n  Claude Code templates installed to .claude/rules/ and .claude/hooks/');
  }

  console.log('\nSLOPE initialized. Try:');
  console.log('  slope card');
  console.log('  slope validate');
  console.log('');
}
