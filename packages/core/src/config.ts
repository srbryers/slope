import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SlopeConfig {
  scorecardDir: string;
  scorecardPattern: string;
  minSprint: number;
  commonIssuesPath: string;
  sessionsPath: string;
  registry: 'file' | 'api';
  claimsPath: string;
  roadmapPath: string;
  metaphor: string;
  registryApiUrl?: string;
  currentSprint?: number;
  store?: string;
  store_path?: string;
  guidance?: {
    disabled?: string[];
    indexPaths?: string[];
    hazardRecency?: number;
    commitInterval?: number;
    pushInterval?: number;
    scopeDrift?: boolean;
  };
}

const DEFAULT_CONFIG: SlopeConfig = {
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file',
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  metaphor: 'golf',
};

const CONFIG_DIR = '.slope';
const CONFIG_FILE = 'config.json';

export function loadConfig(cwd: string = process.cwd()): SlopeConfig {
  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function createConfig(cwd: string = process.cwd()): string {
  const dir = join(cwd, CONFIG_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const configPath = join(dir, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  return configPath;
}

export function resolveConfigPath(config: SlopeConfig, relativePath: string, cwd: string = process.cwd()): string {
  return join(cwd, relativePath);
}
