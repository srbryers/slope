import { describe, it, expect } from 'vitest';
import { mergeBacklogs } from '../../../src/core/analyzers/backlog-merged.js';
import type { BacklogAnalysis } from '../../../src/core/analyzers/backlog.js';
import type { GitHubBacklogAnalysis } from '../../../src/core/analyzers/github-backlog.js';
import type { GitHubIssue } from '../../../src/core/github.js';

function makeLocal(todoCount = 0): BacklogAnalysis {
  const todos = Array.from({ length: todoCount }, (_, i) => ({
    type: 'TODO' as const,
    text: `task ${i}`,
    file: `src/file${i}.ts`,
    line: i + 1,
  }));
  return { todos, todosByModule: { root: todos } };
}

function makeRemote(issueCount = 0): GitHubBacklogAnalysis {
  const issues: GitHubIssue[] = Array.from({ length: issueCount }, (_, i) => ({
    number: i + 1,
    title: `Issue ${i}`,
    state: 'open' as const,
    labels: [],
    createdAt: '2025-01-01T00:00:00Z',
  }));
  return {
    issues,
    issuesByLabel: {},
    issuesByMilestone: {},
    highPriority: [],
    milestones: [],
  };
}

describe('mergeBacklogs', () => {
  it('combines local and remote counts', () => {
    const result = mergeBacklogs(makeLocal(5), makeRemote(10));
    expect(result.totalItems).toBe(15);
    expect(result.local.todos).toHaveLength(5);
    expect(result.remote!.issues).toHaveLength(10);
  });

  it('works with local only (no remote)', () => {
    const result = mergeBacklogs(makeLocal(3));
    expect(result.totalItems).toBe(3);
    expect(result.remote).toBeUndefined();
  });

  it('works with remote only (empty local)', () => {
    const result = mergeBacklogs(makeLocal(0), makeRemote(7));
    expect(result.totalItems).toBe(7);
    expect(result.local.todos).toHaveLength(0);
  });

  it('handles both empty', () => {
    const result = mergeBacklogs(makeLocal(0));
    expect(result.totalItems).toBe(0);
  });

  it('preserves local backlog structure', () => {
    const local = makeLocal(2);
    local.changelogUnreleased = ['Fix bug', 'Add feature'];
    const result = mergeBacklogs(local, makeRemote(1));
    expect(result.local.changelogUnreleased).toEqual(['Fix bug', 'Add feature']);
  });
});
