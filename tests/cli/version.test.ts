import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { versionCommand } from '../../src/cli/commands/version.js';

let tmpDir: string;
let originalCwd: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-version-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Create a minimal package.json
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.5.0' }, null, 2));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('versionCommand', () => {
  it('shows current version with no subcommand', async () => {
    await versionCommand([]);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('v1.5.0');
  });

  it('shows current version with unknown subcommand', async () => {
    await versionCommand(['show']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('v1.5.0');
  });
});
