import { execFileSync } from 'node:child_process';
import type { SlopeConfig } from '../core/index.js';
import { loadConfig } from './config.js';

export type ActorSource =
  | 'override'
  | 'env:SLOPE_ACTOR'
  | 'env:SLOPE_PLAYER'
  | 'config:team.defaultPlayer'
  | 'config:team.players'
  | 'git:user.name'
  | 'env:USER'
  | 'env:USERNAME'
  | 'fallback';

export interface ResolvedActor {
  name: string;
  source: ActorSource;
  isFallback: boolean;
}

export interface ResolveActorOptions {
  explicitActor?: string;
  config?: SlopeConfig;
  env?: NodeJS.ProcessEnv;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'unknown' ? trimmed : null;
}

function teamActor(config: SlopeConfig): { name: string; source: ActorSource } | null {
  const defaultPlayer = clean(config.team?.defaultPlayer);
  const players = config.team?.players ?? {};
  if (defaultPlayer) {
    const displayName = clean(players[defaultPlayer]);
    return {
      name: displayName ? `${defaultPlayer}:${displayName}` : defaultPlayer,
      source: 'config:team.defaultPlayer',
    };
  }

  const entries = Object.entries(players)
    .map(([key, value]) => [clean(key), clean(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]));
  if (entries.length === 1) {
    const [key, displayName] = entries[0];
    return { name: `${key}:${displayName}`, source: 'config:team.players' };
  }

  return null;
}

function gitUserName(cwd: string): string | null {
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (inside !== 'true') return null;
    return clean(execFileSync('git', ['config', 'user.name'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    return null;
  }
}

export function resolveActor(cwd: string = process.cwd(), options: ResolveActorOptions = {}): ResolvedActor {
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfig(cwd);
  const candidates: Array<{ name: string | null; source: ActorSource }> = [
    { name: clean(options.explicitActor), source: 'override' },
    { name: clean(env.SLOPE_ACTOR), source: 'env:SLOPE_ACTOR' },
    { name: clean(env.SLOPE_PLAYER), source: 'env:SLOPE_PLAYER' },
  ];

  const configured = teamActor(config);
  if (configured) candidates.push(configured);

  candidates.push(
    { name: clean(env.USER), source: 'env:USER' },
    { name: clean(env.USERNAME), source: 'env:USERNAME' },
    { name: gitUserName(cwd), source: 'git:user.name' },
  );

  for (const candidate of candidates) {
    if (candidate.name) {
      return { name: candidate.name, source: candidate.source, isFallback: false };
    }
  }

  return { name: 'unknown', source: 'fallback', isFallback: true };
}
