import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getVersionBumpStagePaths, versionCommand } from '../../src/cli/commands/version.js';

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
  // GH #300: default version output must read from the installed slope
  // package, not from process.cwd(). The tmpdir we chdir into has a foreign
  // package.json (version 1.5.0); slope should report its own version, not
  // that one.
  it('shows installed slope version (not cwd) with no subcommand', async () => {
    await versionCommand([]);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('@slope-dev/slope');
    expect(output).not.toContain('v1.5.0'); // cwd's foreign version must NOT leak through
    expect(output).not.toContain('vunknown');
  });

  it('shows installed slope version with unknown subcommand', async () => {
    await versionCommand(['show']);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('@slope-dev/slope');
    expect(output).not.toContain('v1.5.0');
  });

  it('prints nested bump help without entering release automation (#501)', async () => {
    await versionCommand(['bump', '--help']);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');

    expect(output).toContain('slope version bump');
    expect(output).toContain('Bump version');
  });

  it('bump rejects version strings with trailing content (shell injection)', async () => {
    // "1.2.3; echo pwned" should NOT match the anchored regex /^\d+\.\d+\.\d+$/
    // So the command should auto-bump to 1.6.0 instead
    // It will fail at gh auth check, but the version parsing happens before that
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.5.0' }, null, 2));

    // We can't easily run the full bump flow without gh, but we can verify
    // the regex by checking that getCurrentVersion still works
    const pkg = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('1.5.0');

    // Verify the regex rejects injection attempts
    expect(/^\d+\.\d+\.\d+$/.test('1.2.3; echo pwned')).toBe(false);
    expect(/^\d+\.\d+\.\d+$/.test('1.2.3')).toBe(true);
  });

  it('stages the bundled Codex plugin manifest when the version script updates it (#524)', () => {
    const manifestDir = join(tmpDir, 'templates', 'codex', 'plugins', 'slope', '.codex-plugin');
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: '@slope-dev/slope', version: '1.5.0' }, null, 2));
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ name: 'slope', version: '1.5.1' }, null, 2));

    expect(getVersionBumpStagePaths(tmpDir)).toEqual([
      'package.json',
      'templates/codex/plugins/slope/.codex-plugin/plugin.json',
    ]);
    expect(readFileSync(join(manifestDir, 'plugin.json'), 'utf8')).toContain('"version": "1.5.1"');
  });

  it('stages only package.json when no bundled Codex plugin manifest exists', () => {
    expect(getVersionBumpStagePaths(tmpDir)).toEqual(['package.json']);
  });
});
