import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-meta-cmd-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  // Create minimal config
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({ metaphor: 'golf' }, null, 2));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('slope metaphor list', () => {
  it('shows all built-in metaphors with descriptions', async () => {
    const { metaphorCommand } = await import('../../src/cli/commands/metaphor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await metaphorCommand(['list']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('golf');
    expect(output).toContain('tennis');
    expect(output).toContain('baseball');
    expect(output).toContain('gaming');
    expect(output).toContain('dnd');
    expect(output).toContain('matrix');
    expect(output).toContain('agile');
  });

  it('shows [active] marker on current metaphor', async () => {
    const { metaphorCommand } = await import('../../src/cli/commands/metaphor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await metaphorCommand(['list']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    // golf is the active metaphor
    expect(output).toContain('[active]');
    // Find the line with [active] and check it contains golf
    const activeLine = logSpy.mock.calls.find(c => String(c[0]).includes('[active]'));
    expect(activeLine).toBeDefined();
    expect(String(activeLine![0])).toContain('golf');
  });

  it('shows [custom] tag for plugin metaphors', async () => {
    // Create a custom metaphor plugin
    const pluginDir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(pluginDir, { recursive: true });

    const customMeta = {
      type: 'metaphor', id: 'cooking', name: 'Cooking', description: 'Kitchen metaphor',
      vocabulary: { sprint: 'meal', ticket: 'course', scorecard: 'menu', handicapCard: 'nutrition', briefing: 'prep', perfectScore: 'star', onTarget: 'done', review: 'tasting' },
      clubs: { driver: 'D', long_iron: 'L', short_iron: 'S', wedge: 'W', putter: 'P' },
      shotResults: { fairway: 'F', green: 'G', in_the_hole: 'I', missed_long: 'ML', missed_short: 'MS', missed_left: 'MLe', missed_right: 'MR' },
      hazards: { bunker: 'B', water: 'W', ob: 'O', rough: 'R', trees: 'T' },
      conditions: { wind: 'W', rain: 'R', frost_delay: 'F', altitude: 'A', pin_position: 'P' },
      specialPlays: { gimme: 'G', mulligan: 'M', provisional: 'P', lay_up: 'L', scramble: 'S' },
      missDirections: { long: 'L', short: 'S', left: 'Le', right: 'R' },
      scoreLabels: { eagle: 'E', birdie: 'B', par: 'P', bogey: 'Bo', double_bogey: 'D', triple_plus: 'T' },
      sprintTypes: { feature: 'F', feedback: 'Fb', infra: 'I', bugfix: 'Bf', research: 'R', flow: 'Fl', 'test-coverage': 'T', audit: 'A' },
      trainingTypes: { driving_range: 'D', chipping_practice: 'C', putting_practice: 'P', lessons: 'L' },
      nutrition: { hydration: 'H', diet: 'D', recovery: 'R', supplements: 'S', stretching: 'St' },
    };
    writeFileSync(join(pluginDir, 'cooking.json'), JSON.stringify(customMeta));

    const { metaphorCommand } = await import('../../src/cli/commands/metaphor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await metaphorCommand(['list']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[custom]');
    expect(output).toContain('cooking');
  });
});

describe('slope metaphor set', () => {
  it('updates config.metaphor', async () => {
    const { metaphorCommand } = await import('../../src/cli/commands/metaphor.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await metaphorCommand(['set', 'gaming']);

    const config = JSON.parse(readFileSync(join(tmpDir, '.slope', 'config.json'), 'utf8'));
    expect(config.metaphor).toBe('gaming');
  });

  it('errors with available IDs for unknown metaphor', async () => {
    const { metaphorCommand } = await import('../../src/cli/commands/metaphor.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(metaphorCommand(['set', 'nonexistent'])).rejects.toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown metaphor'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('golf'));
  });
});

describe('slope metaphor show', () => {
  it('displays all term categories', async () => {
    const { metaphorCommand } = await import('../../src/cli/commands/metaphor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await metaphorCommand(['show', 'gaming']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Metaphor: Gaming');
    expect(output).toContain('Vocabulary:');
    expect(output).toContain('Clubs:');
    expect(output).toContain('Shot Results:');
    expect(output).toContain('Hazards:');
    expect(output).toContain('Conditions:');
    expect(output).toContain('Special Plays:');
    expect(output).toContain('Miss Directions:');
    expect(output).toContain('Score Labels:');
    expect(output).toContain('Sprint Types:');
    expect(output).toContain('Training Types:');
    expect(output).toContain('Nutrition:');
    // Check some specific gaming terms
    expect(output).toContain('Boss Fight');
    expect(output).toContain('S-Rank');
  });
});
