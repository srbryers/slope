import { execFileSync } from 'node:child_process';
import type { SlopeConfig, SprintConflict } from '../core/index.js';
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
  displayName: string;
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

function environmentActorDisplayName(source: ActorSource): string {
  return `environment actor (${source})`;
}

function resolvedActor(name: string, source: ActorSource): ResolvedActor {
  return {
    name,
    displayName: source.startsWith('env:') ? environmentActorDisplayName(source) : name,
    source,
    isFallback: false,
  };
}

export function resolveActor(cwd: string = process.cwd(), options: ResolveActorOptions = {}): ResolvedActor {
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfig(cwd);

  const explicitActor = clean(options.explicitActor);
  if (explicitActor) return resolvedActor(explicitActor, 'override');

  const slopeActor = clean(env.SLOPE_ACTOR);
  if (slopeActor) return {
    name: slopeActor,
    displayName: environmentActorDisplayName('env:SLOPE_ACTOR'),
    source: 'env:SLOPE_ACTOR',
    isFallback: false,
  };

  const slopePlayer = clean(env.SLOPE_PLAYER);
  if (slopePlayer) return {
    name: slopePlayer,
    displayName: environmentActorDisplayName('env:SLOPE_PLAYER'),
    source: 'env:SLOPE_PLAYER',
    isFallback: false,
  };

  const configured = teamActor(config);
  if (configured) return resolvedActor(configured.name, configured.source);

  const user = clean(env.USER);
  if (user) return {
    name: user,
    displayName: environmentActorDisplayName('env:USER'),
    source: 'env:USER',
    isFallback: false,
  };

  const username = clean(env.USERNAME);
  if (username) return {
    name: username,
    displayName: environmentActorDisplayName('env:USERNAME'),
    source: 'env:USERNAME',
    isFallback: false,
  };

  const gitName = gitUserName(cwd);
  if (gitName) {
    return resolvedActor(gitName, 'git:user.name');
  }

  return { name: 'unknown', displayName: 'unknown', source: 'fallback', isFallback: true };
}

export function formatActorName(actor: ResolvedActor): string {
  return actor.displayName;
}

export function formatActorSource(actor: ResolvedActor): string {
  return actor.isFallback ? 'fallback (unknown)' : actor.source;
}

export function formatConflictSummary(conflict: SprintConflict): string {
  const [a, b] = conflict.claims;
  if (!a || !b) return 'Claim conflict detected';

  if (conflict.severity === 'overlap') {
    if (a.target === b.target) {
      return `Target "${a.target}" is already claimed by another player`;
    }
    return `Claim overlap between "${a.target}" and "${b.target}"`;
  }

  if (a.scope === 'area' && b.scope === 'area') {
    const parent = a.target.length <= b.target.length ? a.target : b.target;
    const child = a.target.length <= b.target.length ? b.target : a.target;
    return `Area "${child}" is within area "${parent}"`;
  }

  if (a.scope !== b.scope) {
    const areaClaim = a.scope === 'area' ? a : b;
    const ticketClaim = a.scope === 'area' ? b : a;
    return `Ticket "${ticketClaim.target}" falls within area "${areaClaim.target}"`;
  }

  return `Adjacent claim targets "${a.target}" and "${b.target}"`;
}
