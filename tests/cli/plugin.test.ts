import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../../src/cli/commands/init.js';
import { pluginCommand } from '../../src/cli/commands/plugin.js';
import { clearCustomGuards } from '../../src/core/index.js';
import type { MetaphorDefinition } from '../../src/core/index.js';

let tmpDir: string;
let originalCwd: string;
let output: string[] = [];
const origLog = console.log;
const origError = console.error;

function makeTestMetaphor(id: string, name: string): MetaphorDefinition {
  return {
    id,
    name,
    description: `Test metaphor: ${name}`,
    vocabulary: {
      sprint: 'round', ticket: 'play', scorecard: 'report',
      handicapCard: 'stats', briefing: 'prep', perfectScore: 'ace',
      onTarget: 'expected', review: 'recap',
    },
    clubs: { driver: 'D', long_iron: 'LI', short_iron: 'SI', wedge: 'W', putter: 'P' },
    shotResults: { fairway: 'F', green: 'G', in_the_hole: 'ITH', missed_long: 'ML', missed_short: 'MS', missed_left: 'MLe', missed_right: 'MR' },
    hazards: { bunker: 'B', water: 'W', ob: 'OB', rough: 'R', trees: 'T' },
    conditions: { wind: 'W', rain: 'R', frost_delay: 'FD', altitude: 'A', pin_position: 'PP' },
    specialPlays: { gimme: 'G', mulligan: 'M', provisional: 'P', lay_up: 'LU', scramble: 'S' },
    missDirections: { long: 'L', short: 'S', left: 'Le', right: 'Ri' },
    scoreLabels: { eagle: 'E', birdie: 'B', par: 'P', bogey: 'Bo', double_bogey: 'DB', triple_plus: 'T+' },
    sprintTypes: { feature: 'F', feedback: 'FB', infra: 'I', bugfix: 'BF', research: 'R', flow: 'Fl', 'test-coverage': 'TC' },
    trainingTypes: { driving_range: 'DR', chipping_practice: 'CP', putting_practice: 'PP', lessons: 'L' },
    nutrition: { hydration: 'H', diet: 'D', recovery: 'R', supplements: 'S', stretching: 'St' },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-plugin-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  output = [];
  console.log = (...args: unknown[]) => { output.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { output.push(args.join(' ')); };
  clearCustomGuards();
});

afterEach(() => {
  process.chdir(originalCwd);
  console.log = origLog;
  console.error = origError;
  clearCustomGuards();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('init creates plugin directories', () => {
  it('creates .slope/plugins/metaphors and .slope/plugins/guards', async () => {
    await initCommand([]);

    expect(existsSync(join(tmpDir, '.slope', 'plugins', 'metaphors'))).toBe(true);
    expect(existsSync(join(tmpDir, '.slope', 'plugins', 'guards'))).toBe(true);
  });
});

describe('plugin list', () => {
  it('shows built-in metaphors and guards', async () => {
    // Need .slope dir for config
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');

    await pluginCommand(['list']);

    const text = output.join('\n');
    expect(text).toContain('Metaphors:');
    expect(text).toContain('golf');
    expect(text).toContain('Guards:');
    expect(text).toContain('explore');
  });

  it('shows custom plugins with [custom] tag', async () => {
    mkdirSync(join(tmpDir, '.slope', 'plugins', 'metaphors'), { recursive: true });
    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');

    const customMetaphor = makeTestMetaphor('plugin-list-test', 'Plugin List Test');
    writeFileSync(
      join(tmpDir, '.slope', 'plugins', 'metaphors', 'custom.json'),
      JSON.stringify(customMetaphor),
    );

    await pluginCommand(['list']);

    const text = output.join('\n');
    expect(text).toContain('plugin-list-test');
    expect(text).toContain('[custom]');
  });
});

describe('plugin validate', () => {
  it('validates a valid metaphor file', async () => {
    const filePath = join(tmpDir, 'test-metaphor.json');
    const metaphor = { ...makeTestMetaphor('valid-test', 'Valid Test'), type: 'metaphor' };
    writeFileSync(filePath, JSON.stringify(metaphor));

    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');

    await pluginCommand(['validate', filePath]);

    const text = output.join('\n');
    expect(text).toContain('Valid metaphor plugin');
  });

  it('validates a valid guard file', async () => {
    const filePath = join(tmpDir, 'test-guard.json');
    writeFileSync(filePath, JSON.stringify({
      type: 'guard', id: 'test', name: 'Test Guard',
      description: 'A test', hookEvent: 'PreToolUse', level: 'full', command: 'echo test',
    }));

    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');

    await pluginCommand(['validate', filePath]);

    const text = output.join('\n');
    expect(text).toContain('Valid guard plugin');
  });

  it('reports validation errors for invalid plugin', async () => {
    const filePath = join(tmpDir, 'bad.json');
    writeFileSync(filePath, JSON.stringify({ type: 'guard', id: 'bad', name: 'Bad' }));

    mkdirSync(join(tmpDir, '.slope'), { recursive: true });
    writeFileSync(join(tmpDir, '.slope', 'config.json'), '{}');

    const origExit = process.exit;
    let exitCode: number | undefined;
    // @ts-ignore
    process.exit = (code: number) => { exitCode = code; throw new Error('exit'); };

    try {
      await pluginCommand(['validate', filePath]);
    } catch { /* expected exit */ }

    process.exit = origExit;

    const text = output.join('\n');
    expect(text).toContain('Validation FAILED');
    expect(text).toContain('Missing "hookEvent"');
    expect(exitCode).toBe(1);
  });

  it('reports error for missing file', async () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    // @ts-ignore
    process.exit = (code: number) => { exitCode = code; throw new Error('exit'); };

    try {
      await pluginCommand(['validate', '/nonexistent/file.json']);
    } catch { /* expected exit */ }

    process.exit = origExit;

    const text = output.join('\n');
    expect(text).toContain('file not found');
    expect(exitCode).toBe(1);
  });
});

describe('MCP registry entries', () => {
  it('registry includes plugin functions', async () => {
    const { SLOPE_REGISTRY } = await import('../../src/mcp/registry.js');
    const pluginFunctions = SLOPE_REGISTRY.filter(
      (e: { name: string }) =>
        e.name === 'discoverPlugins' ||
        e.name === 'loadPlugins' ||
        e.name === 'loadPluginMetaphors' ||
        e.name === 'loadPluginGuards' ||
        e.name === 'validatePluginManifest' ||
        e.name === 'isPluginEnabled'
    );
    expect(pluginFunctions).toHaveLength(6);
  });
});
