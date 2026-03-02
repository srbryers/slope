// SLOPE — Stack Analyzer: detect languages, frameworks, package manager, runtime, build tool
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { walkDir } from './walk.js';
import type { StackProfile } from './types.js';

const EXTENSION_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++',
  '.c': 'C',
  '.swift': 'Swift',
  '.php': 'PHP',
};

const FRAMEWORK_DEPS: Record<string, string> = {
  'react': 'react', 'next': 'next', 'vue': 'vue', 'nuxt': 'nuxt',
  'angular': '@angular/core', 'svelte': 'svelte',
  'express': 'express', 'fastify': 'fastify', 'koa': 'koa', 'hono': 'hono',
  'vitest': 'vitest', 'jest': 'jest', 'mocha': 'mocha',
  'tailwindcss': 'tailwindcss',
  'prisma': '@prisma/client', 'drizzle': 'drizzle-orm',
};

const LOCK_TO_PM: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
};

const BUILD_CONFIGS: Array<{ pattern: string; tool: string }> = [
  { pattern: 'vite.config', tool: 'vite' },
  { pattern: 'webpack.config', tool: 'webpack' },
  { pattern: 'rollup.config', tool: 'rollup' },
  { pattern: 'esbuild', tool: 'esbuild' },
  { pattern: 'tsconfig.json', tool: 'tsc' },
];

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Detect package manager from lock files in the given directory. */
export function detectPackageManager(cwd: string): string | null {
  for (const [lockFile, pm] of Object.entries(LOCK_TO_PM)) {
    if (existsSync(join(cwd, lockFile))) return pm;
  }
  return null;
}

export async function analyzeStack(cwd: string): Promise<StackProfile> {
  const languages: Record<string, number> = {};
  const frameworks: string[] = [];
  let packageManager: string | undefined;
  let runtime: string | undefined;
  let buildTool: string | undefined;

  // Count file extensions
  const entries = walkDir(cwd);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const dotIdx = entry.path.lastIndexOf('.');
    if (dotIdx === -1) continue;
    const ext = entry.path.slice(dotIdx);
    const lang = EXTENSION_LANG[ext];
    if (lang) {
      languages[lang] = (languages[lang] ?? 0) + 1;
    }
  }

  // Primary language by file count
  let primaryLanguage = '';
  let maxCount = 0;
  for (const [lang, count] of Object.entries(languages)) {
    if (count > maxCount) {
      maxCount = count;
      primaryLanguage = lang;
    }
  }

  // Detect package manager from lock files
  packageManager = detectPackageManager(cwd) ?? undefined;

  // Parse package.json for frameworks and runtime
  const pkgJson = readJson(join(cwd, 'package.json'));
  if (pkgJson) {
    const allDeps: Record<string, string> = {
      ...(pkgJson.dependencies as Record<string, string> ?? {}),
      ...(pkgJson.devDependencies as Record<string, string> ?? {}),
    };
    for (const [name, dep] of Object.entries(FRAMEWORK_DEPS)) {
      if (allDeps[dep]) {
        frameworks.push(name);
      }
    }

    // Runtime from engines
    const engines = pkgJson.engines as Record<string, string> | undefined;
    if (engines?.node) {
      runtime = `Node ${engines.node.replace(/[>=^~]/g, '')}`;
    }
  }

  // Runtime from version files
  if (!runtime) {
    if (existsSync(join(cwd, '.nvmrc'))) {
      try {
        const v = readFileSync(join(cwd, '.nvmrc'), 'utf8').trim();
        runtime = `Node ${v.replace(/^v/, '')}`;
      } catch { /* skip */ }
    } else if (existsSync(join(cwd, '.python-version'))) {
      try {
        runtime = `Python ${readFileSync(join(cwd, '.python-version'), 'utf8').trim()}`;
      } catch { /* skip */ }
    }
  }

  // Detect build tool
  const rootFiles = entries.filter(e => e.depth === 0 && !e.isDirectory).map(e => e.path);
  for (const { pattern, tool } of BUILD_CONFIGS) {
    if (rootFiles.some(f => f.startsWith(pattern))) {
      buildTool = tool;
      break;
    }
  }

  // Detect from non-JS manifests
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    if (!primaryLanguage) primaryLanguage = 'Rust';
    buildTool = buildTool ?? 'cargo';
  }
  if (existsSync(join(cwd, 'go.mod'))) {
    if (!primaryLanguage) primaryLanguage = 'Go';
    runtime = runtime ?? 'Go';
  }
  if (existsSync(join(cwd, 'pyproject.toml'))) {
    if (!primaryLanguage) primaryLanguage = 'Python';
  }
  if (existsSync(join(cwd, 'Gemfile'))) {
    if (!primaryLanguage) primaryLanguage = 'Ruby';
  }
  if (existsSync(join(cwd, 'pom.xml'))) {
    if (!primaryLanguage) primaryLanguage = 'Java';
    buildTool = buildTool ?? 'maven';
  }

  return {
    primaryLanguage,
    languages,
    frameworks,
    packageManager,
    runtime,
    buildTool,
  };
}
