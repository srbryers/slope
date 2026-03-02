import { describe, it, expect } from 'vitest';
import { generateRoadmapFromVision } from '../../../src/core/generators/roadmap.js';
import { validateRoadmap } from '../../../src/core/roadmap.js';
import type { VisionDocument } from '../../../src/core/analyzers/types.js';
import type { ComplexityProfile } from '../../../src/core/analyzers/complexity.js';
import type { MergedBacklog } from '../../../src/core/analyzers/backlog-merged.js';
import type { GitHubBacklogAnalysis } from '../../../src/core/analyzers/github-backlog.js';
import type { GitHubIssue } from '../../../src/core/github.js';
import type { BacklogAnalysis, TodoEntry } from '../../../src/core/analyzers/backlog.js';

function makeVision(overrides: Partial<VisionDocument> = {}): VisionDocument {
  return {
    purpose: 'Build a sprint scoring engine',
    priorities: ['reliability', 'speed'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeComplexity(): ComplexityProfile {
  return { estimatedPar: 4, estimatedSlope: 2, slopeFactors: [], riskAreas: [], busFactor: [] };
}

function makeTodo(overrides: Partial<TodoEntry> = {}): TodoEntry {
  return { type: 'TODO', text: 'Fix this thing', file: 'src/index.ts', line: 10, ...overrides };
}

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return { number: 1, title: 'Test issue', state: 'open', labels: [], createdAt: '2025-01-01T00:00:00Z', ...overrides };
}

function makeEmptyBacklog(): MergedBacklog {
  return { local: { todos: [], todosByModule: {} }, totalItems: 0 };
}

function makeLocalBacklog(todos: TodoEntry[]): BacklogAnalysis {
  const todosByModule: Record<string, TodoEntry[]> = {};
  for (const todo of todos) {
    const mod = todo.file.split('/')[0] ?? 'root';
    if (!todosByModule[mod]) todosByModule[mod] = [];
    todosByModule[mod].push(todo);
  }
  return { todos, todosByModule };
}

function makeRemoteBacklog(issues: GitHubIssue[]): GitHubBacklogAnalysis {
  const issuesByLabel: Record<string, GitHubIssue[]> = {};
  for (const issue of issues) {
    for (const label of issue.labels) {
      if (!issuesByLabel[label]) issuesByLabel[label] = [];
      issuesByLabel[label].push(issue);
    }
  }
  return { issues, issuesByLabel, issuesByMilestone: {}, highPriority: [], milestones: [] };
}

describe('generateRoadmapFromVision', () => {
  it('creates sprints from vision priorities with empty backlog', () => {
    const roadmap = generateRoadmapFromVision(makeVision(), makeEmptyBacklog());
    expect(roadmap.sprints).toHaveLength(2);
    expect(roadmap.phases).toHaveLength(2);
    expect(roadmap.sprints[0].theme).toBe('reliability');
    expect(roadmap.sprints[0].tickets).toHaveLength(1);
    expect(roadmap.sprints[0].tickets[0].title).toContain('reliability');
    expect(roadmap.sprints[1].theme).toBe('speed');
  });

  it('passes validateRoadmap', () => {
    const result = validateRoadmap(generateRoadmapFromVision(makeVision(), makeEmptyBacklog()));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('matches local TODOs by priority keyword', () => {
    const todos = [
      makeTodo({ text: 'Add unit test coverage', file: 'src/utils.ts', line: 5 }),
      makeTodo({ text: 'Refactor database layer', file: 'src/db.ts', line: 10 }),
    ];
    const backlog: MergedBacklog = { local: makeLocalBacklog(todos), totalItems: 2 };
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['testing'] }), backlog);

    expect(roadmap.sprints[0].theme).toBe('testing');
    expect(roadmap.sprints[0].tickets.some(t => t.title.includes('unit test'))).toBe(true);
    const overflow = roadmap.sprints.find(s => s.theme === 'General');
    expect(overflow).toBeDefined();
    expect(overflow!.tickets.some(t => t.title.includes('database'))).toBe(true);
  });

  it('matches GitHub issues by label', () => {
    const issues = [
      makeIssue({ number: 1, title: 'Fix login flow', labels: ['auth', 'bug'] }),
      makeIssue({ number: 2, title: 'Add dark mode', labels: ['feature', 'ui'] }),
    ];
    const backlog: MergedBacklog = { local: makeLocalBacklog([]), remote: makeRemoteBacklog(issues), totalItems: 2 };
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['security'] }), backlog);

    expect(roadmap.sprints[0].tickets.some(t => t.title === 'Fix login flow')).toBe(true);
    const overflow = roadmap.sprints.find(s => s.theme === 'General');
    expect(overflow!.tickets.some(t => t.title === 'Add dark mode')).toBe(true);
  });

  it('matches GitHub issues by title keywords', () => {
    const issues = [
      makeIssue({ number: 1, title: 'Optimize query latency', labels: [] }),
      makeIssue({ number: 2, title: 'Update docs', labels: [] }),
    ];
    const backlog: MergedBacklog = { local: makeLocalBacklog([]), remote: makeRemoteBacklog(issues), totalItems: 2 };
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['performance'] }), backlog);

    expect(roadmap.sprints[0].tickets.some(t => t.title === 'Optimize query latency')).toBe(true);
  });

  it('uses complexity profile for par/slope', () => {
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['reliability'] }), makeEmptyBacklog(), makeComplexity());
    expect(roadmap.sprints[0].par).toBe(4);
    expect(roadmap.sprints[0].slope).toBe(2);
  });

  it('uses defaults when no complexity provided', () => {
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['reliability'] }), makeEmptyBacklog());
    expect(roadmap.sprints[0].par).toBe(4);
    expect(roadmap.sprints[0].slope).toBe(3);
  });

  it('does not double-assign items across priorities', () => {
    const todos = [makeTodo({ text: 'Add test coverage for error handling', file: 'src/test.ts', line: 1 })];
    const backlog: MergedBacklog = { local: makeLocalBacklog(todos), totalItems: 1 };
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['testing', 'reliability'] }), backlog);

    const allTickets = roadmap.sprints.flatMap(s => s.tickets);
    const matching = allTickets.filter(t => t.title.includes('test coverage'));
    expect(matching).toHaveLength(1);
  });

  it('creates proper phase names with capitalized priority', () => {
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['dx'] }), makeEmptyBacklog());
    expect(roadmap.phases[0].name).toContain('Dx');
    expect(roadmap.phases[0].sprints).toEqual([1]);
  });

  it('generates valid ticket keys', () => {
    const todos = [
      makeTodo({ text: 'Optimize render', file: 'src/perf.ts', line: 1 }),
      makeTodo({ text: 'Add benchmark', file: 'src/bench.ts', line: 1 }),
      makeTodo({ text: 'Add unit tests', file: 'src/test.ts', line: 1 }),
    ];
    const backlog: MergedBacklog = { local: makeLocalBacklog(todos), totalItems: 3 };
    const roadmap = generateRoadmapFromVision(makeVision({ priorities: ['speed', 'testing'] }), backlog);

    for (const sprint of roadmap.sprints) {
      for (const ticket of sprint.tickets) {
        expect(ticket.key).toMatch(/^S\d+-\d+$/);
      }
    }
  });
});
