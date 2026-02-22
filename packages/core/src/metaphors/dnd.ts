import type { MetaphorDefinition } from '../metaphor.js';

export const dnd: MetaphorDefinition = {
  id: 'dnd',
  name: 'D&D',
  description: 'Sprints are encounters, tickets are actions, and your character sheet tracks improvement. Crits, saves, and campaign progress.',

  vocabulary: {
    sprint: 'encounter',
    ticket: 'action',
    scorecard: 'adventure log',
    handicapCard: 'character sheet',
    briefing: 'quest briefing',
    perfectScore: 'natural 20',
    onTarget: 'hit',
    review: 'long rest',
  },

  clubs: {
    driver: 'Fireball',
    long_iron: 'Greatsword',
    short_iron: 'Longsword',
    wedge: 'Dagger',
    putter: 'Cantrip',
  },

  shotResults: {
    fairway: 'Hit',
    green: 'Critical Hit',
    in_the_hole: 'Natural 20',
    missed_long: 'Overshoot (wasted spell slot)',
    missed_short: 'Whiff (under-prepared)',
    missed_left: 'Fumble (wrong action)',
    missed_right: 'Distracted (off-target)',
  },

  hazards: {
    bunker: 'Trap',
    water: 'Curse',
    ob: 'TPK Risk',
    rough: 'Difficult Terrain',
    trees: 'Fog of War',
  },

  conditions: {
    wind: 'Wild Magic',
    rain: 'Environmental Hazard',
    frost_delay: 'Long Rest Required',
    altitude: 'Level Scaling',
    pin_position: 'DM Adjustment',
  },

  specialPlays: {
    gimme: 'Inspiration',
    mulligan: 'Lucky Feat',
    provisional: 'Held Action',
    lay_up: 'Dodge Action',
    scramble: 'Party Assist',
  },

  missDirections: {
    long: 'Overshoot (too much force)',
    short: 'Whiff (not enough)',
    left: 'Fumble (wrong action)',
    right: 'Distracted (off-target)',
  },

  scoreLabels: {
    eagle: 'Natural 20',
    birdie: 'Critical Hit',
    par: 'Hit',
    bogey: 'Miss',
    double_bogey: 'Critical Fail',
    triple_plus: 'Natural 1',
  },

  sprintTypes: {
    feature: 'Main Quest',
    feedback: 'Side Quest',
    infra: 'Downtime',
    bugfix: 'Healing',
    research: 'Investigation',
    flow: 'Combat',
    'test-coverage': 'Training Montage',
  },

  trainingTypes: {
    driving_range: 'Study',
    chipping_practice: 'Sparring',
    putting_practice: 'Meditation',
    lessons: 'Mentoring',
  },

  nutrition: {
    hydration: 'Mana',
    diet: 'Rations',
    recovery: 'Long Rest',
    supplements: 'Potions',
    stretching: 'Short Rest',
  },
};
