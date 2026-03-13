import { CLI_COMMAND_REGISTRY, CLI_INTERNAL_MODULES } from '../registry.js';
import type { CliCommandMeta } from '../registry.js';

/**
 * slope help [command] — Show detailed per-command usage from the registry.
 */
export async function helpCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
slope help — Command reference

Usage:
  slope help              Show all commands grouped by category
  slope help <command>    Show detailed usage for a command
`);
    return;
  }

  const commandName = args[0];

  if (!commandName) {
    printCategoryList();
    return;
  }

  const meta = CLI_COMMAND_REGISTRY.find(c => c.cmd === commandName);
  if (!meta) {
    suggestClosest(commandName);
    return;
  }

  printCommandDetail(meta);
}

function printCategoryList(): void {
  const categories: Record<string, CliCommandMeta[]> = {};
  for (const cmd of CLI_COMMAND_REGISTRY) {
    if ((CLI_INTERNAL_MODULES as readonly string[]).includes(cmd.cmd)) continue;
    const cat = cmd.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(cmd);
  }

  console.log('\nSLOPE CLI — Command Reference\n');

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
      const name = cmd.cmd === 'index-cmd' ? 'index' : cmd.cmd;
      console.log(`    ${name.padEnd(18)} ${cmd.desc}`);
    }
    console.log('');
  }

  console.log('Run `slope help <command>` for detailed usage.\n');
}

function printCommandDetail(meta: CliCommandMeta): void {
  const displayName = meta.cmd === 'index-cmd' ? 'index' : meta.cmd;
  console.log(`\nslope ${displayName} — ${meta.desc}\n`);
  console.log(`  Category: ${meta.category}\n`);

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
  console.error(`\nRun \`slope help\` to see all commands.`);
  process.exit(1);
}
