import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatCliError } from '../../src/cli/error-reporter.js';

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
});
