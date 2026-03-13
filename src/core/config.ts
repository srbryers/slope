import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EscalationConfig } from './escalation.js';
import type { PluginsConfig } from './plugins.js';

export interface SlopeConfig {
  scorecardDir: string;
  scorecardPattern: string;
  minSprint: number;
  commonIssuesPath: string;
  sessionsPath: string;
  registry: 'file' | 'api';
  claimsPath: string;
  roadmapPath: string;
  flowsPath: string;
  visionPath: string;
  repoProfilePath: string;
  transcriptsPath: string;
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
    subagentExploreTurns?: number;
    subagentPlanTurns?: number;
    subagentAllowModels?: string[];
    pushCommitThreshold?: number;
    handoffsDir?: string;
    allowMainCommitPatterns?: string[];
    protectedBranches?: string[];
  };
  orchestration?: {
    escalation?: EscalationConfig;
  };
  plugins?: PluginsConfig;
  dashboard?: {
    port?: number;
    autoOpen?: boolean;
    refreshInterval?: number;
  };
  team?: {
    players?: Record<string, string>;
    defaultPlayer?: string;
  };
  projectId?: string;
  projectName?: string;
  postgres?: {
    connectionString: string;
    projectId?: string;
  };
  embedding?: {
    endpoint: string;
    model: string;
    dimensions: number;
    apiKey?: string;
  };
  testing?: {
    setup_steps?: string[];
    teardown_steps?: string[];
    testPlanPath?: string;
    sessionLogDir?: string;
  };
  detectedStack?: {
    language?: string;
    frameworks?: string[];
    packageManager?: string;
    runtime?: string;
  };
  slopeVersion?: string;
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
  flowsPath: '.slope/flows.json',
  visionPath: '.slope/vision.json',
  repoProfilePath: '.slope/repo-profile.json',
  transcriptsPath: '.slope/transcripts',
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

/** Write a complete SlopeConfig to .slope/config.json. Expects a full config object (use loadConfig() to read-modify-write). */
export function saveConfig(config: SlopeConfig, cwd: string = process.cwd()): string {
  const dir = join(cwd, CONFIG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const configPath = join(dir, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}

export function resolveConfigPath(config: SlopeConfig, relativePath: string, cwd: string = process.cwd()): string {
  return join(cwd, relativePath);
}
