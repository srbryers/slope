import type { MetaphorDefinition } from '../metaphor.js';

export const golf: MetaphorDefinition = {
  id: 'golf',
  name: 'Golf',
  description: 'The original SLOPE metaphor — sprints are holes, tickets are shots, and your handicap tracks improvement over time.',

  vocabulary: {
    sprint: 'hole',
    ticket: 'shot',
    scorecard: 'scorecard',
    handicapCard: 'handicap card',
    briefing: 'pre-round briefing',
    perfectScore: 'hole-in-one',
    onTarget: 'par',
    review: '19th hole',
  },

  clubs: {
    driver: 'Driver',
    long_iron: 'Long Iron',
    short_iron: 'Short Iron',
    wedge: 'Wedge',
    putter: 'Putter',
  },

  shotResults: {
    fairway: 'Fairway',
    green: 'Green',
    in_the_hole: 'In the Hole',
    missed_long: 'Missed Long',
    missed_short: 'Missed Short',
    missed_left: 'Missed Left',
    missed_right: 'Missed Right',
  },

  hazards: {
    bunker: 'Bunker',
    water: 'Water',
    ob: 'Out of Bounds',
    rough: 'Rough',
    trees: 'Trees',
  },

  conditions: {
    wind: 'Wind',
    rain: 'Rain',
    frost_delay: 'Frost Delay',
    altitude: 'Altitude',
    pin_position: 'Pin Position',
  },

  specialPlays: {
    gimme: 'Gimme',
    mulligan: 'Mulligan',
    provisional: 'Provisional',
    lay_up: 'Lay Up',
    scramble: 'Scramble',
  },

  missDirections: {
    long: 'Long (over-engineered)',
    short: 'Short (under-scoped)',
    left: 'Left (wrong approach)',
    right: 'Right (spec drift)',
  },

  scoreLabels: {
    eagle: 'Eagle',
    birdie: 'Birdie',
    par: 'Par',
    bogey: 'Bogey',
    double_bogey: 'Double Bogey',
    triple_plus: 'Triple+',
  },

  sprintTypes: {
    feature: 'Feature',
    feedback: 'Feedback',
    infra: 'Infrastructure',
    bugfix: 'Bug Fix',
    research: 'Research',
    flow: 'Flow',
    'test-coverage': 'Test Coverage',
    audit: 'Course Review',
  },

  trainingTypes: {
    driving_range: 'Driving Range',
    chipping_practice: 'Chipping Practice',
    putting_practice: 'Putting Practice',
    lessons: 'Lessons',
  },

  nutrition: {
    hydration: 'Hydration',
    diet: 'Diet',
    recovery: 'Recovery',
    supplements: 'Supplements',
    stretching: 'Stretching',
  },
};
