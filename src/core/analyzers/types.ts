// SLOPE — Repo Profile Analyzer Types

export interface StackProfile {
  primaryLanguage: string;
  languages: Record<string, number>;
  frameworks: string[];
  packageManager?: string;
  runtime?: string;
  buildTool?: string;
}

export interface StructureProfile {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  maxDepth: number;
  isMonorepo: boolean;
  modules: Array<{ name: string; path: string; fileCount: number }>;
  largeFiles: Array<{ path: string; lines: number }>;
}

export interface GitProfile {
  totalCommits: number;
  commitsLast90d: number;
  commitsPerWeek: number;
  contributors: Array<{ name: string; email: string; commits: number }>;
  activeBranches: string[];
  lastRelease?: { tag: string; date: string };
  inferredCadence: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'sporadic';
}

export interface TestProfile {
  framework?: string;
  testFileCount: number;
  hasTestScript: boolean;
  hasCoverage: boolean;
  testDirs: string[];
}

export interface VisionDocument {
  purpose: string;
  audience?: string;
  priorities: string[];
  techDirection?: string;
  nonGoals?: string[];
  createdAt: string;
  updatedAt: string;
}

export type AnalyzerName = 'stack' | 'structure' | 'git' | 'testing';

export interface RepoProfile {
  analyzedAt: string;
  analyzersRun: AnalyzerName[];
  stack: StackProfile;
  structure: StructureProfile;
  git: GitProfile;
  testing: TestProfile;
}
