// SLOPE CLI — slope metaphor (list | set | show)
// Manage metaphor display themes.

import { loadConfig, saveConfig, loadPluginMetaphors, listMetaphors, hasMetaphor, getMetaphor } from '../../core/index.js';
// Ensure built-in metaphors are registered
import '../../core/metaphors/index.js';

const BUILTIN_IDS = ['golf', 'tennis', 'baseball', 'gaming', 'dnd', 'matrix', 'agile'];

export async function metaphorCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const cwd = process.cwd();

  // Load custom plugins so they appear in list/set/show
  const config = loadConfig(cwd);
  loadPluginMetaphors(cwd, config.plugins);

  switch (sub) {
    case 'list':
      listSubcommand(config.metaphor);
      break;
    case 'set': {
      const id = args[1];
      if (!id) {
        console.error('Usage: slope metaphor set <id>');
        process.exit(1);
      }
      setSubcommand(id, cwd);
      break;
    }
    case 'show': {
      const id = args[1];
      if (!id) {
        console.error('Usage: slope metaphor show <id>');
        process.exit(1);
      }
      showSubcommand(id);
      break;
    }
    default:
      console.log(`
slope metaphor — Manage metaphor display themes

Usage:
  slope metaphor list           Show all available metaphors
  slope metaphor set <id>       Set the active metaphor
  slope metaphor show <id>      Show all terms for a metaphor
`);
      if (sub) {
        console.error(`Unknown subcommand "${sub}"`);
        process.exit(1);
      }
      break;
  }
}

function listSubcommand(activeId: string): void {
  const all = listMetaphors();
  console.log('\nAvailable metaphors:\n');

  for (const m of all) {
    const active = m.id === activeId ? '[active] ' : '         ';
    const custom = !BUILTIN_IDS.includes(m.id) ? ' [custom]' : '';
    console.log(`  ${active}${m.id.padEnd(12)} ${m.name.padEnd(14)} ${m.description}${custom}`);
  }
  console.log('');
}

function setSubcommand(id: string, cwd: string): void {
  if (!hasMetaphor(id)) {
    const available = listMetaphors().map(m => m.id).join(', ');
    console.error(`Unknown metaphor "${id}". Available: ${available}`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  saveConfig({ ...config, metaphor: id }, cwd);
  console.log(`Metaphor set to "${id}". Restart your AI agent to see the change.`);
}

function showSubcommand(id: string): void {
  if (!hasMetaphor(id)) {
    const available = listMetaphors().map(m => m.id).join(', ');
    console.error(`Unknown metaphor "${id}". Available: ${available}`);
    process.exit(1);
  }

  const m = getMetaphor(id);
  console.log(`\nMetaphor: ${m.name}\n${m.description}\n`);

  const sections: Array<{ label: string; entries: object }> = [
    { label: 'Vocabulary', entries: m.vocabulary },
    { label: 'Clubs', entries: m.clubs },
    { label: 'Shot Results', entries: m.shotResults },
    { label: 'Hazards', entries: m.hazards },
    { label: 'Conditions', entries: m.conditions },
    { label: 'Special Plays', entries: m.specialPlays },
    { label: 'Miss Directions', entries: m.missDirections },
    { label: 'Score Labels', entries: m.scoreLabels },
    { label: 'Sprint Types', entries: m.sprintTypes },
    { label: 'Training Types', entries: m.trainingTypes },
    { label: 'Nutrition', entries: m.nutrition },
  ];

  for (const { label, entries } of sections) {
    console.log(`${label}:`);
    for (const [key, value] of Object.entries(entries)) {
      console.log(`  ${key.padEnd(20)} → ${value}`);
    }
    console.log('');
  }
}
