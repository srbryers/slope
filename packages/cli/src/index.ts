#!/usr/bin/env node
/**
 * SLOPE CLI — Sprint Lifecycle & Operational Performance Engine
 *
 * Usage:
 *   slope init                              Initialize .slope/ directory
 *   slope card                              Display handicap card
 *   slope validate [path]                   Validate scorecard(s)
 *   slope review [path] [--plain]           Format sprint review
 *   slope briefing [--sprint=N] [options]    Pre-round briefing
 *   slope plan --complexity=<level>         Pre-shot advisor
 *   slope classify --scope=... ...          Classify a shot
 *   slope claim --target=<t> [--force]       Claim a ticket or area
 *   slope release --id=<id>                 Release a claim
 *   slope status [--sprint=N]               Show sprint course status
 */

import { initCommand } from './commands/init.js';
import { cardCommand } from './commands/card.js';
import { validateCommand } from './commands/validate.js';
import { reviewCommand } from './commands/review.js';
import { briefingCommand } from './commands/briefing.js';
import { planCommand } from './commands/plan.js';
import { classifyCommand } from './commands/classify.js';
import { claimCommand } from './commands/claim.js';
import { releaseCommand } from './commands/release.js';
import { statusCommand } from './commands/status.js';
import { tournamentCommand } from './commands/tournament.js';

const subcommand = process.argv[2];

switch (subcommand) {
  case 'init':
    initCommand(process.argv.slice(3));
    break;
  case 'card':
    cardCommand();
    break;
  case 'validate':
    validateCommand(process.argv[3]);
    break;
  case 'review': {
    const reviewArgs = process.argv.slice(3);
    const plainFlag = reviewArgs.includes('--plain');
    const path = reviewArgs.find((a: string) => !a.startsWith('--'));
    reviewCommand(path, plainFlag ? 'plain' : undefined);
    break;
  }
  case 'briefing':
    briefingCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'plan':
    planCommand(process.argv.slice(3));
    break;
  case 'classify':
    classifyCommand(process.argv.slice(3));
    break;
  case 'claim':
    claimCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'release':
    releaseCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'status':
    statusCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  default:
    console.log(`
SLOPE CLI — Sprint Lifecycle & Operational Performance Engine

Usage:
  slope init [--claude-code]                Initialize .slope/ directory
  slope card                                Show handicap card
  slope validate [path]                     Validate scorecard(s)
  slope review [path] [--plain]             Format sprint review markdown
  slope briefing [--sprint=N] [options]      Pre-round briefing
  slope plan --complexity=<level>           Pre-shot advisor (club + training + hazards)
  slope classify --scope=... ...            Classify a shot from execution trace
  slope claim --target=<t> [--force]        Claim a ticket or area for the sprint
  slope release --id=<id>                   Release a claim by ID
  slope release --target=<t> [--player=<p>] Release a claim by target
  slope status [--sprint=N]                 Show sprint course status + conflicts
  slope tournament --id=<id> [options]      Generate tournament review from scorecards

Examples:
  slope init                                Create .slope/ with config + example scorecard
  slope init --claude-code                  Also install Claude Code rules + hooks
  slope card                                Show handicap across all scorecards
  slope validate docs/retros/sprint-1.json  Validate a specific scorecard
  slope validate                            Validate all scorecards
  slope review                              Review the latest scorecard
  slope review --plain                      Non-technical sprint review
  slope briefing                            Full briefing (top 10 recent gotchas)
  slope briefing --categories=testing       Filter by category
  slope briefing --keywords=migration       Filter by keyword
  slope plan --complexity=medium            Club recommendation for medium ticket
  slope plan --complexity=large --areas=db  Include hazard warnings for db area
  slope classify --scope="a.ts" --modified="a.ts" --tests=pass --reverts=0
  slope briefing --sprint=2                 Briefing for sprint 2
  slope claim --target=S2-1 --sprint=2      Claim ticket S2-1 for sprint 2
  slope claim --target=packages/cli --scope=area  Claim an area
  slope claim --target=S2-1 --force         Claim even if overlap conflict exists
  slope status --sprint=2                   Show all claims for sprint 2
  slope release --target=S2-1               Release your claim on S2-1
`);
    process.exit(subcommand ? 1 : 0);
}
