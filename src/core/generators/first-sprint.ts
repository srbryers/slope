// SLOPE — First Sprint Generator
// Generates a starter roadmap + sprint from RepoProfile and ComplexityProfile.

import type { RepoProfile } from '../analyzers/types.js';
import type { ComplexityProfile } from '../analyzers/complexity.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket, RoadmapClub } from '../roadmap.js';

export interface BacklogAnalysis {
  todos: Array<{ type: string; text: string; file: string; line: number }>;
  todosByModule: Record<string, Array<{ type: string; text: string; file: string; line: number }>>;
  changelogUnreleased?: string[];
}

export interface GeneratedSprint {
  roadmap: RoadmapDefinition;
  sprint: RoadmapSprint;
}

/**
 * Generate a first sprint plan from repo analysis data.
 * Uses TODO clusters from backlog and detected gaps to build tickets.
 */
export function generateFirstSprint(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog?: BacklogAnalysis,
): GeneratedSprint {
  const tickets: RoadmapTicket[] = [];
  let ticketNum = 1;

  // Add tickets from TODO clusters (top 3-4 by module size)
  if (backlog) {
    const modules = Object.entries(backlog.todosByModule)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 3);

    for (const [mod, todos] of modules) {
      const topTodo = todos[0];
      tickets.push({
        key: `S1-${ticketNum}`,
        title: `Address ${todos.length} TODO${todos.length > 1 ? 's' : ''} in ${mod}`,
        club: todos.length > 3 ? 'short_iron' as RoadmapClub : 'wedge' as RoadmapClub,
        complexity: todos.length > 3 ? 'standard' : 'small',
      });
      ticketNum++;
    }
  }

  // Add setup tasks for detected gaps
  if (!profile.testing.framework) {
    tickets.push({
      key: `S1-${ticketNum}`,
      title: 'Configure test framework',
      club: 'wedge',
      complexity: 'small',
    });
    ticketNum++;
  }

  if (!profile.testing.hasCoverage && profile.testing.framework) {
    tickets.push({
      key: `S1-${ticketNum}`,
      title: 'Add test coverage reporting',
      club: 'short_iron',
      complexity: 'standard',
    });
    ticketNum++;
  }

  // If no tickets yet, add a generic starter
  if (tickets.length === 0) {
    tickets.push({
      key: `S1-${ticketNum}`,
      title: 'Set up project infrastructure',
      club: 'short_iron',
      complexity: 'standard',
    });
    ticketNum++;
  }

  const sprint: RoadmapSprint = {
    id: 1,
    theme: 'Getting Started',
    par: complexity.estimatedPar,
    slope: complexity.estimatedSlope,
    type: 'setup',
    tickets,
  };

  const roadmap: RoadmapDefinition = {
    name: `${profile.stack.primaryLanguage} Project`,
    description: `Auto-generated roadmap from repo analysis`,
    phases: [{ name: 'Phase 1 — Setup', sprints: [1] }],
    sprints: [sprint],
  };

  return { roadmap, sprint };
}
