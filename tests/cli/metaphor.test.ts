import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-metaphor-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CLI metaphor resolution', () => {
  it('resolveMetaphor returns golf by default', async () => {
    const { resolveMetaphor } = await import('../../src/cli/metaphor.js');
    const m = resolveMetaphor([], undefined);
    expect(m.id).toBe('golf');
  });

  it('resolveMetaphor uses config metaphor', async () => {
    const { resolveMetaphor } = await import('../../src/cli/metaphor.js');
    const m = resolveMetaphor([], 'gaming');
    expect(m.id).toBe('gaming');
  });

  it('resolveMetaphor CLI flag overrides config', async () => {
    const { resolveMetaphor } = await import('../../src/cli/metaphor.js');
    const m = resolveMetaphor(['--metaphor=tennis'], 'gaming');
    expect(m.id).toBe('tennis');
  });

  it('resolveMetaphor exits on unknown metaphor', async () => {
    const { resolveMetaphor } = await import('../../src/cli/metaphor.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
      throw new Error(`process.exit(${code})`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => resolveMetaphor([], 'nonexistent')).toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown metaphor'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('golf'));
  });
});

describe('slope init --metaphor', () => {
  it('writes metaphor to config when --metaphor flag is used', async () => {
    const { initCommand } = await import('../../src/cli/commands/init.js');
    await initCommand(['--metaphor=gaming']);

    const configPath = join(tmpDir, '.slope', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.metaphor).toBe('gaming');
  });

  it('config has golf as default metaphor without flag', async () => {
    const { initCommand } = await import('../../src/cli/commands/init.js');
    await initCommand([]);

    const configPath = join(tmpDir, '.slope', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.metaphor).toBe('golf');
  });
});
