import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validatePluginManifest,
  discoverPlugins,
  isPluginEnabled,
  loadPluginMetaphors,
  loadPluginGuards,
  loadPlugins,
} from '../../src/core/plugins.js';
import type { PluginsConfig } from '../../src/core/plugins.js';
import { hasMetaphor, getMetaphor } from '../../src/core/metaphor.js';
import { getCustomGuard, clearCustomGuards, getAllGuardDefinitions, GUARD_DEFINITIONS } from '../../src/core/guard.js';
import type { MetaphorDefinition } from '../../src/core/metaphor.js';

// --- Test fixture: a valid custom metaphor ---
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

function makeTestGuard(name: string) {
  return {
    type: 'guard' as const,
    id: name,
    name,
    description: `Test guard: ${name}`,
    hookEvent: 'PreToolUse',
    matcher: 'Edit',
    level: 'full',
    command: `echo ${name}`,
  };
}

describe('validatePluginManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validatePluginManifest({ type: 'metaphor', id: 'test', name: 'Test' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-object input', () => {
    expect(validatePluginManifest(null).valid).toBe(false);
    expect(validatePluginManifest('string').valid).toBe(false);
    expect(validatePluginManifest(42).valid).toBe(false);
  });

  it('rejects missing type', () => {
    const result = validatePluginManifest({ id: 'test', name: 'Test' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "type" (must be "metaphor" or "guard")');
  });

  it('rejects invalid type value', () => {
    const result = validatePluginManifest({ type: 'widget', id: 'test', name: 'Test' });
    expect(result.valid).toBe(false);
  });

  it('rejects missing id', () => {
    const result = validatePluginManifest({ type: 'metaphor', name: 'Test' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "id" (must be a non-empty string)');
  });

  it('rejects missing name', () => {
    const result = validatePluginManifest({ type: 'metaphor', id: 'test' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "name" (must be a non-empty string)');
  });

  it('collects multiple errors', () => {
    const result = validatePluginManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it('accepts guard type', () => {
    const result = validatePluginManifest({ type: 'guard', id: 'my-guard', name: 'My Guard' });
    expect(result.valid).toBe(true);
  });
});

describe('discoverPlugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-plugins-discover-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when .slope/plugins does not exist', () => {
    expect(discoverPlugins(tmpDir)).toEqual([]);
  });

  it('discovers metaphor plugins', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    const metaphor = makeTestMetaphor('disco-test', 'Disco Test');
    writeFileSync(join(dir, 'disco.json'), JSON.stringify(metaphor));

    const found = discoverPlugins(tmpDir);
    expect(found).toHaveLength(1);
    expect(found[0].manifest.id).toBe('disco-test');
    expect(found[0].manifest.type).toBe('metaphor');
  });

  it('discovers guard plugins', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'my-guard.json'), JSON.stringify(makeTestGuard('test-guard')));

    const found = discoverPlugins(tmpDir);
    expect(found).toHaveLength(1);
    expect(found[0].manifest.type).toBe('guard');
    expect(found[0].manifest.name).toBe('test-guard');
  });

  it('skips non-JSON files', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'readme.md'), '# Custom metaphors');

    expect(discoverPlugins(tmpDir)).toEqual([]);
  });

  it('skips invalid JSON', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), 'not json');

    expect(discoverPlugins(tmpDir)).toEqual([]);
  });

  it('skips files with invalid manifest', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ something: 'else' }));

    expect(discoverPlugins(tmpDir)).toEqual([]);
  });

  it('deduplicates plugins with same type+id', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    const m = makeTestMetaphor('dup-test', 'Dup');
    writeFileSync(join(dir, 'a.json'), JSON.stringify(m));
    writeFileSync(join(dir, 'b.json'), JSON.stringify(m));

    const found = discoverPlugins(tmpDir);
    expect(found).toHaveLength(1);
  });

  it('discovers from both metaphors and guards dirs', () => {
    const mDir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    const gDir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(mDir, { recursive: true });
    mkdirSync(gDir, { recursive: true });

    writeFileSync(join(mDir, 'custom.json'), JSON.stringify(makeTestMetaphor('multi-m', 'Multi M')));
    writeFileSync(join(gDir, 'custom.json'), JSON.stringify(makeTestGuard('multi-g')));

    const found = discoverPlugins(tmpDir);
    expect(found).toHaveLength(2);
    expect(found.map(p => p.manifest.type)).toContain('metaphor');
    expect(found.map(p => p.manifest.type)).toContain('guard');
  });
});

describe('isPluginEnabled', () => {
  it('returns true when no config provided', () => {
    expect(isPluginEnabled('any')).toBe(true);
  });

  it('returns true when not in disabled list', () => {
    const config: PluginsConfig = { disabled: ['other'] };
    expect(isPluginEnabled('my-plugin', config)).toBe(true);
  });

  it('returns false when in disabled list', () => {
    const config: PluginsConfig = { disabled: ['my-plugin'] };
    expect(isPluginEnabled('my-plugin', config)).toBe(false);
  });

  it('returns true when in enabled list', () => {
    const config: PluginsConfig = { enabled: ['my-plugin'] };
    expect(isPluginEnabled('my-plugin', config)).toBe(true);
  });

  it('returns false when enabled list exists but plugin not in it', () => {
    const config: PluginsConfig = { enabled: ['other'] };
    expect(isPluginEnabled('my-plugin', config)).toBe(false);
  });

  it('disabled takes priority over enabled', () => {
    const config: PluginsConfig = { enabled: ['my-plugin'], disabled: ['my-plugin'] };
    expect(isPluginEnabled('my-plugin', config)).toBe(false);
  });
});

describe('loadPluginMetaphors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-plugins-metaphors-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty result when directory does not exist', () => {
    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('loads and registers a valid metaphor plugin', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    const metaphor = makeTestMetaphor('plugin-test-metaphor', 'Plugin Test');
    writeFileSync(join(dir, 'test.json'), JSON.stringify(metaphor));

    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(hasMetaphor('plugin-test-metaphor')).toBe(true);
    expect(getMetaphor('plugin-test-metaphor').name).toBe('Plugin Test');
  });

  it('reports validation errors for incomplete metaphor', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({
      id: 'incomplete',
      name: 'Incomplete',
      description: 'Missing everything',
      vocabulary: {},
      clubs: {}, shotResults: {}, hazards: {}, conditions: {},
      specialPlays: {}, missDirections: {}, scoreLabels: {},
      sprintTypes: {}, trainingTypes: {}, nutrition: {},
    }));

    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].error).toContain('missing term');
  });

  it('skips disabled plugins', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    const metaphor = makeTestMetaphor('disabled-meta', 'Disabled');
    writeFileSync(join(dir, 'test.json'), JSON.stringify(metaphor));

    const result = loadPluginMetaphors(tmpDir, { disabled: ['disabled-meta'] });
    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toEqual([]);
  });

  it('reports error for missing id', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'no-id.json'), JSON.stringify({ name: 'No Id' }));

    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors[0].error).toContain('Missing "id"');
  });

  it('can override a built-in metaphor', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    const override = makeTestMetaphor('golf', 'Custom Golf');
    writeFileSync(join(dir, 'golf-override.json'), JSON.stringify(override));

    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toHaveLength(1);
    // The override is registered (though the original golf is already there from import)
    expect(getMetaphor('golf').name).toBe('Custom Golf');
  });

  it('loads multiple metaphor plugins', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'alpha.json'), JSON.stringify(makeTestMetaphor('multi-alpha', 'Alpha')));
    writeFileSync(join(dir, 'beta.json'), JSON.stringify(makeTestMetaphor('multi-beta', 'Beta')));

    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toHaveLength(2);
    expect(hasMetaphor('multi-alpha')).toBe(true);
    expect(hasMetaphor('multi-beta')).toBe(true);
  });

  it('reports error for invalid JSON', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), 'not json at all');

    const result = loadPluginMetaphors(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors.length).toBe(1);
  });
});

describe('loadPluginGuards', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-plugins-guards-'));
    clearCustomGuards();
  });

  afterEach(() => {
    clearCustomGuards();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty result when directory does not exist', () => {
    const result = loadPluginGuards(tmpDir);
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('loads and registers a valid guard plugin', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lint.json'), JSON.stringify(makeTestGuard('lint-check')));

    const result = loadPluginGuards(tmpDir);
    expect(result.loaded).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(getCustomGuard('lint-check')).toBeDefined();
    expect(getCustomGuard('lint-check')!.command).toBe('echo lint-check');
  });

  it('reports error for missing command', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({
      type: 'guard', name: 'no-cmd', description: 'Missing command',
      hookEvent: 'PreToolUse', level: 'full',
    }));

    const result = loadPluginGuards(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors[0].error).toContain('Missing "command"');
  });

  it('reports error for missing hookEvent', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({
      type: 'guard', name: 'no-event', description: 'Missing hookEvent',
      level: 'full', command: 'echo test',
    }));

    const result = loadPluginGuards(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors[0].error).toContain('Missing "hookEvent"');
  });

  it('reports error for invalid level', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({
      type: 'guard', name: 'bad-level', description: 'Bad level',
      hookEvent: 'PreToolUse', level: 'ultra', command: 'echo test',
    }));

    const result = loadPluginGuards(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors[0].error).toContain('Missing or invalid "level"');
  });

  it('skips disabled plugins', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'skip.json'), JSON.stringify(makeTestGuard('skip-me')));

    const result = loadPluginGuards(tmpDir, { disabled: ['skip-me'] });
    expect(result.loaded).toHaveLength(0);
  });

  it('idempotent — loading same guard twice only registers once', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'idem.json'), JSON.stringify(makeTestGuard('idem-guard')));

    loadPluginGuards(tmpDir);
    loadPluginGuards(tmpDir);

    const all = getAllGuardDefinitions();
    const matches = all.filter(g => g.name === 'idem-guard');
    expect(matches).toHaveLength(1);
  });

  it('getAllGuardDefinitions includes custom guards', () => {
    const dir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'custom.json'), JSON.stringify(makeTestGuard('all-defs-test')));

    loadPluginGuards(tmpDir);

    const all = getAllGuardDefinitions();
    expect(all.length).toBe(GUARD_DEFINITIONS.length + 1);
    expect(all.some(g => g.name === 'all-defs-test')).toBe(true);
    // Built-ins still present
    expect(all.some(g => g.name === 'explore')).toBe(true);
  });
});

describe('loadPlugins (combined)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-plugins-combined-'));
    clearCustomGuards();
  });

  afterEach(() => {
    clearCustomGuards();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads both metaphors and guards', () => {
    const mDir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    const gDir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(mDir, { recursive: true });
    mkdirSync(gDir, { recursive: true });

    writeFileSync(join(mDir, 'combo-m.json'), JSON.stringify(makeTestMetaphor('combo-metaphor', 'Combo')));
    writeFileSync(join(gDir, 'combo-g.json'), JSON.stringify(makeTestGuard('combo-guard')));

    const result = loadPlugins(tmpDir);
    expect(result.loaded).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(hasMetaphor('combo-metaphor')).toBe(true);
    expect(getCustomGuard('combo-guard')).toBeDefined();
  });

  it('collects errors from both types', () => {
    const mDir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    const gDir = join(tmpDir, '.slope', 'plugins', 'guards');
    mkdirSync(mDir, { recursive: true });
    mkdirSync(gDir, { recursive: true });

    writeFileSync(join(mDir, 'bad.json'), JSON.stringify({ id: 'bad', name: 'Bad', description: 'x', vocabulary: {}, clubs: {}, shotResults: {}, hazards: {}, conditions: {}, specialPlays: {}, missDirections: {}, scoreLabels: {}, sprintTypes: {}, trainingTypes: {}, nutrition: {} }));
    writeFileSync(join(gDir, 'bad.json'), JSON.stringify({ type: 'guard', name: 'bad' }));

    const result = loadPlugins(tmpDir);
    expect(result.loaded).toHaveLength(0);
    expect(result.errors.length).toBe(2);
  });

  it('respects plugins config filtering', () => {
    const mDir = join(tmpDir, '.slope', 'plugins', 'metaphors');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, 'enabled.json'), JSON.stringify(makeTestMetaphor('enabled-one', 'Enabled')));
    writeFileSync(join(mDir, 'blocked.json'), JSON.stringify(makeTestMetaphor('blocked-one', 'Blocked')));

    const result = loadPlugins(tmpDir, { disabled: ['blocked-one'] });
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].manifest.id).toBe('enabled-one');
  });
});
