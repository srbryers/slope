import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, GuardResult } from '@srbryers/core';
import { loadConfig } from '../config.js';
import type { CommonIssuesFile } from '@srbryers/core';

/**
 * Hazard guard: fires on Edit|Write (PreToolUse).
 * Warns about known issues in the file area being edited.
 */
export async function hazardGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  const config = loadConfig();
  const recency = config.guidance?.hazardRecency ?? 5;

  // Determine the area from the file path (use directory)
  const area = dirname(filePath).replace(cwd + '/', '').replace(cwd, '');
  if (!area || area === '.') return {};

  // Load common issues and find matches
  const warnings: string[] = [];

  try {
    const issuesPath = join(cwd, config.commonIssuesPath);
    if (existsSync(issuesPath)) {
      const issues: CommonIssuesFile = JSON.parse(readFileSync(issuesPath, 'utf8'));
      const areaLower = area.toLowerCase();

      for (const pattern of issues.recurring_patterns) {
        // Check if pattern is relevant to this area
        const text = `${pattern.title} ${pattern.description} ${pattern.prevention}`.toLowerCase();
        if (text.includes(areaLower) || areaLower.split('/').some(seg => text.includes(seg))) {
          const lastSprint = Math.max(...pattern.sprints_hit);
          warnings.push(`[${pattern.category}] ${pattern.title} (last: S${lastSprint}) — ${pattern.prevention.slice(0, 100)}`);
        }
      }
    }
  } catch { /* skip — common issues are optional */ }

  if (warnings.length === 0) return {};

  const header = `SLOPE hazard warning for ${area}:`;
  return {
    context: [header, ...warnings.map(w => `  ${w}`)].join('\n'),
  };
}
