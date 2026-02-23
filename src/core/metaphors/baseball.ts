import type { MetaphorDefinition } from '../metaphor.js';

export const baseball: MetaphorDefinition = {
  id: 'baseball',
  name: 'Baseball',
  description: 'Sprints are innings, tickets are at-bats, and your batting average tracks improvement. Home runs, strikeouts, and dugout strategy.',

  vocabulary: {
    sprint: 'inning',
    ticket: 'at-bat',
    scorecard: 'box score',
    handicapCard: 'batting average',
    briefing: 'scouting report',
    perfectScore: 'home run',
    onTarget: 'on base',
    review: 'dugout',
  },

  clubs: {
    driver: 'Power Swing',
    long_iron: 'Line Drive',
    short_iron: 'Contact Hit',
    wedge: 'Bunt',
    putter: 'Sacrifice',
  },

  shotResults: {
    fairway: 'Single',
    green: 'Double',
    in_the_hole: 'Home Run',
    missed_long: 'Fly Out (over-swung)',
    missed_short: 'Ground Out (under-swung)',
    missed_left: 'Foul Left (wrong approach)',
    missed_right: 'Foul Right (drifted)',
  },

  hazards: {
    bunker: 'Pickle',
    water: 'Error',
    ob: 'Strikeout',
    rough: 'Bad Hop',
    trees: 'Obstruction',
  },

  conditions: {
    wind: 'Wind',
    rain: 'Rain Delay',
    frost_delay: 'Delayed Start',
    altitude: 'High Altitude',
    pin_position: 'Shift',
  },

  specialPlays: {
    gimme: 'Intentional Walk',
    mulligan: 'Pinch Hitter',
    provisional: 'Switch Hitter',
    lay_up: 'Sacrifice Bunt',
    scramble: 'Double Play',
  },

  missDirections: {
    long: 'Fly Out (over-swung)',
    short: 'Ground Out (under-swung)',
    left: 'Foul Left',
    right: 'Foul Right',
  },

  scoreLabels: {
    eagle: 'Grand Slam',
    birdie: 'Triple',
    par: 'On Base',
    bogey: 'Strikeout',
    double_bogey: 'Double Play',
    triple_plus: 'Shutout',
  },

  sprintTypes: {
    feature: 'Offensive Inning',
    feedback: 'Defensive Inning',
    infra: 'Field Maintenance',
    bugfix: 'Error Recovery',
    research: 'Scouting',
    flow: 'Rally',
    'test-coverage': 'Batting Practice',
  },

  trainingTypes: {
    driving_range: 'Batting Cage',
    chipping_practice: 'Fielding Drills',
    putting_practice: 'Bunting Practice',
    lessons: 'Coaching',
  },

  nutrition: {
    hydration: 'Hydration',
    diet: 'Game Fitness',
    recovery: 'Recovery',
    supplements: 'Equipment',
    stretching: 'Warm-up',
  },
};
