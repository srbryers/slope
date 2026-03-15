import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';

const DEFAULT_INDEX_PATHS = ['CODEBASE.md', '.slope/index.json', 'docs/architecture.md'];
const DEFAULT_STALE_WARN_AT = 11;
const DEFAULT_STALE_BLOCK_AT = 31;

/**
 * Explore guard: fires on Read|Glob|Grep|Edit|Write (PreToolUse).
 * Suggests checking codebase map before deep exploration.
 * Includes tiered staleness awareness when CODEBASE.md has YAML frontmatter:
 *   0–10 commits stale  → no warning (within tolerance)
 *   11–30 commits stale → warning with commit count
 *   31+ commits stale   → block Edit/Write (don't block Read/Glob/Grep)
 */
export async function exploreGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig(cwd);
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
    const staleness = checkMapStaleness(mapPath, cwd, config);

    if (staleness.level === 'block') {
      // Only block Edit/Write — let Read/Glob/Grep through with a warning
      const toolName = input.tool_name ?? '';
      const isWriteTool = /^(Edit|Write)$/i.test(toolName);
      if (isWriteTool) {
        return {
          decision: 'deny',
          blockReason: `SLOPE: Codebase map is ${staleness.distance} commits stale. Run \`slope map\` to refresh before editing.`,
        };
      }
      // Read/Glob/Grep — warn but don't block
      return {
        context: `SLOPE: Codebase map is ${staleness.distance} commits stale. Run \`slope map\` to refresh.`,
      };
    }

    if (staleness.level === 'warn') {
      return {
        context: `SLOPE: Codebase map at CODEBASE.md is ${staleness.distance} commits stale. Run 'slope map' to refresh, or explore if needed.`,
      };
    }

    // Current map — estimate token size
    const content = readFileSync(mapPath, 'utf8');
    const approxTokens = Math.round(content.length / 4 / 1000);

    return {
      context: `SLOPE: Codebase map at CODEBASE.md (~${approxTokens}k tokens, L1). Try \`context_search\` (L1.5) before reading full files (L2).`,
    };
  }

  // Fallback: other index files found but no CODEBASE.md
  return {
    context: `SLOPE: Codebase index available at: ${found.join(', ')} — check before deep exploration.`,
  };
}

interface StalenessResult {
  level: 'current' | 'warn' | 'block';
  distance: number;
}

function checkMapStaleness(
  mapPath: string,
  cwd: string,
  config?: { guidance?: { mapStaleWarnAt?: number; mapStaleBlockAt?: number } },
): StalenessResult {
  const warnAt = config?.guidance?.mapStaleWarnAt ?? DEFAULT_STALE_WARN_AT;
  const blockAt = config?.guidance?.mapStaleBlockAt ?? DEFAULT_STALE_BLOCK_AT;

  try {
    const content = readFileSync(mapPath, 'utf8');
    const metaMatch = content.match(/^---\n([\s\S]*?)\n---/m);
    if (!metaMatch) return { level: 'current', distance: 0 }; // No metadata — can't check

    const gitShaMatch = metaMatch[1].match(/git_sha:\s*"?([^"\n]+)"?/);
    if (!gitShaMatch) return { level: 'current', distance: 0 };

    const distance = parseInt(
      execSync(`git rev-list --count ${gitShaMatch[1]}..HEAD 2>/dev/null`, { cwd, encoding: 'utf8', timeout: 5000 }).trim() || '0',
      10,
    );

    if (distance >= blockAt) return { level: 'block', distance };
    if (distance >= warnAt) return { level: 'warn', distance };
    return { level: 'current', distance };
  } catch {
    return { level: 'current', distance: 0 }; // Can't determine — assume current
  }
}
