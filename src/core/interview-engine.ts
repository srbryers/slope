// SLOPE — Interview Engine
// Lightweight project detection, context building, and answer transformation.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { hasMetaphor } from './metaphor.js';
import type { InitInput } from './interview.js';

export interface DetectedInfo {
  projectName?: string;
  repoUrl?: string;
  existingSprintNumber?: number;
  detectedPlatforms: string[];
  techStack?: string[];
}

export interface InterviewContext {
  cwd: string;
  detected: DetectedInfo;
}

/**
 * Fast, lightweight project detection. No git log analysis, no heavy scanning.
 * Each step is wrapped in try/catch for graceful fallback.
 */
export function runLightweightDetection(cwd: string): DetectedInfo {
  const detected: DetectedInfo = {
    detectedPlatforms: [],
  };

  // 1. Read package.json for projectName and techStack hints
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.name === 'string' && pkg.name.trim()) {
        detected.projectName = pkg.name;
      }
      // Extract tech stack from dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps && typeof deps === 'object') {
        detected.techStack = Object.keys(deps).slice(0, 20);
      }
    }
  } catch {
    // No package.json or malformed — skip
  }

  // Fall back to directory name if no package.json name
  if (!detected.projectName) {
    detected.projectName = basename(cwd);
  }

  // 2. Read git remote for repoUrl
  try {
    const raw = execSync('git remote get-url origin 2>/dev/null', {
      cwd,
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    // Convert SSH to HTTPS if needed
    if (raw.startsWith('https://github.com/')) {
      detected.repoUrl = raw.replace(/\.git$/, '');
    } else if (raw.startsWith('git@github.com:')) {
      detected.repoUrl = raw
        .replace('git@github.com:', 'https://github.com/')
        .replace(/\.git$/, '');
    }
  } catch {
    // No git repo or no remote — skip
  }

  // 3. Find highest sprint number from docs/retros/sprint-*.json
  try {
    const retrosDir = join(cwd, 'docs', 'retros');
    if (existsSync(retrosDir)) {
      const files = readdirSync(retrosDir);
      let highest = 0;
      for (const f of files) {
        const match = f.match(/^sprint-(\d+)\.json$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > highest) highest = n;
        }
      }
      if (highest > 0) {
        detected.existingSprintNumber = highest;
      }
    }
  } catch {
    // No retros dir or unreadable — skip
  }

  // 4. Detect platforms
  try {
    detected.detectedPlatforms = detectPlatformsLightweight(cwd);
  } catch {
    detected.detectedPlatforms = [];
  }

  return detected;
}

/**
 * Lightweight platform detection — checks for config files without importing adapters.
 */
function detectPlatformsLightweight(cwd: string): string[] {
  const platforms: string[] = [];

  if (existsSync(join(cwd, '.claude')) || existsSync(join(cwd, 'CLAUDE.md')) || existsSync(join(cwd, '.mcp.json'))) {
    platforms.push('claude-code');
  }
  if (existsSync(join(cwd, '.cursor')) || existsSync(join(cwd, '.cursorrules'))) {
    platforms.push('cursor');
  }
  if (existsSync(join(cwd, '.windsurf')) || existsSync(join(cwd, '.windsurfrules'))) {
    platforms.push('windsurf');
  }
  if (existsSync(join(cwd, '.clinerules'))) {
    platforms.push('cline');
  }
  if (existsSync(join(cwd, 'opencode.json')) || existsSync(join(cwd, 'AGENTS.md'))) {
    platforms.push('opencode');
  }

  return platforms;
}

/**
 * Build the full interview context from cwd.
 */
export function buildInterviewContext(cwd: string): InterviewContext {
  return {
    cwd,
    detected: runLightweightDetection(cwd),
  };
}

/**
 * Validate interview answers against step definitions.
 * Returns an array of { field, message } errors (empty = valid).
 */
export function validateInterviewAnswers(
  answers: Record<string, unknown>,
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];

  // project-name is required
  const name = String(answers['project-name'] ?? '').trim();
  if (!name) {
    errors.push({ field: 'project-name', message: 'Project name is required' });
  }

  // metaphor validation (if provided)
  const metaphor = String(answers['metaphor'] ?? '').trim();
  if (metaphor && metaphor !== 'custom' && !hasMetaphor(metaphor)) {
    errors.push({ field: 'metaphor', message: `Unknown metaphor "${metaphor}". Use listMetaphors() to see available options.` });
  }

  // repo-url validation (if provided)
  const repoUrl = String(answers['repo-url'] ?? '').trim();
  if (repoUrl) {
    const ghPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/;
    if (!ghPattern.test(repoUrl)) {
      errors.push({ field: 'repo-url', message: 'Must be a valid GitHub URL (https://github.com/owner/repo)' });
    }
  }

  // sprint-number validation (if provided)
  const sprintStr = String(answers['sprint-number'] ?? '').trim();
  if (sprintStr) {
    const n = parseInt(sprintStr, 10);
    if (isNaN(n) || n < 1 || !Number.isInteger(n)) {
      errors.push({ field: 'sprint-number', message: 'Must be a positive integer' });
    }
  }

  return errors;
}

/**
 * Transform interview answers map into InitInput for core initFromInterview().
 */
export function answersToInitInput(answers: Record<string, unknown>): InitInput {
  const input: InitInput = {
    projectName: String(answers['project-name'] ?? '').trim(),
  };

  const repoUrl = String(answers['repo-url'] ?? '').trim();
  if (repoUrl) input.repoUrl = repoUrl;

  const metaphor = String(answers['metaphor'] ?? '').trim();
  if (metaphor) input.metaphor = metaphor;

  const sprintStr = String(answers['sprint-number'] ?? '').trim();
  if (sprintStr) {
    const n = parseInt(sprintStr, 10);
    if (!isNaN(n) && n >= 1) input.currentSprint = n;
  }

  const vision = String(answers['vision'] ?? '').trim();
  if (vision) input.vision = vision;

  // Parse team members: "alice:Alice Smith, bob:Bob Jones"
  const teamStr = String(answers['team-members'] ?? '').trim();
  if (teamStr) {
    const members: Record<string, string> = {};
    for (const pair of teamStr.split(',')) {
      const trimmed = pair.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const slug = trimmed.slice(0, colonIdx).trim();
        const name = trimmed.slice(colonIdx + 1).trim();
        if (slug && name) members[slug] = name;
      }
    }
    if (Object.keys(members).length > 0) {
      input.teamMembers = members;
    }
  }

  return input;
}
