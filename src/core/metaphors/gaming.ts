import type { MetaphorDefinition } from '../metaphor.js';

export const gaming: MetaphorDefinition = {
  id: 'gaming',
  name: 'Gaming',
  description: 'Sprints are levels, tickets are quests, and your XP tracks improvement. Boss fights, power-ups, and speedruns.',

  vocabulary: {
    sprint: 'level',
    ticket: 'quest',
    scorecard: 'score screen',
    handicapCard: 'player stats',
    briefing: 'quest log',
    perfectScore: 'S-rank',
    onTarget: 'clear',
    review: 'save point',
  },

  clubs: {
    driver: 'Boss Fight',
    long_iron: 'Dungeon',
    short_iron: 'Side Quest',
    wedge: 'Fetch Quest',
    putter: 'Tutorial',
  },

  shotResults: {
    fairway: 'Progress',
    green: 'Clear',
    in_the_hole: 'S-Rank',
    missed_long: 'Over-leveled',
    missed_short: 'Under-leveled',
    missed_left: 'Wrong Path',
    missed_right: 'Side-tracked',
  },

  hazards: {
    bunker: 'Trap',
    water: 'Glitch',
    ob: 'Soft Lock',
    rough: 'Lag',
    trees: 'Maze',
  },

  conditions: {
    wind: 'RNG',
    rain: 'Server Issues',
    frost_delay: 'Loading Screen',
    altitude: 'Difficulty Spike',
    pin_position: 'Meta Shift',
  },

  specialPlays: {
    gimme: 'Skip Cutscene',
    mulligan: 'Quick Load',
    provisional: 'Save Scum',
    lay_up: 'Grind',
    scramble: 'Co-op',
  },

  missDirections: {
    long: 'Over-leveled (too much scope)',
    short: 'Under-leveled (not enough)',
    left: 'Wrong Path (bad approach)',
    right: 'Side-tracked (drifted)',
  },

  scoreLabels: {
    eagle: 'S-Rank',
    birdie: 'A-Rank',
    par: 'B-Rank',
    bogey: 'C-Rank',
    double_bogey: 'D-Rank',
    triple_plus: 'Game Over',
  },

  sprintTypes: {
    feature: 'Main Quest',
    feedback: 'Side Quest',
    infra: 'Base Building',
    bugfix: 'Bug Hunt',
    research: 'Exploration',
    flow: 'Speedrun',
    'test-coverage': 'Training Arena',
    audit: 'Code Review',
  },

  trainingTypes: {
    driving_range: 'Exploration',
    chipping_practice: 'Combo Practice',
    putting_practice: 'Precision Training',
    lessons: 'Tutorial',
  },

  nutrition: {
    hydration: 'Mana',
    diet: 'HP',
    recovery: 'Rest at Inn',
    supplements: 'Power-ups',
    stretching: 'Buff',
  },
};
