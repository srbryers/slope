import type { HookInput, GuardResult } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { resolveStore } from '../store.js';

/**
 * Scope drift guard: fires PreToolUse on Edit|Write.
 * Warns when editing files outside the claimed ticket's scope.
 */
export async function scopeDriftGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const config = loadConfig();
  if (config.guidance?.scopeDrift === false) return {};

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  // Normalize file path relative to cwd
  const relativePath = filePath.startsWith(cwd)
    ? filePath.slice(cwd.length + 1)
    : filePath;

  // Look up active claims for the current sprint
  let sprintNumber: number | undefined;
  if (config.currentSprint) {
    sprintNumber = config.currentSprint;
  }
  if (!sprintNumber) return {}; // Can't check without a sprint

  try {
    const store = await resolveStore(cwd);
    const claims = await store.list(sprintNumber);
    store.close();

    if (claims.length === 0) return {}; // No claims — can't check

    // Check if the file is within any claimed area
    const areaClaims = claims.filter(c => c.scope === 'area');
    if (areaClaims.length === 0) return {}; // No area claims — ticket-only claims don't restrict files

    const inScope = areaClaims.some(c => relativePath.startsWith(c.target));
    if (inScope) return {}; // File is in scope

    const claimedAreas = areaClaims.map(c => c.target).join(', ');
    return {
      context: `SLOPE scope drift: ${relativePath} is outside claimed areas (${claimedAreas}). Intentional?`,
    };
  } catch {
    return {}; // Store not available — skip
  }
}
