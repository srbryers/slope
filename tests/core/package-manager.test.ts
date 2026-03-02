import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPackageManager } from '../../src/core/analyzers/stack.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-pm-'));
}

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no lock file found', () => {
    expect(detectPackageManager(tmpDir)).toBeNull();
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects npm from package-lock.json', () => {
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');
    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  it('detects yarn from yarn.lock', () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('detects bun from bun.lockb', () => {
    writeFileSync(join(tmpDir, 'bun.lockb'), '');
    expect(detectPackageManager(tmpDir)).toBe('bun');
  });

  it('detects bun from bun.lock', () => {
    writeFileSync(join(tmpDir, 'bun.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('bun');
  });

  it('returns first match by priority (pnpm before npm)', () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });
});
