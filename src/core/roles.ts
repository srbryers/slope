import type { ClubSelection } from './types.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// --- Role Definition ---

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  focusAreas: string[];
  clubPreferences: Partial<Record<string, ClubSelection>>;
  briefingFilter: {
    emphasize: string[];
    deemphasize: string[];
  };
}

// --- Registry ---

const registry = new Map<string, RoleDefinition>();

export function registerRole(role: RoleDefinition): void {
  registry.set(role.id, role);
}

export function getRole(id: string): RoleDefinition {
  const role = registry.get(id);
  if (!role) {
    throw new Error(`Unknown role: "${id}". Available: ${[...registry.keys()].join(', ')}`);
  }
  return role;
}

export function hasRole(id: string): boolean {
  return registry.has(id);
}

export function listRoles(): RoleDefinition[] {
  return [...registry.values()];
}

export function loadCustomRoles(cwd: string): RoleDefinition[] {
  const rolesDir = join(cwd, '.slope', 'roles');
  if (!existsSync(rolesDir)) return [];

  const loaded: RoleDefinition[] = [];
  for (const file of readdirSync(rolesDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(rolesDir, file), 'utf8'));
      if (raw.id && raw.name) {
        const role: RoleDefinition = {
          id: raw.id,
          name: raw.name,
          description: raw.description ?? '',
          focusAreas: raw.focusAreas ?? [],
          clubPreferences: raw.clubPreferences ?? {},
          briefingFilter: raw.briefingFilter ?? { emphasize: [], deemphasize: [] },
        };
        registerRole(role);
        loaded.push(role);
      }
    } catch { /* skip invalid files */ }
  }
  return loaded;
}

// --- Built-in Roles ---

export const generalist: RoleDefinition = {
  id: 'generalist',
  name: 'Generalist',
  description: 'Default role — no special focus area filtering',
  focusAreas: [],
  clubPreferences: {},
  briefingFilter: { emphasize: [], deemphasize: [] },
};

export const backend: RoleDefinition = {
  id: 'backend',
  name: 'Backend',
  description: 'API, database, server-side logic specialist',
  focusAreas: ['packages/core', 'packages/store-*', 'src/api', 'src/server', 'src/db', 'migrations'],
  clubPreferences: { database: 'short_iron', api: 'short_iron', migration: 'wedge' },
  briefingFilter: {
    emphasize: ['database', 'api', 'testing', 'migration', 'schema'],
    deemphasize: ['accessibility', 'styling', 'bundle'],
  },
};

export const frontend: RoleDefinition = {
  id: 'frontend',
  name: 'Frontend',
  description: 'UI, components, styling, accessibility specialist',
  focusAreas: ['src/components', 'src/pages', 'src/styles', 'src/hooks', 'public'],
  clubPreferences: { component: 'short_iron', styling: 'wedge', accessibility: 'short_iron' },
  briefingFilter: {
    emphasize: ['accessibility', 'styling', 'component', 'bundle', 'rendering'],
    deemphasize: ['database', 'migration', 'schema'],
  },
};

export const architect: RoleDefinition = {
  id: 'architect',
  name: 'Architect',
  description: 'Cross-package dependencies, API surface, tech debt specialist',
  focusAreas: ['packages/*', 'docs', 'src/types', 'src/config'],
  clubPreferences: { refactor: 'long_iron', architecture: 'driver', types: 'short_iron' },
  briefingFilter: {
    emphasize: ['architecture', 'dependency', 'api', 'tech-debt', 'cross-package'],
    deemphasize: [],
  },
};

export const devops: RoleDefinition = {
  id: 'devops',
  name: 'DevOps',
  description: 'CI/CD, deployment, infrastructure specialist',
  focusAreas: ['.github', 'Dockerfile', 'docker-compose', 'scripts', '.env', 'infra'],
  clubPreferences: { ci: 'short_iron', deployment: 'short_iron', infra: 'long_iron' },
  briefingFilter: {
    emphasize: ['ci', 'deployment', 'infrastructure', 'docker', 'monitoring'],
    deemphasize: ['styling', 'component', 'accessibility'],
  },
};

// Auto-register built-in roles
registerRole(generalist);
registerRole(backend);
registerRole(frontend);
registerRole(architect);
registerRole(devops);
