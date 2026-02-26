// SLOPE — Merged Backlog
// Combines local TODO/FIXME analysis with remote GitHub issue data.

import type { BacklogAnalysis } from './backlog.js';
import type { GitHubBacklogAnalysis } from './github-backlog.js';

export interface MergedBacklog {
  local: BacklogAnalysis;
  remote?: GitHubBacklogAnalysis;
  totalItems: number;
}

/**
 * Merge local backlog (TODO/FIXME) with optional remote GitHub backlog.
 * Provides unified totalItems count across both sources.
 */
export function mergeBacklogs(
  local: BacklogAnalysis,
  remote?: GitHubBacklogAnalysis,
): MergedBacklog {
  const localCount = local.todos.length;
  const remoteCount = remote?.issues.length ?? 0;

  return {
    local,
    remote,
    totalItems: localCount + remoteCount,
  };
}
