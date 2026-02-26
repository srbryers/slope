// SLOPE — Repo Profile Analyzer Pipeline
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  AnalyzerName,
  RepoProfile,
  StackProfile,
  StructureProfile,
  GitProfile,
  TestProfile,
} from './types.js';

export interface AnalyzerOptions {
  cwd?: string;
  analyzers?: AnalyzerName[];
}

const ALL_ANALYZERS: AnalyzerName[] = ['stack', 'structure', 'git', 'testing'];

const PROFILE_FILE = 'repo-profile.json';
const SLOPE_DIR = '.slope';

function emptyStack(): StackProfile {
  return { primaryLanguage: '', languages: {}, frameworks: [] };
}

function emptyStructure(): StructureProfile {
  return { totalFiles: 0, sourceFiles: 0, testFiles: 0, maxDepth: 0, isMonorepo: false, modules: [], largeFiles: [] };
}

function emptyGit(): GitProfile {
  return { totalCommits: 0, commitsLast90d: 0, commitsPerWeek: 0, contributors: [], activeBranches: [], inferredCadence: 'sporadic' };
}

function emptyTesting(): TestProfile {
  return { testFileCount: 0, hasTestScript: false, hasCoverage: false, testDirs: [] };
}

export async function runAnalyzers(opts?: AnalyzerOptions): Promise<RepoProfile> {
  const cwd = opts?.cwd ?? process.cwd();
  const requested = opts?.analyzers ?? ALL_ANALYZERS;

  const profile: RepoProfile = {
    analyzedAt: new Date().toISOString(),
    analyzersRun: requested,
    stack: emptyStack(),
    structure: emptyStructure(),
    git: emptyGit(),
    testing: emptyTesting(),
  };

  for (const name of requested) {
    switch (name) {
      case 'stack': {
        const { analyzeStack } = await import('./stack.js');
        profile.stack = await analyzeStack(cwd);
        break;
      }
      case 'structure': {
        const { analyzeStructure } = await import('./structure.js');
        profile.structure = await analyzeStructure(cwd);
        break;
      }
      case 'git': {
        const { analyzeGit } = await import('./git.js');
        profile.git = await analyzeGit(cwd);
        break;
      }
      case 'testing': {
        const { analyzeTesting } = await import('./testing.js');
        profile.testing = await analyzeTesting(cwd);
        break;
      }
    }
  }

  return profile;
}

export function loadRepoProfile(cwd?: string): RepoProfile | null {
  const root = cwd ?? process.cwd();
  const filePath = join(root, SLOPE_DIR, PROFILE_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as RepoProfile;
  } catch {
    return null;
  }
}

export function saveRepoProfile(profile: RepoProfile, cwd?: string): void {
  const root = cwd ?? process.cwd();
  const dir = join(root, SLOPE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, PROFILE_FILE);
  writeFileSync(filePath, JSON.stringify(profile, null, 2) + '\n');
}
