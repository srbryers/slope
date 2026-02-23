import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';

const DEFAULT_INDEX_PATHS = ['CODEBASE.md', '.slope/index.json', 'docs/architecture.md'];

/**
 * Explore guard: fires on Read|Glob|Grep (PreToolUse).
 * Suggests checking codebase map before deep exploration.
 * Includes staleness awareness when CODEBASE.md has YAML frontmatter.
 */
export async function exploreGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig();
  const indexPaths = config.guidance?.indexPaths ?? DEFAULT_INDEX_PATHS;

  // Find which index files exist
  const found: string[] = [];
  for (const p of indexPaths) {
    const full = join(cwd, p);
    if (existsSync(full)) {
      found.push(p);
    }
  }

  if (found.length === 0) {
    return {}; // No index — passthrough
  }

  // Check if CODEBASE.md exists and assess staleness
  const mapPath = join(cwd, 'CODEBASE.md');
  if (existsSync(mapPath)) {
    const staleness = checkMapStaleness(mapPath, cwd);

    if (staleness === 'stale') {
      return {
        context: `SLOPE: Codebase map at CODEBASE.md is stale (${getStalenessDetail(mapPath, cwd)}). Run 'slope map' to refresh, or explore if needed.`,
      };
    }

    // Current map — estimate token size
    const content = readFileSync(mapPath, 'utf8');
    const approxTokens = Math.round(content.length / 4 / 1000);

    return {
      context: `SLOPE: Codebase map at CODEBASE.md (~${approxTokens}k tokens). Read it or use search({ module: 'map' }) before exploring.`,
    };
  }

  // Fallback: other index files found but no CODEBASE.md
  return {
    context: `SLOPE: Codebase index available at: ${found.join(', ')} — check before deep exploration.`,
  };
}

function checkMapStaleness(mapPath: string, cwd: string): 'current' | 'stale' {
  try {
    const content = readFileSync(mapPath, 'utf8');
    const metaMatch = content.match(/^---\n([\s\S]*?)\n---/m);
    if (!metaMatch) return 'current'; // No metadata — can't check

    const gitShaMatch = metaMatch[1].match(/git_sha:\s*"?([^"\n]+)"?/);
    if (!gitShaMatch) return 'current';

    const distance = parseInt(
      execSync(`git rev-list --count ${gitShaMatch[1]}..HEAD 2>/dev/null`, { cwd, encoding: 'utf8', timeout: 5000 }).trim() || '0',
      10,
    );

    return distance > 50 ? 'stale' : 'current';
  } catch {
    return 'current'; // Can't determine — assume current
  }
}

function getStalenessDetail(mapPath: string, cwd: string): string {
  try {
    const content = readFileSync(mapPath, 'utf8');
    const metaMatch = content.match(/^---\n([\s\S]*?)\n---/m);
    if (!metaMatch) return 'unknown';

    const gitShaMatch = metaMatch[1].match(/git_sha:\s*"?([^"\n]+)"?/);
    if (!gitShaMatch) return 'unknown';

    const distance = execSync(`git rev-list --count ${gitShaMatch[1]}..HEAD 2>/dev/null`, { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    return `${distance} commits behind`;
  } catch {
    return 'unknown';
  }
}
