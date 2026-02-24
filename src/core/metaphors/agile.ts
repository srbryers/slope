import type { MetaphorDefinition } from '../metaphor.js';

export const agile: MetaphorDefinition = {
  id: 'agile',
  name: 'Agile',
  description: 'Sprints are sprints, tickets are stories, and velocity tracks improvement. Standups, retros, and continuous delivery.',

  vocabulary: {
    sprint: 'sprint',
    ticket: 'story',
    scorecard: 'retro report',
    handicapCard: 'velocity tracker',
    briefing: 'sprint planning',
    perfectScore: 'shipped early',
    onTarget: 'on track',
    review: 'retrospective',
  },

  clubs: {
    driver: 'Epic',
    long_iron: 'Feature',
    short_iron: 'Story',
    wedge: 'Task',
    putter: 'Chore',
  },

  shotResults: {
    fairway: 'In Progress',
    green: 'Done',
    in_the_hole: 'Shipped Early',
    missed_long: 'Over-scoped',
    missed_short: 'Under-delivered',
    missed_left: 'Wrong Priority',
    missed_right: 'Scope Creep',
  },

  hazards: {
    bunker: 'Blocker',
    water: 'Regression',
    ob: 'Rollback',
    rough: 'Tech Debt',
    trees: 'Dependency',
  },

  conditions: {
    wind: 'Changing Requirements',
    rain: 'Team Absence',
    frost_delay: 'Blocked Sprint',
    altitude: 'Complexity Spike',
    pin_position: 'Priority Shift',
  },

  specialPlays: {
    gimme: 'Auto-merge',
    mulligan: 'Revert & Redo',
    provisional: 'Spike',
    lay_up: 'Descope',
    scramble: 'Mob Programming',
  },

  missDirections: {
    long: 'Over-scoped (too much work)',
    short: 'Under-delivered (incomplete)',
    left: 'Wrong Priority (bad ordering)',
    right: 'Scope Creep (drifted)',
  },

  scoreLabels: {
    eagle: 'Crushed It',
    birdie: 'Ahead of Schedule',
    par: 'On Track',
    bogey: 'Slipped',
    double_bogey: 'Missed Sprint Goal',
    triple_plus: 'Failed Sprint',
  },

  sprintTypes: {
    feature: 'Feature Sprint',
    feedback: 'Feedback Sprint',
    infra: 'Platform Sprint',
    bugfix: 'Bug Fix Sprint',
    research: 'Spike Sprint',
    flow: 'Flow Sprint',
    'test-coverage': 'Quality Sprint',
    audit: 'Code Review Sprint',
  },

  trainingTypes: {
    driving_range: 'Tech Talk',
    chipping_practice: 'Pair Programming',
    putting_practice: 'Code Review',
    lessons: 'Workshop',
  },

  nutrition: {
    hydration: 'Communication',
    diet: 'Process Health',
    recovery: 'Cooldown',
    supplements: 'Tooling',
    stretching: 'Refinement',
  },
};
