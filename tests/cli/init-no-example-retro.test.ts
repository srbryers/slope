import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

describe('slope init example scorecard (GH #306)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('does not create docs/retros/sprint-1.json by default', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-default-'));
    try {
      execSync(`node ${SLOPE_BIN} init`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(existsSync(join(cwd, 'docs', 'retros', 'sprint-1.json'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates docs/retros/sprint-1.json when --with-example is passed', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-with-example-'));
    try {
      execSync(`node ${SLOPE_BIN} init --with-example`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(existsSync(join(cwd, 'docs', 'retros', 'sprint-1.json'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('still creates docs/retros/ directory itself', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-retros-dir-'));
    try {
      execSync(`node ${SLOPE_BIN} init`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(existsSync(join(cwd, 'docs', 'retros'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
