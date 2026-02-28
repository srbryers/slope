// SLOPE Plugin System
// Discovers and loads custom metaphor and guard plugins from .slope/plugins/

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SlopeConfig } from './config.js';
import { loadConfig, saveConfig } from './config.js';
import { validateMetaphor, registerMetaphor } from './metaphor.js';
import type { MetaphorDefinition } from './metaphor.js';
import { registerCustomGuard } from './guard.js';
import type { CustomGuardDefinition } from './guard.js';

// --- Types ---

export type PluginType = 'metaphor' | 'guard';

export interface PluginManifest {
  type: PluginType;
  id: string;
  name: string;
  version?: string;
  description?: string;
}

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  filePath: string;
}

export interface PluginLoadResult {
  loaded: DiscoveredPlugin[];
  errors: Array<{ filePath: string; error: string }>;
}

export interface PluginsConfig {
  enabled?: string[];
  disabled?: string[];
}

// --- Validation ---

export function validatePluginManifest(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Plugin manifest must be an object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.type || (obj.type !== 'metaphor' && obj.type !== 'guard')) {
    errors.push('Missing or invalid "type" (must be "metaphor" or "guard")');
  }
  if (!obj.id || typeof obj.id !== 'string') {
    errors.push('Missing or invalid "id" (must be a non-empty string)');
  }
  if (!obj.name || typeof obj.name !== 'string') {
    errors.push('Missing or invalid "name" (must be a non-empty string)');
  }

  return { valid: errors.length === 0, errors };
}

// --- Discovery ---

export function discoverPlugins(cwd: string): DiscoveredPlugin[] {
  const plugins: DiscoveredPlugin[] = [];
  const seen = new Set<string>();

  const dirs: Array<{ dir: string; type: PluginType }> = [
    { dir: join(cwd, '.slope', 'plugins', 'metaphors'), type: 'metaphor' },
    { dir: join(cwd, '.slope', 'plugins', 'guards'), type: 'guard' },
  ];

  for (const { dir, type } of dirs) {
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(dir, file);

      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        // Infer type from directory if not specified in file
        if (!raw.type) raw.type = type;
        const { valid } = validatePluginManifest(raw);
        if (!valid) continue;

        // For metaphors, use the metaphor's id field; for guards, use name field
        const id = type === 'guard' ? (raw.name as string) : (raw.id as string);
        if (seen.has(`${type}:${id}`)) continue;
        seen.add(`${type}:${id}`);

        plugins.push({
          manifest: {
            type: raw.type ?? type,
            id: raw.id,
            name: raw.name,
            version: raw.version,
            description: raw.description,
          },
          filePath,
        });
      } catch { /* skip unparseable files */ }
    }
  }

  return plugins;
}

// --- Config filtering ---

export function isPluginEnabled(id: string, config?: PluginsConfig): boolean {
  if (!config) return true;

  // Disabled list takes priority
  if (config.disabled?.includes(id)) return false;

  // If enabled list exists, only those are allowed
  if (config.enabled && config.enabled.length > 0) {
    return config.enabled.includes(id);
  }

  return true;
}

// --- Type-specific loaders ---

export function loadPluginMetaphors(cwd: string, config?: PluginsConfig): PluginLoadResult {
  const result: PluginLoadResult = { loaded: [], errors: [] };
  const dir = join(cwd, '.slope', 'plugins', 'metaphors');
  if (!existsSync(dir)) return result;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(dir, file);

    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));

      if (!raw.id || typeof raw.id !== 'string') {
        result.errors.push({ filePath, error: 'Missing "id" field' });
        continue;
      }

      if (!isPluginEnabled(raw.id, config)) continue;

      const metaphor = raw as MetaphorDefinition;
      const validationErrors = validateMetaphor(metaphor);
      if (validationErrors.length > 0) {
        result.errors.push({ filePath, error: validationErrors.join('; ') });
        continue;
      }

      registerMetaphor(metaphor);
      result.loaded.push({
        manifest: { type: 'metaphor', id: metaphor.id, name: metaphor.name, version: raw.version, description: metaphor.description },
        filePath,
      });
    } catch (err) {
      result.errors.push({ filePath, error: (err as Error).message });
    }
  }

  return result;
}

export function loadPluginGuards(cwd: string, config?: PluginsConfig): PluginLoadResult {
  const result: PluginLoadResult = { loaded: [], errors: [] };
  const dir = join(cwd, '.slope', 'plugins', 'guards');
  if (!existsSync(dir)) return result;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(dir, file);

    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));

      if (!raw.name || typeof raw.name !== 'string') {
        result.errors.push({ filePath, error: 'Missing "name" field' });
        continue;
      }
      if (!raw.hookEvent || typeof raw.hookEvent !== 'string') {
        result.errors.push({ filePath, error: 'Missing "hookEvent" field' });
        continue;
      }
      if (!raw.command || typeof raw.command !== 'string') {
        result.errors.push({ filePath, error: 'Missing "command" field' });
        continue;
      }
      if (!raw.level || (raw.level !== 'scoring' && raw.level !== 'full')) {
        result.errors.push({ filePath, error: 'Missing or invalid "level" (must be "scoring" or "full")' });
        continue;
      }

      if (!isPluginEnabled(raw.name, config)) continue;

      const guard: CustomGuardDefinition = {
        name: raw.name,
        description: raw.description ?? '',
        hookEvent: raw.hookEvent,
        matcher: raw.matcher,
        level: raw.level,
        command: raw.command,
      };

      registerCustomGuard(guard);
      result.loaded.push({
        manifest: { type: 'guard', id: raw.name, name: raw.name, version: raw.version, description: raw.description },
        filePath,
      });
    } catch (err) {
      result.errors.push({ filePath, error: (err as Error).message });
    }
  }

  return result;
}

// --- Custom Metaphor Save ---

export interface SaveMetaphorResult {
  filePath: string;
  registered: boolean;
  activated: boolean;
  errors: string[];
}

const BUILTIN_IDS = ['golf', 'tennis', 'baseball', 'gaming', 'dnd', 'matrix', 'agile'];
const METAPHOR_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Validate, save, register, and optionally activate a custom metaphor.
 * Writes to .slope/plugins/metaphors/<id>.json and registers in-memory.
 */
export function saveCustomMetaphor(
  definition: MetaphorDefinition,
  cwd: string = process.cwd(),
  setActive: boolean = false,
): SaveMetaphorResult {
  // Validate ID format
  if (!definition.id || !METAPHOR_ID_PATTERN.test(definition.id)) {
    return {
      filePath: '',
      registered: false,
      activated: false,
      errors: [`Invalid metaphor ID "${definition.id}". Must match ${METAPHOR_ID_PATTERN} (lowercase, starts with letter).`],
    };
  }

  // Reject built-in ID collision
  if (BUILTIN_IDS.includes(definition.id)) {
    return {
      filePath: '',
      registered: false,
      activated: false,
      errors: [`Cannot overwrite built-in metaphor "${definition.id}". Choose a different ID.`],
    };
  }

  // Validate completeness
  const validationErrors = validateMetaphor(definition);
  if (validationErrors.length > 0) {
    return {
      filePath: '',
      registered: false,
      activated: false,
      errors: validationErrors,
    };
  }

  // Write to .slope/plugins/metaphors/<id>.json
  const dir = join(cwd, '.slope', 'plugins', 'metaphors');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${definition.id}.json`);
  const fileContent = { type: 'metaphor' as const, ...definition };
  writeFileSync(filePath, JSON.stringify(fileContent, null, 2) + '\n');

  // Register in-memory
  registerMetaphor(definition);

  // Optionally activate
  if (setActive) {
    const config = loadConfig(cwd);
    saveConfig({ ...config, metaphor: definition.id }, cwd);
  }

  return {
    filePath,
    registered: true,
    activated: setActive,
    errors: [],
  };
}

// --- Main loader ---

export function loadPlugins(cwd: string, config?: PluginsConfig): PluginLoadResult {
  const metaphors = loadPluginMetaphors(cwd, config);
  const guards = loadPluginGuards(cwd, config);

  return {
    loaded: [...metaphors.loaded, ...guards.loaded],
    errors: [...metaphors.errors, ...guards.errors],
  };
}
