import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LoopConfig, ConfigSource, ConfigWithSources } from './types.js';
import { DEFAULT_LOOP_CONFIG, ENV_VAR_MAP } from './types.js';

const CONFIG_FILE = '.slope/loop.config.json';

/** Parse a boolean-like env var value */
function parseBool(val: string): boolean {
  return val === 'true' || val === '1';
}

/** Parse a numeric env var value, returning undefined if invalid */
function parseNum(val: string): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

/** Load file-based config from .slope/loop.config.json */
function loadFileConfig(cwd: string): Partial<LoopConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/** Load env-based overrides. Returns only keys that have env vars set. */
function loadEnvConfig(): Partial<LoopConfig> {
  const result: Partial<LoopConfig> = {};
  for (const [envName, configKey] of Object.entries(ENV_VAR_MAP)) {
    const val = process.env[envName];
    if (val === undefined) continue;
    const defaultVal = DEFAULT_LOOP_CONFIG[configKey];
    if (typeof defaultVal === 'boolean') {
      (result as Record<string, unknown>)[configKey] = parseBool(val);
    } else if (typeof defaultVal === 'number') {
      const n = parseNum(val);
      if (n !== undefined) (result as Record<string, unknown>)[configKey] = n;
    } else {
      (result as Record<string, unknown>)[configKey] = val;
    }
  }
  return result;
}

/**
 * Load loop config with full source tracking.
 * Chain: env vars → .slope/loop.config.json → hardcoded defaults.
 * Env vars have highest priority.
 */
export function loadLoopConfig(cwd: string = process.cwd()): ConfigWithSources {
  const fileConfig = loadFileConfig(cwd);
  const envConfig = loadEnvConfig();

  const config = { ...DEFAULT_LOOP_CONFIG } as LoopConfig;
  const sources = {} as Record<keyof LoopConfig, ConfigSource>;

  for (const key of Object.keys(DEFAULT_LOOP_CONFIG) as (keyof LoopConfig)[]) {
    sources[key] = 'default';

    if (key in fileConfig) {
      (config as unknown as Record<string, unknown>)[key] = (fileConfig as Record<string, unknown>)[key];
      sources[key] = 'file';
    }

    if (key in envConfig) {
      (config as unknown as Record<string, unknown>)[key] = (envConfig as Record<string, unknown>)[key];
      sources[key] = 'env';
    }
  }

  return { config, sources };
}

/** Shorthand: load just the config without sources */
export function resolveLoopConfig(cwd: string = process.cwd()): LoopConfig {
  return loadLoopConfig(cwd).config;
}
