import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatCliError, reportCliError } from '../../src/cli/error-reporter.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-error-reporter-'));
}

describe('formatCliError', () => {
  it('adds native SQLite recovery suggestions to top-level CLI errors', () => {
    const cwd = makeTmpDir();
    try {
      writeFileSync(join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ engines: { node: '>=22 <23' } }));

      const lines = formatCliError(
        new Error("Could not locate the bindings file. Tried: /tmp/better_sqlite3.node"),
        cwd,
      );

      expect(lines[0]).toContain('Could not locate the bindings file');
      expect(lines).toContain('Recovery:');
      expect(lines.join('\n')).toContain(`Active Node: ${process.version}`);
      expect(lines).toContain('  - Install this worktree\'s dependencies first: pnpm install.');
      expect(lines.join('\n')).toContain('package.json engines.node (>=22 <23)');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps non-native errors concise', () => {
    const cwd = makeTmpDir();
    try {
      mkdirSync(join(cwd, 'node_modules'), { recursive: true });
      const lines = formatCliError(new Error('ordinary failure'), cwd);

      expect(lines).toEqual(['Error: ordinary failure']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('prints formatted recovery guidance before exiting', () => {
    const cwd = makeTmpDir();
    const originalCwd = process.cwd();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    try {
      process.chdir(cwd);
      writeFileSync(join(cwd, 'package-lock.json'), '{}\n');

      expect(() => reportCliError(new Error('ERR_DLOPEN_FAILED: better_sqlite3.node'))).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const output = errorSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(output).toContain('Error: ERR_DLOPEN_FAILED');
      expect(output).toContain('Recovery:');
      expect(output).toContain(`Active Node: ${process.version}`);
      expect(output).toContain('npm ci');
    } finally {
      process.chdir(originalCwd);
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('routes common store-backed top-level CLI commands through the shared reporter', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    for (const command of ['briefingCommand', 'claimCommand', 'statusCommand', 'autoCardCommand', 'sessionCommand', 'agentCommand']) {
      expect(indexSource).toContain(`${command}(process.argv.slice(3)).catch(reportCliError);`);
    }
    expect(indexSource).not.toContain("console.error('Error:', err.message)");
  });
});
