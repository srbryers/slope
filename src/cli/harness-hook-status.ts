import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ActiveHarnessGuardShim {
  provider: 'codex';
  scope: 'project' | 'user';
  configPath: string;
  guardCount: number;
}

type HookCommand = { command?: unknown };
type HookGroup = { hooks?: unknown };

function resolveCodexHome(): string {
  const override = process.env.SLOPE_CODEX_HOME ?? process.env.CODEX_HOME;
  return override && override.trim().length > 0 ? resolve(override.trim()) : join(homedir(), '.codex');
}

function collectCodexGuardNames(filePath: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(filePath)) return names;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return names;
  }

  if (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) return names;

  for (const groups of Object.values(parsed.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as HookGroup[]) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks as HookCommand[]) {
        const command = typeof hook?.command === 'string' ? hook.command : '';
        if (!command.includes('slope-guard.sh')) continue;
        const match = command.match(/slope-guard\.sh"?\s+([^\s"']+)/);
        names.add(match?.[1] ?? command);
      }
    }
  }

  return names;
}

export function detectActiveHarnessGuardShims(cwd: string): ActiveHarnessGuardShim[] {
  const candidates: ActiveHarnessGuardShim[] = [];
  const projectHooksPath = join(cwd, '.codex', 'hooks.json');
  const userHooksPath = join(resolveCodexHome(), 'hooks.json');

  for (const item of [
    { scope: 'project' as const, configPath: projectHooksPath },
    { scope: 'user' as const, configPath: userHooksPath },
  ]) {
    const guardCount = collectCodexGuardNames(item.configPath).size;
    if (guardCount > 0) {
      candidates.push({ provider: 'codex', scope: item.scope, configPath: item.configPath, guardCount });
    }
  }

  return candidates;
}

