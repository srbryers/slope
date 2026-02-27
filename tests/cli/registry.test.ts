import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_COMMAND_REGISTRY } from '../../src/cli/registry.js';
import type { CliCommandMeta } from '../../src/cli/registry.js';

describe('CLI_COMMAND_REGISTRY', () => {
  it('has entries', () => {
    expect(CLI_COMMAND_REGISTRY.length).toBeGreaterThan(0);
  });

  it('has no duplicate command names', () => {
    const names = CLI_COMMAND_REGISTRY.map((c: CliCommandMeta) => c.cmd);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every entry has valid category', () => {
    const validCategories = ['lifecycle', 'scoring', 'analysis', 'tooling', 'planning'];
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(validCategories).toContain(entry.category);
    }
  });

  it('every entry has non-empty cmd and desc', () => {
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(entry.cmd.length).toBeGreaterThan(0);
      expect(entry.desc.length).toBeGreaterThan(0);
    }
  });

  it('matches the actual command files on disk', () => {
    const commandsDir = join(__dirname, '../../src/cli/commands');
    const files = readdirSync(commandsDir)
      .filter(f => f.endsWith('.ts'))
      .map(f => f.replace('.ts', ''))
      .sort();

    const registryNames = [...CLI_COMMAND_REGISTRY.map((c: CliCommandMeta) => c.cmd)].sort();
    expect(registryNames).toEqual(files);
  });

  it('contains exactly 30 commands', () => {
    expect(CLI_COMMAND_REGISTRY.length).toBe(30);
  });
});
