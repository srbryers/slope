import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '@slope-dev/core';
import { loadConfig } from '../config.js';

const DEFAULT_INDEX_PATHS = ['CODEBASE.md', '.slope/index.json', 'docs/architecture.md'];

/**
 * Explore guard: fires on Read|Glob|Grep (PreToolUse).
 * Suggests checking codebase index before deep exploration.
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

  return {
    context: `SLOPE: Codebase index available at: ${found.join(', ')} — check before deep exploration.`,
  };
}
