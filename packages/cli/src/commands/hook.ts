import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadHooksConfig, saveHooksConfig } from '../hooks-config.js';
import { GUARD_DEFINITIONS, getAllGuardDefinitions, generateClaudeCodeHooksConfig, loadPluginGuards, loadConfig } from '@slope-dev/core';
import type { AnyGuardDefinition } from '@slope-dev/core';

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
        installGuardHooks(cwd, flags.level as 'scoring' | 'full');
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
  slope hook add <name>           Install a hook from the catalog
  slope hook remove <name>        Remove an installed hook
  slope hook list [--available]   Show installed hooks (or full catalog)
  slope hook show <name>          Display hook file contents

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

function installGuardHooks(cwd: string, level: 'scoring' | 'full'): void {
  const provider = detectProvider(cwd);

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

  if (provider === 'claude-code') {
    installClaudeCodeGuards(cwd, guards);
  } else {
    console.log(`\n  Guard hooks for ${provider} are not yet supported.`);
    console.log('  Guards are currently available for Claude Code.\n');
  }
}

function installClaudeCodeGuards(cwd: string, guards: AnyGuardDefinition[]): void {
  const hooksDir = join(cwd, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  // Create the guard dispatcher script
  const dispatcherPath = join(hooksDir, 'slope-guard.sh');
  if (!existsSync(dispatcherPath)) {
    const script = [
      '#!/usr/bin/env bash',
      '# SLOPE guard dispatcher — routes hook events to slope guard handlers',
      '# Auto-generated by slope hook add --level=full',
      '',
      '# === SLOPE MANAGED (do not edit above this line) ===',
      'slope guard "$@" < /dev/stdin',
      '# === SLOPE END ===',
      '',
    ].join('\n');
    writeFileSync(dispatcherPath, script, { mode: 0o755 });
    console.log(`  Created ${dispatcherPath}`);
  }

  // Generate the hooks config for .claude/settings.json
  const guardScript = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/slope-guard.sh';
  const hooksConfig = generateClaudeCodeHooksConfig(guards, guardScript);

  // Read and merge into .claude/settings.json
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch { /* start fresh */ }
  }

  // Merge hooks — preserve existing non-SLOPE hooks
  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  for (const [event, entries] of Object.entries(hooksConfig)) {
    if (!existingHooks[event]) {
      existingHooks[event] = [];
    }
    // Add SLOPE guard entries (avoid duplicates by checking command)
    for (const entry of entries) {
      const existing = (existingHooks[event] as Array<{ hooks?: Array<{ command?: string }> }>);
      const isDuplicate = existing.some(e =>
        e.hooks?.some(h => h.command?.includes('slope-guard.sh')),
      );
      if (!isDuplicate) {
        existingHooks[event].push(entry);
      }
    }
  }
  settings.hooks = existingHooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  Updated ${settingsPath} with guard hooks`);

  // Update hooks registry
  const config = loadHooksConfig(cwd);
  for (const g of guards) {
    config.installed[`guard-${g.name}`] = {
      provider: 'claude-code',
      installed_at: new Date().toISOString(),
    };
  }
  saveHooksConfig(cwd, config);

  console.log(`\n  Installed ${guards.length} guard hooks (level: ${guards.some(g => g.level === 'full') ? 'full' : 'scoring'}):`);
  for (const g of guards) {
    console.log(`    ${g.name.padEnd(16)} [${g.hookEvent}] ${g.description}`);
  }
  console.log('');
}
