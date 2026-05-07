import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');
const SLOPE_VERSION = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
).version as string;

describe('slope version (GH #300)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(
        `dist not built — run \`pnpm build\` before this test. Expected ${SLOPE_BIN}`,
      );
    }
  });

  it('reads version from installed slope package, not cwd', () => {
    // Set up a foreign cwd with a package.json claiming a different version
    const foreignDir = mkdtempSync(join(tmpdir(), 'slope-version-test-'));
    try {
      writeFileSync(
        join(foreignDir, 'package.json'),
        JSON.stringify({ name: 'foreign-project', version: '99.99.99' }),
      );

      const out = execSync(`node ${SLOPE_BIN} version`, {
        cwd: foreignDir,
        encoding: 'utf8',
      }).trim();

      expect(out).toBe(`@slope-dev/slope v${SLOPE_VERSION}`);
      expect(out).not.toContain('99.99.99');
      expect(out).not.toContain('vunknown');
    } finally {
      rmSync(foreignDir, { recursive: true, force: true });
    }
  });

  it('returns slope version even when cwd has no package.json', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'slope-version-empty-'));
    try {
      const out = execSync(`node ${SLOPE_BIN} version`, {
        cwd: emptyDir,
        encoding: 'utf8',
      }).trim();

      expect(out).toBe(`@slope-dev/slope v${SLOPE_VERSION}`);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
