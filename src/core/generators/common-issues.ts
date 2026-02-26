// SLOPE — Common Issues Generator
// Seeds common-issues.json from RepoProfile and BacklogAnalysis.

import type { RepoProfile } from '../analyzers/types.js';
import type { BacklogAnalysis, TodoEntry } from '../analyzers/backlog.js';
import type { CommonIssuesFile, RecurringPattern } from '../briefing.js';

/**
 * Generate seeded common issues from repo analysis and backlog scan.
 * Converts HACK/FIXME clusters into recurring patterns and adds structural warnings.
 */
export function generateCommonIssues(
  profile: RepoProfile,
  backlog: BacklogAnalysis,
): CommonIssuesFile {
  const patterns: RecurringPattern[] = [];
  let nextId = 1;

  // Convert HACK/FIXME clusters (3+ in same module) into patterns
  for (const [mod, todos] of Object.entries(backlog.todosByModule)) {
    const hacks = todos.filter(t => t.type === 'HACK' || t.type === 'FIXME');
    if (hacks.length >= 3) {
      patterns.push({
        id: nextId++,
        title: `${hacks.length} ${hacks[0].type} comments in ${mod}`,
        category: 'code-quality',
        sprints_hit: [],
        gotcha_refs: [],
        description: `Module "${mod}" has ${hacks.length} ${hacks[0].type} markers: ${hacks.slice(0, 3).map(h => h.text).join('; ')}`,
        prevention: `Prioritize addressing ${hacks[0].type} markers in ${mod} during upcoming sprints.`,
        reported_by: ['analyzer'],
      });
    }
  }

  // Structural warnings
  if (profile.testing.testFileCount === 0) {
    patterns.push({
      id: nextId++,
      title: 'No test coverage',
      category: 'testing',
      sprints_hit: [],
      gotcha_refs: [],
      description: 'No test files detected in the repository. Changes cannot be verified automatically.',
      prevention: 'Set up a test framework and add tests for critical paths before feature work.',
      reported_by: ['analyzer'],
    });
  }

  if (profile.structure.largeFiles.length > 0) {
    const files = profile.structure.largeFiles.slice(0, 3).map(f => f.path).join(', ');
    patterns.push({
      id: nextId++,
      title: 'Large file complexity',
      category: 'code-quality',
      sprints_hit: [],
      gotcha_refs: [],
      description: `${profile.structure.largeFiles.length} file(s) exceed 1000 lines: ${files}`,
      prevention: 'Break large files into focused modules to reduce merge conflicts and cognitive load.',
      reported_by: ['analyzer'],
    });
  }

  if (profile.structure.isMonorepo) {
    // Check if there's a workspace config indicator
    const hasWorkspaceConfig = profile.stack.packageManager === 'pnpm' ||
      profile.stack.packageManager === 'yarn';
    if (!hasWorkspaceConfig) {
      patterns.push({
        id: nextId++,
        title: 'Monorepo without workspace tooling',
        category: 'monorepo',
        sprints_hit: [],
        gotcha_refs: [],
        description: 'Repository has monorepo structure but no recognized workspace package manager (pnpm/yarn).',
        prevention: 'Configure workspace tooling to manage inter-package dependencies correctly.',
        reported_by: ['analyzer'],
      });
    }
  }

  return { recurring_patterns: patterns };
}
