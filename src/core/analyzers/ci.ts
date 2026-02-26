// SLOPE — CI Pipeline Analyzer
// Detects CI system from config files and parses for stage keywords.

import { readFileSync } from 'node:fs';
import { walkDir } from './walk.js';
import type { CIProfile } from './types.js';

interface CIDetection {
  system: CIProfile['system'];
  pattern: string;
  isDir: boolean;
}

const CI_DETECTIONS: CIDetection[] = [
  { system: 'github-actions', pattern: '.github/workflows', isDir: true },
  { system: 'circleci', pattern: '.circleci/config.yml', isDir: false },
  { system: 'gitlab-ci', pattern: '.gitlab-ci.yml', isDir: false },
  { system: 'jenkins', pattern: 'Jenkinsfile', isDir: false },
  { system: 'travis', pattern: '.travis.yml', isDir: false },
];

const TEST_KEYWORDS = /\b(test|lint|check|eslint|vitest|jest|pytest|mocha)\b/i;
const BUILD_KEYWORDS = /\b(build|compile|tsc|webpack|vite|rollup|esbuild)\b/i;
const DEPLOY_KEYWORDS = /\b(deploy|publish|release|push|upload)\b/i;

/**
 * Analyze a codebase for CI pipeline configuration.
 */
export function analyzeCI(cwd: string): CIProfile {
  const entries = walkDir(cwd, { maxDepth: 4 });
  const configFiles: string[] = [];
  let system: CIProfile['system'];

  for (const detection of CI_DETECTIONS) {
    if (detection.isDir) {
      // Look for YAML files inside the directory
      const dirEntries = entries.filter(
        e => e.path.startsWith(detection.pattern + '/') && !e.isDirectory && /\.ya?ml$/.test(e.path)
      );
      if (dirEntries.length > 0) {
        system = system ?? detection.system;
        configFiles.push(...dirEntries.map(e => e.path));
      }
    } else {
      const match = entries.find(e => e.path === detection.pattern && !e.isDirectory);
      if (match) {
        system = system ?? detection.system;
        configFiles.push(match.path);
      }
    }
  }

  let hasTestStage = false;
  let hasBuildStage = false;
  let hasDeployStage = false;

  for (const file of configFiles) {
    const fullPath = entries.find(e => e.path === file)?.fullPath;
    if (!fullPath) continue;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    if (TEST_KEYWORDS.test(content)) hasTestStage = true;
    if (BUILD_KEYWORDS.test(content)) hasBuildStage = true;
    if (DEPLOY_KEYWORDS.test(content)) hasDeployStage = true;
  }

  return { system, configFiles, hasTestStage, hasBuildStage, hasDeployStage };
}
