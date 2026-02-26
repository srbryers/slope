// SLOPE — Roadmap Generator
// Generates a RoadmapDefinition from repo analysis, complexity, and merged backlog data.

import type { RepoProfile } from '../analyzers/types.js';
import type { ComplexityProfile } from '../analyzers/complexity.js';
import type { MergedBacklog } from '../analyzers/backlog-merged.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket, RoadmapClub, RoadmapPhase } from '../roadmap.js';
import type { GitHubIssue } from '../github.js';

const ISSUE_REF_PATTERN = /(?:#(\d+)|depends\s+on\s+#(\d+)|blocked\s+by\s+#(\d+))/gi;

/**
 * Generate a roadmap from repo analysis data.
 *
 * Fallback chain:
 * 1. Milestones exist → each milestone = a phase, issues within = sprint tickets
 * 2. Labels but no milestones → group issues by label into sprints
 * 3. No remote data → fall back to local TODO clusters
 */
export function generateRoadmap(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const remote = backlog.remote;
  const hasMilestones = (remote?.milestones?.length ?? 0) > 0;
  const hasRemoteIssues = (remote?.issues?.length ?? 0) > 0;

  if (hasMilestones && hasRemoteIssues) {
    return fromMilestones(profile, complexity, backlog);
  }

  if (hasRemoteIssues) {
    return fromLabels(profile, complexity, backlog);
  }

  return fromLocalTodos(profile, complexity, backlog);
}

function fromMilestones(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const remote = backlog.remote!;
  const phases: RoadmapPhase[] = [];
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  // Map issue numbers to sprint ticket keys for dependency resolution
  const issueToKey = new Map<number, string>();

  for (const ms of remote.milestones) {
    const msIssues = remote.issuesByMilestone[ms.title] ?? [];
    if (msIssues.length === 0) continue;

    const tickets = msIssues.map((issue, i) => {
      const key = `S${sprintNum}-${i + 1}`;
      issueToKey.set(issue.number, key);
      return issueToTicket(issue, key);
    });

    sprints.push({
      id: sprintNum,
      theme: ms.title,
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: inferSprintType(msIssues),
      tickets,
    });

    phases.push({
      name: `Phase ${phases.length + 1} — ${ms.title}`,
      sprints: [sprintNum],
    });

    sprintNum++;
  }

  // Resolve dependencies now that all keys are mapped
  resolveDependencies(sprints, issueToKey, remote.issues);

  return {
    name: `${profile.stack.primaryLanguage} Project`,
    description: 'Auto-generated roadmap from GitHub milestones',
    phases,
    sprints,
  };
}

function fromLabels(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const remote = backlog.remote!;
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  const issueToKey = new Map<number, string>();

  // Sort labels by issue count descending, take top groups
  const labelGroups = Object.entries(remote.issuesByLabel)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);

  const assignedIssues = new Set<number>();

  for (const [label, issues] of labelGroups) {
    // Deduplicate: skip issues already assigned to a sprint
    const unassigned = issues.filter(i => !assignedIssues.has(i.number));
    if (unassigned.length === 0) continue;

    const tickets = unassigned.map((issue, i) => {
      const key = `S${sprintNum}-${i + 1}`;
      issueToKey.set(issue.number, key);
      assignedIssues.add(issue.number);
      return issueToTicket(issue, key);
    });

    sprints.push({
      id: sprintNum,
      theme: `${label} work`,
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: inferSprintType(unassigned),
      tickets,
    });

    sprintNum++;
  }

  resolveDependencies(sprints, issueToKey, remote.issues);

  const phases: RoadmapPhase[] = [{
    name: 'Phase 1 — Backlog',
    sprints: sprints.map(s => s.id),
  }];

  return {
    name: `${profile.stack.primaryLanguage} Project`,
    description: 'Auto-generated roadmap from GitHub issue labels',
    phases,
    sprints,
  };
}

function fromLocalTodos(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  const modules = Object.entries(backlog.local.todosByModule)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 4);

  if (modules.length > 0) {
    const tickets: RoadmapTicket[] = modules.map(([mod, todos], i) => ({
      key: `S${sprintNum}-${i + 1}`,
      title: `Address ${todos.length} TODO${todos.length > 1 ? 's' : ''} in ${mod}`,
      club: (todos.length > 3 ? 'short_iron' : 'wedge') as RoadmapClub,
      complexity: todos.length > 3 ? 'standard' as const : 'small' as const,
    }));

    sprints.push({
      id: sprintNum,
      theme: 'Local Backlog Cleanup',
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: 'maintenance',
      tickets,
    });
  } else {
    // Fallback: generic starter
    sprints.push({
      id: sprintNum,
      theme: 'Getting Started',
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: 'setup',
      tickets: [{
        key: `S${sprintNum}-1`,
        title: 'Set up project infrastructure',
        club: 'short_iron',
        complexity: 'standard',
      }],
    });
  }

  return {
    name: `${profile.stack.primaryLanguage} Project`,
    description: 'Auto-generated roadmap from local backlog',
    phases: [{ name: 'Phase 1 — Setup', sprints: [1] }],
    sprints,
  };
}

function issueToTicket(issue: GitHubIssue, key: string): RoadmapTicket {
  const labels = issue.labels.map(l => l.toLowerCase());
  let club: RoadmapClub = 'short_iron';
  let ticketComplexity: 'trivial' | 'small' | 'standard' | 'moderate' = 'standard';

  if (labels.some(l => l.includes('bug') || l.includes('fix'))) {
    club = 'wedge';
    ticketComplexity = 'small';
  } else if (labels.some(l => l.includes('feature') || l.includes('enhancement'))) {
    club = 'short_iron';
    ticketComplexity = 'standard';
  }

  // Large features: many labels or title hints
  if (labels.some(l => l.includes('epic') || l.includes('large'))) {
    club = 'long_iron';
    ticketComplexity = 'moderate';
  }

  return { key, title: issue.title, club, complexity: ticketComplexity };
}

function inferSprintType(issues: GitHubIssue[]): string {
  const labels = issues.flatMap(i => i.labels.map(l => l.toLowerCase()));
  const hasBugs = labels.some(l => l.includes('bug'));
  const hasFeatures = labels.some(l => l.includes('feature') || l.includes('enhancement'));

  if (hasBugs && hasFeatures) return 'mixed';
  if (hasBugs) return 'bugfix';
  if (hasFeatures) return 'feature';
  return 'general';
}

function resolveDependencies(
  sprints: RoadmapSprint[],
  issueToKey: Map<number, string>,
  allIssues: GitHubIssue[],
): void {
  // Build a lookup from ticket key to sprint id for cross-sprint deps
  const keyToSprint = new Map<string, number>();
  for (const sprint of sprints) {
    for (const ticket of sprint.tickets) {
      keyToSprint.set(ticket.key, sprint.id);
    }
  }

  for (const issue of allIssues) {
    if (!issue.body) continue;
    const ticketKey = issueToKey.get(issue.number);
    if (!ticketKey) continue;

    const ticket = sprints
      .flatMap(s => s.tickets)
      .find(t => t.key === ticketKey);
    if (!ticket) continue;

    const thisSprint = keyToSprint.get(ticketKey)!;
    const deps: string[] = [];

    let match: RegExpExecArray | null;
    const pattern = new RegExp(ISSUE_REF_PATTERN.source, 'gi');
    while ((match = pattern.exec(issue.body)) !== null) {
      const refNum = parseInt(match[1] ?? match[2] ?? match[3], 10);
      const depKey = issueToKey.get(refNum);
      if (depKey && depKey !== ticketKey) {
        const depSprint = keyToSprint.get(depKey);
        // Only add intra-sprint dependencies
        if (depSprint === thisSprint) {
          deps.push(depKey);
        }
      }
    }

    if (deps.length > 0) {
      ticket.depends_on = deps;
    }
  }
}
