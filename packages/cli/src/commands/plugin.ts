import { readFileSync, existsSync } from 'node:fs';
import {
  listMetaphors,
  GUARD_DEFINITIONS,
  getAllGuardDefinitions,
  validatePluginManifest,
  validateMetaphor,
  loadPluginMetaphors,
  loadPluginGuards,
  discoverPlugins,
} from '@srbryers/core';
import type { MetaphorDefinition } from '@srbryers/core';
import { loadConfig } from '../config.js';

export async function pluginCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'list':
      listPlugins();
      break;
    case 'validate':
      validatePlugin(args[1]);
      break;
    default:
      printUsage();
      if (sub) process.exit(1);
  }
}

function listPlugins(): void {
  const cwd = process.cwd();
  const config = loadConfig();

  // Load custom plugins
  const metaphorResult = loadPluginMetaphors(cwd, config.plugins);
  const guardResult = loadPluginGuards(cwd, config.plugins);

  // Built-in metaphors
  const builtinMetaphorIds = ['golf', 'tennis', 'baseball', 'gaming', 'dnd', 'matrix'];
  const builtinGuardNames: string[] = GUARD_DEFINITIONS.map(d => d.name);

  console.log('\nSLOPE Plugins:\n');

  // Metaphors
  console.log('  Metaphors:');
  for (const m of listMetaphors()) {
    const isCustom = !builtinMetaphorIds.includes(m.id);
    const tag = isCustom ? ' [custom]' : '';
    console.log(`    ${m.id.padEnd(16)} ${m.name}${tag}`);
  }

  // Guards
  console.log('\n  Guards:');
  const allGuards = getAllGuardDefinitions();
  for (const g of allGuards) {
    const isCustom = !builtinGuardNames.includes(g.name);
    const tag = isCustom ? ' [custom]' : '';
    console.log(`    ${g.name.padEnd(16)} [${g.hookEvent}] ${g.description}${tag}`);
  }

  // Errors
  const allErrors = [...metaphorResult.errors, ...guardResult.errors];
  if (allErrors.length > 0) {
    console.log('\n  Errors:');
    for (const err of allErrors) {
      console.log(`    ${err.filePath}: ${err.error}`);
    }
  }

  console.log('');
}

function validatePlugin(path: string | undefined): void {
  if (!path) {
    console.error('Error: path is required. Usage: slope plugin validate <path>');
    process.exit(1);
  }

  if (!existsSync(path)) {
    console.error(`Error: file not found: ${path}`);
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error(`Error: invalid JSON in ${path}`);
    process.exit(1);
  }

  const obj = raw as Record<string, unknown>;

  // Check manifest fields
  const manifest = validatePluginManifest(raw);
  if (!manifest.valid) {
    console.log(`\nValidation FAILED for ${path}:\n`);
    for (const err of manifest.errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }

  // Type-specific validation
  const errors: string[] = [];
  if (obj.type === 'metaphor') {
    const metaphorErrors = validateMetaphor(raw as MetaphorDefinition);
    errors.push(...metaphorErrors);
  } else if (obj.type === 'guard') {
    if (!obj.hookEvent) errors.push('Missing "hookEvent"');
    if (!obj.command) errors.push('Missing "command"');
    if (!obj.level || (obj.level !== 'scoring' && obj.level !== 'full')) {
      errors.push('Missing or invalid "level" (must be "scoring" or "full")');
    }
  }

  if (errors.length > 0) {
    console.log(`\nValidation FAILED for ${path}:\n`);
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`\nValid ${obj.type} plugin: ${obj.name ?? obj.id} (${path})\n`);
}

function printUsage(): void {
  console.log(`
slope plugin — Manage SLOPE plugins

Usage:
  slope plugin list               Show all plugins (built-in + custom)
  slope plugin validate <path>    Validate a plugin file

Plugin directories:
  .slope/plugins/metaphors/       Custom metaphor definitions (JSON)
  .slope/plugins/guards/          Custom guard definitions (JSON)
`);
}
