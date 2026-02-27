import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearAdapters, registerAdapter } from '../../src/core/harness.js';
import { ClaudeCodeAdapter } from '../../src/core/adapters/claude-code.js';
import { CursorAdapter } from '../../src/core/adapters/cursor.js';
import { WindsurfAdapter } from '../../src/core/adapters/windsurf.js';
import { GenericAdapter } from '../../src/core/adapters/generic.js';
import { detectPlatforms, detectProvidersFromArgs } from '../../src/cli/commands/init.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-init-detect-'));
}

describe('detectPlatforms', () => {
  beforeEach(() => {
    clearAdapters();
    registerAdapter(new ClaudeCodeAdapter());
    registerAdapter(new CursorAdapter());
    registerAdapter(new WindsurfAdapter());
    registerAdapter(new GenericAdapter());
  });

  it('returns ["claude-code"] for dir with .claude/', () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, '.claude'));
    expect(detectPlatforms(dir)).toContain('claude-code');
  });

  it('returns ["cursor"] for dir with .cursor/', () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, '.cursor'));
    expect(detectPlatforms(dir)).toContain('cursor');
  });

  it('returns ["windsurf"] for dir with .windsurf/', () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, '.windsurf'));
    expect(detectPlatforms(dir)).toContain('windsurf');
  });

  it('returns ["opencode"] for dir with opencode.json', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'opencode.json'), '{}');
    expect(detectPlatforms(dir)).toContain('opencode');
  });

  it('returns multiple when multiple dirs exist', () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, '.claude'));
    mkdirSync(join(dir, '.cursor'));
    mkdirSync(join(dir, '.windsurf'));
    const result = detectPlatforms(dir);
    expect(result).toContain('claude-code');
    expect(result).toContain('cursor');
    expect(result).toContain('windsurf');
  });

  it('returns empty array for dir with no harness markers', () => {
    const dir = makeTmpDir();
    expect(detectPlatforms(dir)).toEqual([]);
  });
});

describe('detectProvidersFromArgs', () => {
  it('returns ["windsurf"] for --windsurf', () => {
    expect(detectProvidersFromArgs(['--windsurf'])).toEqual(['windsurf']);
  });

  it('returns ["cursor"] for --harness=cursor', () => {
    expect(detectProvidersFromArgs(['--harness=cursor'])).toEqual(['cursor']);
  });

  it('--all includes windsurf', () => {
    const result = detectProvidersFromArgs(['--all']);
    expect(result).toContain('windsurf');
    expect(result).toContain('claude-code');
    expect(result).toContain('cursor');
    expect(result).toContain('opencode');
  });

  it('returns multiple with combined flags', () => {
    const result = detectProvidersFromArgs(['--claude-code', '--windsurf']);
    expect(result).toEqual(['claude-code', 'windsurf']);
  });

  it('returns empty for no flags', () => {
    expect(detectProvidersFromArgs([])).toEqual([]);
  });
});

describe('detectProvidersFromArgs deduplication', () => {
  it('--harness=cursor does not duplicate with --cursor', () => {
    const result = detectProvidersFromArgs(['--cursor', '--harness=cursor']);
    const cursorCount = result.filter(p => p === 'cursor').length;
    expect(cursorCount).toBe(1);
  });

  it('--harness= with empty value is ignored', () => {
    const result = detectProvidersFromArgs(['--harness=']);
    expect(result).toEqual([]);
  });
});
