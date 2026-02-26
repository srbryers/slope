// SLOPE — Testing Analyzer: framework, test files, coverage, test dirs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { walkDir } from './walk.js';
import type { TestProfile } from './types.js';

const TEST_FILE_PATTERNS = ['.test.', '.spec.', '_test.', 'test_'];
const TEST_DIR_NAMES = ['tests', '__tests__', 'test', 'spec'];

interface FrameworkDetector {
  name: string;
  check: (cwd: string, rootFiles: string[]) => boolean;
}

const FRAMEWORK_DETECTORS: FrameworkDetector[] = [
  {
    name: 'vitest',
    check: (cwd, rootFiles) =>
      rootFiles.some(f => f.startsWith('vitest.config')) || hasPkgDep(cwd, 'vitest'),
  },
  {
    name: 'jest',
    check: (cwd, rootFiles) =>
      rootFiles.some(f => f.startsWith('jest.config')) || hasPkgDep(cwd, 'jest'),
  },
  {
    name: 'pytest',
    check: (cwd, rootFiles) =>
      existsSync(join(cwd, 'pytest.ini')) ||
      existsSync(join(cwd, 'conftest.py')) ||
      hasPyprojectPytest(cwd),
  },
  {
    name: 'rspec',
    check: (cwd) => existsSync(join(cwd, '.rspec')),
  },
  {
    name: 'go-test',
    check: (cwd) => {
      const entries = walkDir(cwd, { maxDepth: 3 });
      return entries.some(e => !e.isDirectory && e.path.endsWith('_test.go'));
    },
  },
];

function hasPkgDep(cwd: string, dep: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    return !!(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
  } catch {
    return false;
  }
}

function hasPyprojectPytest(cwd: string): boolean {
  try {
    const content = readFileSync(join(cwd, 'pyproject.toml'), 'utf8');
    return content.includes('[tool.pytest');
  } catch {
    return false;
  }
}

function detectCoverage(cwd: string): boolean {
  // Check vitest/jest config for coverage
  for (const configPrefix of ['vitest.config', 'jest.config']) {
    for (const ext of ['.ts', '.js', '.mjs', '.cjs']) {
      const configPath = join(cwd, configPrefix + ext);
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf8');
          if (content.includes('coverage')) return true;
        } catch { /* skip */ }
      }
    }
  }

  // Check for coverage config files
  if (existsSync(join(cwd, '.nycrc')) || existsSync(join(cwd, '.nycrc.json'))) return true;
  if (existsSync(join(cwd, '.coveragerc'))) return true;
  if (existsSync(join(cwd, 'coverage.py'))) return true;

  // Check package.json for coverage script
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const scripts = pkg.scripts ?? {};
    return Object.values(scripts).some((s: unknown) => typeof s === 'string' && s.includes('coverage'));
  } catch {
    return false;
  }
}

export async function analyzeTesting(cwd: string): Promise<TestProfile> {
  const entries = walkDir(cwd);
  const rootFiles = entries.filter(e => e.depth === 0 && !e.isDirectory).map(e => e.path);

  // Detect framework
  let framework: string | undefined;
  for (const detector of FRAMEWORK_DETECTORS) {
    if (detector.check(cwd, rootFiles)) {
      framework = detector.name;
      break;
    }
  }

  // Find test directories that exist
  const testDirs = TEST_DIR_NAMES.filter(dir => existsSync(join(cwd, dir)));

  // Count test files
  const testFileCount = entries.filter(e => {
    if (e.isDirectory) return false;
    return TEST_FILE_PATTERNS.some(p => e.path.includes(p));
  }).length;

  // Check for test script in package.json
  let hasTestScript = false;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    hasTestScript = !!(pkg.scripts?.test);
  } catch { /* skip */ }

  const hasCoverage = detectCoverage(cwd);

  return {
    framework,
    testFileCount,
    hasTestScript,
    hasCoverage,
    testDirs,
  };
}
