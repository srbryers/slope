import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadHooksConfig, saveHooksConfig } from '../hooks-config.js';
import { getAllGuardDefinitions, loadPluginGuards, loadConfig, detectAdapter, getAdapter, listAdapters } from '../../core/index.js';
import type { AnyGuardDefinition, HarnessId } from '../../core/index.js';
// Import to trigger auto-registration of adapters
import '../../core/adapters/claude-code.js';
import '../../core/adapters/generic.js';

const HOOK_TEMPLATES: Record<string, { description: string; managed: string[] }> = {
  'session-start': {
    description: 'Start a SLOPE session and show a compact briefing',
    managed: ['slope session start --ide="$SLOPE_IDE" --role=primary', 'slope briefing --compact'],
  },
  'session-end': {
    description: 'End the current SLOPE session',
    managed: ['slope session end --session-id="$SLOPE_SESSION_ID"'],
  },
  'session-end-events': {
    description: 'Extract session events on session end',
    managed: [
      '# Extract structured events from this session',
      'if [ -n "$SLOPE_SESSION_EVENTS" ] && [ -f "$SLOPE_SESSION_EVENTS" ]; then',
      '  slope extract --file="$SLOPE_SESSION_EVENTS" --session-id="$SLOPE_SESSION_ID"',
      'fi',
    ],
  },
  'pre-commit': {
    description: 'Run checks before committing',
    managed: ['# Branch naming check (if configured)'],
  },
  'pre-merge': {
    description: 'Validate scorecard before merging a sprint PR',
    managed: ['slope validate "$1"'],
  },
  'post-sprint': {
    description: 'Auto-generate scorecard after sprint completion',
    managed: ['slope auto-card --sprint="$1" --dry-run'],
  },
};

type Provider = 'claude-code' | 'cursor';

function detectProvider(cwd: string): Provider {
  if (existsSync(join(cwd, '.claude'))) return 'claude-code';
  if (existsSync(join(cwd, '.cursor'))) return 'cursor';
  return 'claude-code'; // default
}

function getHooksDir(cwd: string, provider: Provider): string {
  switch (provider) {
    case 'claude-code': return join(cwd, '.claude', 'hooks');
    case 'cursor': return join(cwd, '.cursor', 'hooks');
  }
}

function hookFilePath(cwd: string, provider: Provider, name: string): string {
  return join(getHooksDir(cwd, provider), `slope-${name}.sh`);
}

function generateHookScript(name: string): string {
  const template = HOOK_TEMPLATES[name];
  if (!template) throw new Error(`Unknown hook: ${name}`);

  const lines = [
    '#!/usr/bin/env bash',
    `# SLOPE hook: ${name}`,
    `# ${template.description}`,
    '',
    '# === SLOPE MANAGED (do not edit above this line) ===',
    ...template.managed,
    '# === SLOPE END ===',
    '',
    '# Add your custom commands below:',
    '',
  ];
  return lines.join('\n');
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export async function hookCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const hookName = args[1];
  const flags = parseArgs(args.slice(1));
  const cwd = process.cwd();

  switch (sub) {
    case 'add':
      if (flags.level === 'full' || flags.level === 'scoring') {
        installGuardHooks(cwd, flags.level as 'scoring' | 'full', flags.harness as HarnessId | undefined);
      } else {
        addHook(hookName, cwd);
      }
      break;
    case 'remove':
      removeHook(hookName, cwd);
      break;
    case 'list':
      listHooks(cwd, flags.available === 'true');
      break;
    case 'show':
      showHook(hookName, cwd);
      break;
    default:
      console.log(`
slope hook — Manage SLOPE lifecycle hooks

Usage:
  slope hook add <name>                         Install a hook from the catalog
  slope hook add --level=full [--harness=<id>]  Install guard hooks (auto-detect or specify harness)
  slope hook remove <name>                      Remove an installed hook
  slope hook list [--available]                  Show installed hooks (or full catalog)
  slope hook show <name>                        Display hook file contents

Harness adapters: ${listAdapters().join(', ') || '(none registered)'}

Available hooks:
${Object.entries(HOOK_TEMPLATES).map(([k, v]) => `  ${k.padEnd(20)} ${v.description}`).join('\n')}
`);
      if (sub) process.exit(1);
  }
}

function addHook(name: string, cwd: string): void {
  if (!name) {
    console.error('Error: hook name is required. Run "slope hook list --available" to see options.');
    process.exit(1);
  }
  if (!HOOK_TEMPLATES[name]) {
    console.error(`Error: unknown hook "${name}". Available: ${Object.keys(HOOK_TEMPLATES).join(', ')}`);
    process.exit(1);
  }

  const provider = detectProvider(cwd);
  const dir = getHooksDir(cwd, provider);
  mkdirSync(dir, { recursive: true });

  const filePath = hookFilePath(cwd, provider, name);
  if (existsSync(filePath)) {
    console.error(`Hook "${name}" already installed at ${filePath}`);
    console.error('Remove it first with: slope hook remove ' + name);
    process.exit(1);
  }

  const script = generateHookScript(name);
  writeFileSync(filePath, script, { mode: 0o755 });

  const config = loadHooksConfig(cwd);
  config.installed[name] = { provider, installed_at: new Date().toISOString() };
  saveHooksConfig(cwd, config);

  console.log(`\nInstalled hook: ${name}`);
  console.log(`  File: ${filePath}`);
  console.log(`  Provider: ${provider}`);
  console.log(`\nEdit the file to add custom commands below the SLOPE END marker.\n`);
}

function removeHook(name: string, cwd: string): void {
  if (!name) {
    console.error('Error: hook name is required');
    process.exit(1);
  }

  const config = loadHooksConfig(cwd);
  const entry = config.installed[name];
  if (!entry) {
    console.error(`Hook "${name}" is not installed.`);
    process.exit(1);
  }

  const filePath = hookFilePath(cwd, entry.provider as Provider, name);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  delete config.installed[name];
  saveHooksConfig(cwd, config);

  console.log(`Removed hook: ${name}\n`);
}

function listHooks(cwd: string, showAvailable: boolean): void {
  if (showAvailable) {
    console.log('\nAvailable hooks:\n');
    for (const [name, template] of Object.entries(HOOK_TEMPLATES)) {
      const config = loadHooksConfig(cwd);
      const installed = config.installed[name] ? ' [installed]' : '';
      console.log(`  ${name.padEnd(20)} ${template.description}${installed}`);
    }
    console.log('');
    return;
  }

  const config = loadHooksConfig(cwd);
  const names = Object.keys(config.installed);
  if (names.length === 0) {
    console.log('\nNo hooks installed. Run "slope hook list --available" to see options.\n');
    return;
  }

  console.log(`\nInstalled hooks (${names.length}):\n`);
  for (const name of names) {
    const entry = config.installed[name];
    console.log(`  ${name.padEnd(20)} provider: ${entry.provider}  installed: ${entry.installed_at}`);
  }
  console.log('');
}

function showHook(name: string, cwd: string): void {
  if (!name) {
    console.error('Error: hook name is required');
    process.exit(1);
  }

  const config = loadHooksConfig(cwd);
  const entry = config.installed[name];

  if (entry) {
    const filePath = hookFilePath(cwd, entry.provider as Provider, name);
    if (existsSync(filePath)) {
      console.log(`\n--- ${filePath} ---\n`);
      console.log(readFileSync(filePath, 'utf8'));
      return;
    }
  }

  // Not installed — show template preview
  if (HOOK_TEMPLATES[name]) {
    console.log(`\n--- Template: ${name} (not installed) ---\n`);
    console.log(generateHookScript(name));
    return;
  }

  console.error(`Unknown hook: "${name}"`);
  process.exit(1);
}

function installGuardHooks(cwd: string, level: 'scoring' | 'full', harnessId?: HarnessId): void {
  // Load custom guard plugins
  const config = loadConfig(cwd);
  loadPluginGuards(cwd, config.plugins);

  // Filter guards by level (includes custom guards)
  const guards = getAllGuardDefinitions().filter(g =>
    level === 'full' || g.level === 'scoring',
  );

  if (guards.length === 0) {
    console.log('\n  No guards to install for this level.\n');
    return;
  }

  // Resolve adapter: explicit --harness flag, auto-detect, or error
  let adapter;
  if (harnessId) {
    adapter = getAdapter(harnessId);
    if (!adapter) {
      const available = listAdapters().join(', ');
      console.error(`\n  Unknown harness: "${harnessId}". Available: ${available}\n`);
      process.exit(1);
    }
  } else {
    adapter = detectAdapter(cwd);
  }
  if (!adapter) {
    console.log('\n  No harness adapter detected.');
    console.log('  Use --harness=<id> to specify one. Available: ' + listAdapters().join(', ') + '\n');
    return;
  }

  // Delegate installation to the adapter
  adapter.installGuards(cwd, guards);

  // Update hooks registry
  const hooksConfig = loadHooksConfig(cwd);
  for (const g of guards) {
    hooksConfig.installed[`guard-${g.name}`] = {
      provider: adapter.id,
      installed_at: new Date().toISOString(),
    };
  }
  saveHooksConfig(cwd, hooksConfig);

  console.log(`\n  Installed ${guards.length} guard hooks (level: ${guards.some(g => g.level === 'full') ? 'full' : 'scoring'}):`);
  for (const g of guards) {
    console.log(`    ${g.name.padEnd(16)} [${g.hookEvent}] ${g.description}`);
  }
  console.log('');
}
