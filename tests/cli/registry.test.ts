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

  it('every entry has non-empty cmd and desc', () => {
    for (const entry of CLI_COMMAND_REGISTRY) {
      expect(entry.cmd.length).toBeGreaterThan(0);
      expect(entry.desc.length).toBeGreaterThan(0);
    }
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
