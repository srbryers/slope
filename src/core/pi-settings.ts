// SLOPE — Pi Settings
// Configuration for Pi extension features and skills.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface PiSkillSetting {
  enabled: boolean;
  description: string;
}

export interface PiSettings {
  version: string;
  skills: Record<string, PiSkillSetting>;
}

const DEFAULT_SETTINGS: PiSettings = {
  version: '1',
  skills: {
    guards: {
      enabled: true,
      description: 'Guard enforcement: commit discipline, hazard warnings on file edits, workflow step gates',
    },
    interview: {
      enabled: true,
      description: 'Project interview for fresh SLOPE projects — asks project name, metaphor, platforms, etc.',
    },
    briefing: {
      enabled: true,
      description: 'Pre-session briefing injection with handicap, hazards, gotchas, and roadmap context',
    },
    planning: {
      enabled: true,
      description: 'Sprint planning workflow: plan review gating, club recommendations, hazard watch',
    },
    scorecard: {
      enabled: true,
      description: 'Scorecard creation helpers and post-sprint validation',
    },
    review: {
      enabled: true,
      description: 'Code review and architect review generation from PR diffs',
    },
    dashboard: {
      enabled: false,
      description: 'Live performance dashboard (requires manual `slope dashboard` start)',
    },
  },
};

const SETTINGS_FILE = '.slope/pi-settings.json';

export function loadPiSettings(cwd: string): PiSettings {
  const path = join(cwd, SETTINGS_FILE);
  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    // Merge with defaults to ensure all keys exist
    return {
      version: raw.version ?? DEFAULT_SETTINGS.version,
      skills: { ...DEFAULT_SETTINGS.skills, ...raw.skills },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function savePiSettings(cwd: string, settings: PiSettings): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, SETTINGS_FILE), JSON.stringify(settings, null, 2) + '\n');
}

export function isSkillEnabled(settings: PiSettings, skillName: string): boolean {
  return settings.skills[skillName]?.enabled ?? false;
}

export function setSkillEnabled(settings: PiSettings, skillName: string, enabled: boolean): void {
  if (settings.skills[skillName]) {
    settings.skills[skillName].enabled = enabled;
  }
}

export function listSkills(settings: PiSettings): Array<{ name: string; enabled: boolean; description: string }> {
  return Object.entries(settings.skills).map(([name, config]) => ({
    name,
    enabled: config.enabled,
    description: config.description,
  }));
}
