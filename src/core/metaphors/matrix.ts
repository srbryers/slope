import type { MetaphorDefinition } from '../metaphor.js';

export const matrix: MetaphorDefinition = {
  id: 'matrix',
  name: 'Matrix',
  description: 'Sprints are simulations, tickets are operations, and your operator rating tracks improvement. Red pills, glitches, and bullettime.',

  vocabulary: {
    sprint: 'simulation',
    ticket: 'operation',
    scorecard: 'mission debrief',
    handicapCard: 'operator rating',
    briefing: 'operator briefing',
    perfectScore: 'bullettime',
    onTarget: 'connected',
    review: 'debrief',
  },

  clubs: {
    driver: 'Red Pill',
    long_iron: 'Upload',
    short_iron: 'Patch',
    wedge: 'Hotfix',
    putter: 'Tweak',
  },

  shotResults: {
    fairway: 'Connected',
    green: 'Decoded',
    in_the_hole: 'Bullettime',
    missed_long: 'Overload (too much scope)',
    missed_short: 'Dropout (incomplete)',
    missed_left: 'Glitch (wrong path)',
    missed_right: 'Drift (off-mission)',
  },

  hazards: {
    bunker: 'Firewall',
    water: 'Memory Leak',
    ob: 'System Crash',
    rough: 'Latency',
    trees: 'Encryption',
  },

  conditions: {
    wind: 'Signal Noise',
    rain: 'Cascade Failure',
    frost_delay: 'Boot Sequence',
    altitude: 'Stack Overflow',
    pin_position: 'Protocol Shift',
  },

  specialPlays: {
    gimme: 'Auto-complete',
    mulligan: 'System Restore',
    provisional: 'Fork',
    lay_up: 'Safe Mode',
    scramble: 'Swarm',
  },

  missDirections: {
    long: 'Overload (too much scope)',
    short: 'Dropout (incomplete)',
    left: 'Glitch (wrong path)',
    right: 'Drift (off-mission)',
  },

  scoreLabels: {
    eagle: 'The One',
    birdie: 'Bullettime',
    par: 'Connected',
    bogey: 'Lag',
    double_bogey: 'Blue Screen',
    triple_plus: 'Unplugged',
  },

  sprintTypes: {
    feature: 'Upload',
    feedback: 'Feedback Loop',
    infra: 'System Upgrade',
    bugfix: 'Debug',
    research: 'Recon',
    flow: 'Overclock',
    'test-coverage': 'Diagnostic',
    audit: 'System Audit',
  },

  trainingTypes: {
    driving_range: 'Simulation',
    chipping_practice: 'Calibration',
    putting_practice: 'Fine-tuning',
    lessons: 'Download',
  },

  nutrition: {
    hydration: 'Bandwidth',
    diet: 'Core Integrity',
    recovery: 'Defrag',
    supplements: 'Plugins',
    stretching: 'Pre-flight',
  },
};
