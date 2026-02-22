import type { MetaphorDefinition } from '../metaphor.js';

export const tennis: MetaphorDefinition = {
  id: 'tennis',
  name: 'Tennis',
  description: 'Sprints are sets, tickets are points, and your ranking tracks improvement. Aces, volleys, and match strategy.',

  vocabulary: {
    sprint: 'set',
    ticket: 'point',
    scorecard: 'match report',
    handicapCard: 'player ranking',
    briefing: 'pre-match scouting',
    perfectScore: 'ace',
    onTarget: 'game point',
    review: 'post-match',
  },

  clubs: {
    driver: 'Power Serve',
    long_iron: 'Baseline Rally',
    short_iron: 'Approach Shot',
    wedge: 'Drop Shot',
    putter: 'Tap-in',
  },

  shotResults: {
    fairway: 'In Play',
    green: 'Winner',
    in_the_hole: 'Ace',
    missed_long: 'Long (out of bounds)',
    missed_short: 'Short (into net)',
    missed_left: 'Wide Left',
    missed_right: 'Wide Right',
  },

  hazards: {
    bunker: 'Double Fault',
    water: 'Unforced Error',
    ob: 'Foot Fault',
    rough: 'Bad Bounce',
    trees: 'Net Cord',
  },

  conditions: {
    wind: 'Wind',
    rain: 'Rain Delay',
    frost_delay: 'Schedule Delay',
    altitude: 'Surface Change',
    pin_position: 'Opponent Shift',
  },

  specialPlays: {
    gimme: 'Walkover',
    mulligan: 'Let (replay)',
    provisional: 'Challenge',
    lay_up: 'Moonball',
    scramble: 'Doubles Rally',
  },

  missDirections: {
    long: 'Long (over-hit)',
    short: 'Short (under-hit)',
    left: 'Wide Left',
    right: 'Wide Right',
  },

  scoreLabels: {
    eagle: 'Bagel Set',
    birdie: 'Break of Serve',
    par: 'Game Point',
    bogey: 'Deuce',
    double_bogey: 'Broken Serve',
    triple_plus: 'Bageled',
  },

  sprintTypes: {
    feature: 'Offensive Set',
    feedback: 'Return Game',
    infra: 'Court Maintenance',
    bugfix: 'Error Correction',
    research: 'Film Study',
    flow: 'Rally',
    'test-coverage': 'Practice Match',
  },

  trainingTypes: {
    driving_range: 'Serve Practice',
    chipping_practice: 'Volley Drills',
    putting_practice: 'Touch Practice',
    lessons: 'Coaching Session',
  },

  nutrition: {
    hydration: 'Hydration',
    diet: 'Match Fitness',
    recovery: 'Recovery',
    supplements: 'Equipment',
    stretching: 'Warm-up',
  },
};
