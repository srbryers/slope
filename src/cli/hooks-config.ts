import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface HooksConfig {
  installed: Record<string, { provider: string; installed_at: string }>;
}

const HOOKS_CONFIG_FILE = '.slope/hooks.json';

export function loadHooksConfig(cwd: string): HooksConfig {
  const configPath = join(cwd, HOOKS_CONFIG_FILE);
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
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, HOOKS_CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
}
