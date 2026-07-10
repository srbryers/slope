import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CLI_COMMAND_REGISTRY, CLI_INTERNAL_MODULES } from '../../src/cli/registry.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('CLI_COMMAND_REGISTRY', () => {
  it('has no duplicate command names', () => {
    const names = CLI_COMMAND_REGISTRY.map(c => c.cmd);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every entry has valid category', () => {
    const validCategories = ['lifecycle', 'scoring', 'analysis', 'tooling', 'planning'];
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(validCategories).toContain(entry.category);
    }
  });

  it('every entry has valid audience metadata', () => {
    const validAudiences = ['human', 'agent', 'advanced', 'internal'];
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(validAudiences).toContain(entry.audience);
    }
  });

  it('keeps the human command surface intentional and bounded', () => {
    const humanCommands = CLI_COMMAND_REGISTRY
      .filter(entry => entry.audience === 'human')
      .map(entry => entry.cmd)
      .sort();

    expect(humanCommands).toEqual([
      'briefing',
      'card',
      'doctor',
      'help',
      'init',
      'now',
      'quickstart',
      'review',
      'roadmap',
      'start',
      'status',
      'vision',
    ]);
  });

  it('every entry has non-empty cmd and desc', () => {
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(entry.cmd.length).toBeGreaterThan(0);
      expect(entry.desc.length).toBeGreaterThan(0);
    }
  });

  it('registers bounded roadmap focus for help and agent discovery', () => {
    const roadmap = CLI_COMMAND_REGISTRY.find(entry => entry.cmd === 'roadmap');
    const focus = roadmap?.subcommands?.find(subcommand => subcommand.name === 'focus');

    expect(focus?.flags?.map(flag => flag.flag)).toEqual(['--sprint=<N>', '--path=<file>', '--json']);
  });

  it('registers the audited sprint rollover surface', () => {
    const sprint = CLI_COMMAND_REGISTRY.find(entry => entry.cmd === 'sprint');
    const rollover = sprint?.subcommands?.find(subcommand => subcommand.name === 'rollover');

    expect(rollover?.flags?.map(flag => flag.flag)).toEqual([
      '--from=<N>',
      '--to=<N>',
      '--force',
      '--reason=<text>',
    ]);
  });

  it('registry + internal modules matches the actual command files on disk', () => {
    const commandsDir = join(__dirname, '../../src/cli/commands');
    const files = readdirSync(commandsDir)
      .filter(f => f.endsWith('.ts'))
      .map(f => f.replace('.ts', ''))
      .sort();

    const registryNames = [...CLI_COMMAND_REGISTRY.map(c => c.cmd), ...CLI_INTERNAL_MODULES].sort();
    expect(registryNames).toEqual(files);
  });

  it('does not contain any internal modules', () => {
    const registryNames = new Set(CLI_COMMAND_REGISTRY.map(c => c.cmd));
    for (const internal of CLI_INTERNAL_MODULES) {
      expect(registryNames.has(internal)).toBe(false);
    }
  });
});
