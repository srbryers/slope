import { formatSprintNumber, parseSprintNumber } from '../../core/index.js';
import { briefingCommand } from './briefing.js';
import { sprintCommand } from './sprint.js';
import { loadConfig } from '../config.js';
import { formatNoGitModeWarning, requireGitWorkTreeOrExplicitNoGit } from '../git-preflight.js';
import { inferSprintContext } from '../sprint-inference.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

function resolveSprint(flags: Record<string, string>): number {
  if (flags.sprint) {
    const parsed = parseSprintNumber(flags.sprint);
    if (parsed == null) {
      console.error(`Invalid sprint number: ${flags.sprint}`);
      process.exit(1);
    }
    return parsed;
  }
  return inferSprintContext(process.cwd(), loadConfig(process.cwd())).sprint;
}

function printUsage(): void {
  console.log(`
slope start - Human start-of-work cockpit

Usage:
  slope start [--sprint=N] [--allow-no-git]
  slope start --ticket=KEY [--sprint=N] [--allow-no-git]

Without --ticket, starts or refreshes sprint state and prints a compact briefing.
With --ticket, runs the bundled begin flow: sprint state, claim, briefing, prep, and next gates.
Use --allow-no-git only for degraded projects where commit-backed completion evidence is unavailable.
`);
}

export async function startCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const gitPreflight = requireGitWorkTreeOrExplicitNoGit('start', args, process.cwd());
  if (gitPreflight.degradedNoGitMode) {
    console.warn(formatNoGitModeWarning('start'));
  }

  const flags = parseArgs(args);
  const sprint = resolveSprint(flags);
  const sprintText = formatSprintNumber(sprint);
  const ticket = flags.ticket;

  if (ticket) {
    await sprintCommand(['begin', `--sprint=${sprintText}`, `--ticket=${ticket}`]);
    return;
  }

  await sprintCommand(['start', `--number=${sprintText}`, '--phase=implementing']);
  console.log('\nBriefing');
  console.log('='.repeat(32));
  await briefingCommand([`--sprint=${sprintText}`, '--compact']);
  console.log(`Next: run slope start --ticket=<key> to claim work, or slope now to inspect the cockpit.\n`);
}
