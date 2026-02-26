// SLOPE — Config Generator
// Generates a SLOPE config from a RepoProfile.

import type { RepoProfile } from '../analyzers/types.js';

export interface GeneratedConfig {
  projectName: string;
  metaphor: string;
  techStack: string[];
  sprintCadence: 'weekly' | 'biweekly' | 'monthly';
  team: Record<string, string>;  // slug → display name
}

/** Slugify a contributor name for use as a team member key */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Generate a SLOPE config from a RepoProfile.
 * Extracts project name, tech stack, cadence, and team from analyzer data.
 */
export function generateConfig(profile: RepoProfile): GeneratedConfig {
  // Project name from primary language + top framework, or just language
  const projectName = profile.stack.frameworks[0]
    ? `${profile.stack.primaryLanguage}-${profile.stack.frameworks[0]}-project`
    : `${profile.stack.primaryLanguage}-project`;

  // Sprint cadence from inferred git cadence
  let sprintCadence: 'weekly' | 'biweekly' | 'monthly';
  switch (profile.git.inferredCadence) {
    case 'daily':
    case 'weekly':
      sprintCadence = 'weekly';
      break;
    case 'biweekly':
      sprintCadence = 'biweekly';
      break;
    default:
      sprintCadence = 'monthly';
  }

  // Team from top 5 contributors
  const team: Record<string, string> = {};
  for (const contributor of profile.git.contributors.slice(0, 5)) {
    const slug = slugify(contributor.name);
    if (slug) {
      team[slug] = contributor.name;
    }
  }

  return {
    projectName,
    metaphor: 'golf',
    techStack: [...profile.stack.frameworks],
    sprintCadence,
    team,
  };
}
