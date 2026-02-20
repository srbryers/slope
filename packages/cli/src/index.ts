#!/usr/bin/env node
/**
 * SLOPE CLI — Sprint Lifecycle & Operational Performance Engine
 *
 * Usage:
 *   slope init                              Initialize .slope/ directory
 *   slope card                              Display handicap card
 *   slope validate [path]                   Validate scorecard(s)
 *   slope review [path] [--plain]           Format sprint review
 *   slope briefing [options]                Pre-round briefing
 *   slope plan --complexity=<level>         Pre-shot advisor
 *   slope classify --scope=... ...          Classify a shot
 */

import { initCommand } from './commands/init.js';
import { cardCommand } from './commands/card.js';
import { validateCommand } from './commands/validate.js';
import { reviewCommand } from './commands/review.js';
import { briefingCommand } from './commands/briefing.js';
import { planCommand } from './commands/plan.js';
import { classifyCommand } from './commands/classify.js';

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
    briefingCommand(process.argv.slice(3));
    break;
  case 'plan':
    planCommand(process.argv.slice(3));
    break;
  case 'classify':
    classifyCommand(process.argv.slice(3));
    break;
  default:
    console.log(`
SLOPE CLI — Sprint Lifecycle & Operational Performance Engine

Usage:
  slope init [--claude-code]                Initialize .slope/ directory
  slope card                                Show handicap card
  slope validate [path]                     Validate scorecard(s)
  slope review [path] [--plain]             Format sprint review markdown
  slope briefing [options]                  Pre-round briefing
  slope plan --complexity=<level>           Pre-shot advisor (club + training + hazards)
  slope classify --scope=... ...            Classify a shot from execution trace

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
`);
    process.exit(subcommand ? 1 : 0);
}
