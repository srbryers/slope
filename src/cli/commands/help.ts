import { CLI_COMMAND_REGISTRY, CLI_INTERNAL_MODULES } from '../registry.js';
import type { CliCommandAudience, CliCommandMeta } from '../registry.js';

/**
 * slope help [command] - Show human help, full registry, or command details.
 */
export async function helpCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
slope help - Command reference

Usage:
  slope help              Show the bounded human command surface
  slope help <command>    Show detailed usage for a command
  slope help --all        Show all commands grouped by category
`);
    return;
  }

  if (args.includes('--all')) {
    printAllCommandHelp();
    return;
  }

  const commandName = args.find(arg => !arg.startsWith('-'));

  if (!commandName) {
    printDefaultHelp();
    return;
  }

  const meta = CLI_COMMAND_REGISTRY.find(c => c.cmd === commandName);
  if (!meta) {
    suggestClosest(commandName);
    return;
  }

  printCommandDetail(meta);
}

const HUMAN_HELP_ORDER = [
  'now',
  'start',
  'briefing',
  'review',
  'doctor',
  'card',
  'status',
  'roadmap',
  'vision',
  'quickstart',
  'init',
] as const;

const AUDIENCE_LABELS: Record<CliCommandAudience, string> = {
  human: 'human',
  agent: 'agent',
  advanced: 'advanced',
  internal: 'internal',
};

export function printDefaultHelp(): void {
  const byName = new Map(CLI_COMMAND_REGISTRY.map(cmd => [cmd.cmd, cmd]));
  console.log('\nSLOPE - Human Command Surface\n');
  console.log('Daily work:');
  for (const name of HUMAN_HELP_ORDER.slice(0, 8)) {
    const cmd = byName.get(name);
    if (cmd) printCommandRow(cmd, 4);
  }

  console.log('\nSetup and direction:');
  for (const name of HUMAN_HELP_ORDER.slice(8)) {
    const cmd = byName.get(name);
    if (cmd) printCommandRow(cmd, 4);
  }

  console.log('\nAgents and skills use the rest of the CLI as execution primitives.');
  console.log('Run `slope help <command>` for details, or `slope help --all` for the full registry.\n');
}

export function printAllCommandHelp(): void {
  const categories: Record<string, CliCommandMeta[]> = {};
  for (const cmd of CLI_COMMAND_REGISTRY) {
    if ((CLI_INTERNAL_MODULES as readonly string[]).includes(cmd.cmd)) continue;
    const cat = cmd.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(cmd);
  }

  console.log('\nSLOPE CLI - Full Command Reference\n');

  const categoryOrder = ['lifecycle', 'scoring', 'analysis', 'planning', 'tooling'] as const;
  const categoryLabels: Record<string, string> = {
    lifecycle: 'Lifecycle',
    scoring: 'Scoring',
    analysis: 'Analysis',
    planning: 'Planning',
    tooling: 'Tooling',
  };

  for (const cat of categoryOrder) {
    const cmds = categories[cat];
    if (!cmds || cmds.length === 0) continue;

    console.log(`  ${categoryLabels[cat]}:`);
    for (const cmd of cmds) {
      printCommandRow(cmd, 4, true);
    }
    console.log('');
  }

  console.log('Run `slope help` for the bounded human surface, or `slope help <command>` for detailed usage.\n');
}

function printCommandDetail(meta: CliCommandMeta): void {
  const displayName = meta.cmd === 'index-cmd' ? 'index' : meta.cmd;
  console.log(`\nslope ${displayName} - ${meta.desc}\n`);
  console.log(`  Category: ${meta.category}\n`);
  console.log(`  Audience: ${AUDIENCE_LABELS[meta.audience]}\n`);

  if (meta.subcommands && meta.subcommands.length > 0) {
    console.log('  Subcommands:\n');
    for (const sub of meta.subcommands) {
      console.log(`    slope ${displayName} ${sub.name}`);
      console.log(`      ${sub.desc}`);
      if (sub.flags && sub.flags.length > 0) {
        for (const f of sub.flags) {
          console.log(`      ${f.flag.padEnd(24)} ${f.desc}`);
        }
      }
      console.log('');
    }
  }

  if (meta.flags && meta.flags.length > 0) {
    console.log('  Flags:\n');
    for (const f of meta.flags) {
      console.log(`    ${f.flag.padEnd(26)} ${f.desc}`);
    }
    console.log('');
  }
}

function printCommandRow(cmd: CliCommandMeta, indent: number, includeAudience = false): void {
  const name = cmd.cmd === 'index-cmd' ? 'index' : cmd.cmd;
  const prefix = ' '.repeat(indent);
  const audience = includeAudience ? ` [${AUDIENCE_LABELS[cmd.audience]}]` : '';
  console.log(`${prefix}${name.padEnd(14)} ${cmd.desc}${audience}`);
}

function suggestClosest(input: string): void {
  const names = CLI_COMMAND_REGISTRY
    .filter(c => !(CLI_INTERNAL_MODULES as readonly string[]).includes(c.cmd))
    .map(c => c.cmd === 'index-cmd' ? 'index' : c.cmd);

  // Simple substring match for suggestions
  const matches = names.filter(n => n.includes(input) || input.includes(n));

  console.error(`Unknown command: "${input}"`);
  if (matches.length > 0) {
    console.error(`Did you mean: ${matches.join(', ')}?`);
  }
  console.error(`\nRun \`slope help\` for the human surface or \`slope help --all\` for all commands.`);
  process.exit(1);
}
