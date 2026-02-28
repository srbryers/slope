import { describe, it, expect } from 'vitest';
import {
  buildMetaphorPreview,
  buildAllPreviews,
  formatPreviewText,
} from '../../src/core/metaphor-preview.js';
import { generateInterviewSteps } from '../../src/core/interview-steps.js';
import type { MetaphorDefinition } from '../../src/core/metaphor.js';
import type { InterviewContext } from '../../src/core/interview-engine.js';

// Register built-in metaphors
import '../../src/core/metaphors/index.js';
import { golf } from '../../src/core/metaphors/golf.js';
import { gaming } from '../../src/core/metaphors/gaming.js';
import { listMetaphors } from '../../src/core/metaphor.js';

describe('buildMetaphorPreview', () => {
  it('generates preview for each built-in metaphor', () => {
    const builtins = listMetaphors();
    for (const m of builtins) {
      const preview = buildMetaphorPreview(m);
      expect(preview.id).toBe(m.id);
      expect(preview.name).toBe(m.name);
      expect(preview.tagline).toBeTruthy();
    }
  });

  it('includes all vocabulary keys', () => {
    const preview = buildMetaphorPreview(golf);
    expect(preview.vocabulary.sprint).toBe('hole');
    expect(preview.vocabulary.ticket).toBe('shot');
    expect(preview.vocabulary.scorecard).toBe('scorecard');
    expect(preview.vocabulary.perfectScore).toBe('hole-in-one');
    expect(preview.vocabulary.onTarget).toBe('par');
    expect(preview.vocabulary.review).toBe('19th hole');
  });

  it('includes sampleTerms with at least 5 entries', () => {
    const preview = buildMetaphorPreview(gaming);
    expect(preview.sampleTerms.length).toBeGreaterThanOrEqual(5);
    // Each entry has category, key, term
    for (const t of preview.sampleTerms) {
      expect(t.category).toBeTruthy();
      expect(t.key).toBeTruthy();
      expect(t.term).toBeTruthy();
    }
  });

  it('includes sampleOutput string', () => {
    const preview = buildMetaphorPreview(gaming);
    expect(preview.sampleOutput).toContain('Level 7');
    expect(preview.sampleOutput).toContain('Gaming');
    expect(preview.sampleOutput).toContain('S-Rank');
  });

  it('handles custom metaphor with missing optional terms defensively', () => {
    // Partial metaphor — some terms missing
    const partial: MetaphorDefinition = {
      id: 'test-partial',
      name: 'Test',
      description: 'A test metaphor',
      vocabulary: {
        sprint: 'cycle',
        ticket: 'task',
        scorecard: 'report',
        handicapCard: 'stats',
        briefing: 'briefing',
        perfectScore: 'perfect',
        onTarget: 'target',
        review: 'retro',
      },
      clubs: { driver: 'Big', long_iron: 'Medium', short_iron: 'Small', wedge: 'Tiny', putter: 'Micro' },
      shotResults: { fairway: 'OK', green: 'Good', in_the_hole: 'Perfect', missed_long: 'Over', missed_short: 'Under', missed_left: 'Left', missed_right: 'Right' },
      hazards: { bunker: 'Trap', water: 'Leak', ob: 'Lost', rough: 'Rough', trees: 'Block' },
      conditions: { wind: 'A', rain: 'B', frost_delay: 'C', altitude: 'D', pin_position: 'E' },
      specialPlays: { gimme: 'A', mulligan: 'B', provisional: 'C', lay_up: 'D', scramble: 'E' },
      missDirections: { long: 'A', short: 'B', left: 'C', right: 'D' },
      scoreLabels: { eagle: 'Great', birdie: 'Good', par: 'OK', bogey: 'Bad', double_bogey: 'Worse', triple_plus: 'Worst' },
      sprintTypes: { feature: 'A', feedback: 'B', infra: 'C', bugfix: 'D', research: 'E', flow: 'F', 'test-coverage': 'G', audit: 'H' },
      trainingTypes: { driving_range: 'A', chipping_practice: 'B', putting_practice: 'C', lessons: 'D' },
      nutrition: { hydration: 'A', diet: 'B', recovery: 'C', supplements: 'D', stretching: 'E' },
    };
    const preview = buildMetaphorPreview(partial);
    expect(preview.id).toBe('test-partial');
    expect(preview.vocabulary.sprint).toBe('cycle');
    expect(preview.sampleOutput).toBeTruthy();
  });
});

describe('buildAllPreviews', () => {
  it('returns previews for all registered metaphors', () => {
    const all = buildAllPreviews();
    const ids = all.map((p) => p.id);
    expect(ids).toContain('golf');
    expect(ids).toContain('gaming');
    expect(ids).toContain('tennis');
    expect(ids).toContain('dnd');
    expect(ids).toContain('matrix');
    expect(ids).toContain('agile');
    expect(ids).toContain('baseball');
  });
});

describe('formatPreviewText', () => {
  it('produces readable multi-line string', () => {
    const preview = buildMetaphorPreview(gaming);
    const text = formatPreviewText(preview);
    expect(text).toContain('Boss fights');
    expect(text).toContain('Sprint = level');
    expect(text).toContain('Ticket = quest');
    expect(text).toContain('Sample output:');
    expect(text.split('\n').length).toBeGreaterThan(10);
  });
});

describe('interview steps integration', () => {
  it('metaphor step options include preview data after generateInterviewSteps', () => {
    const ctx: InterviewContext = { cwd: '/tmp', detected: { detectedPlatforms: [] } };
    const steps = generateInterviewSteps(ctx);
    const metaphorStep = steps.find((s) => s.id === 'metaphor');
    expect(metaphorStep).toBeDefined();
    const golfOpt = metaphorStep!.options!.find((o) => o.value === 'golf');
    expect(golfOpt?.preview).toBeDefined();
    expect((golfOpt!.preview as { tagline: string }).tagline).toContain('Fairways');
    // Custom option should have no preview
    const customOpt = metaphorStep!.options!.find((o) => o.value === 'custom');
    expect(customOpt?.preview).toBeUndefined();
  });
});
