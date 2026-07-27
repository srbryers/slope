import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveRepoStatePath } from '../core/repo-state-scope.js';

export interface HooksConfig {
  installed: Record<string, { provider: string; installed_at: string }>;
}

const HOOKS_CONFIG_FILE = '.slope/hooks.json';

export function loadHooksConfig(cwd: string): HooksConfig {
  const configPath = resolveRepoStatePath(cwd, HOOKS_CONFIG_FILE);
  if (!existsSync(configPath)) {
    return { installed: {} };
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as HooksConfig;
  } catch {
    return { installed: {} };
  }
}

export function saveHooksConfig(cwd: string, config: HooksConfig): void {
  const configPath = resolveRepoStatePath(cwd, HOOKS_CONFIG_FILE);
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
