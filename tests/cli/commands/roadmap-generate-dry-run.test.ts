import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

function setupRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-generate-test-'));
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
  // Minimal config
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({
    roadmapPath: 'docs/backlog/roadmap.json',
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
  }));
  // Minimal vision so generate has something to work with
  writeFileSync(join(cwd, '.slope', 'vision.json'), JSON.stringify({
    purpose: 'Test',
    priorities: ['a', 'b', 'c'],
    horizon: '6 months',
  }));
  return cwd;
}

describe('slope roadmap generate --dry-run (GH #304)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('does not write roadmap.json when --dry-run is passed', () => {
    const cwd = setupRepo();
    const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
    try {
      const out = execSync(`node ${SLOPE_BIN} roadmap generate --dry-run`, {
        cwd,
        encoding: 'utf8',
        // Generate may fail without a richer setup; we just care about the file
        // not being written. Capture both streams to stop noise on stdout.
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // If generate succeeded, it should have printed "[dry-run]" prefix
      // If it failed (e.g. missing vision pieces), the file must still not exist
      if (out.includes('[dry-run]')) {
        expect(out).toContain('Would write to');
        expect(out).toContain('Re-run without --dry-run');
      }
      expect(existsSync(roadmapPath)).toBe(false);
    } catch (err) {
      // If the command exited non-zero (e.g. vision parse failed), file should still not exist
      expect(existsSync(roadmapPath)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('mentions --dry-run for generate in the help text', () => {
    const out = execSync(`node ${SLOPE_BIN} roadmap`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(out).toMatch(/generate\s+\[--path=<file>\]\s+\[--dry-run\]/);
    expect(out).toContain('sync and generate');
  });
});
