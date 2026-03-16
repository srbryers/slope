import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  // Framework functions
  getAdapter,
  listAdapters,
  detectAdapter,
  clearAdapters,
  registerAdapter,
  resolveToolMatcher,
  ADAPTER_PRIORITY,
  TOOL_CATEGORIES,
  CLAUDE_CODE_TOOLS,
  // Adapter classes + singletons
  ClaudeCodeAdapter,
  claudeCodeAdapter,
  CursorAdapter,
  cursorAdapter,
  WindsurfAdapter,
  windsurfAdapter,
  ClineAdapter,
  clineAdapter,
  OB1Adapter,
  ob1Adapter,
  GenericAdapter,
  genericAdapter,
} from '../src/adapters.js';
import type { HarnessAdapter, HarnessId, ToolCategory, ToolNameMap, GuardManifestEntry } from '../src/adapters.js';

describe('adapters barrel export', () => {
  beforeEach(() => {
    clearAdapters();
    // Re-register all adapters (side-effect imports run once at module load,
    // but clearAdapters() removes them — re-register for each test)
    registerAdapter(new ClaudeCodeAdapter());
    registerAdapter(new CursorAdapter());
    registerAdapter(new WindsurfAdapter());
    registerAdapter(new ClineAdapter());
    registerAdapter(new OB1Adapter());
    registerAdapter(new GenericAdapter());
  });

  it('getAdapter("claude-code") returns ClaudeCodeAdapter instance', () => {
    const adapter = getAdapter('claude-code');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
  });

  it('getAdapter("cursor") returns CursorAdapter instance', () => {
    const adapter = getAdapter('cursor');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(CursorAdapter);
  });

  it('getAdapter("windsurf") returns WindsurfAdapter instance', () => {
    const adapter = getAdapter('windsurf');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(WindsurfAdapter);
  });

  it('getAdapter("cline") returns ClineAdapter instance', () => {
    const adapter = getAdapter('cline');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(ClineAdapter);
  });

  it('getAdapter("generic") returns GenericAdapter instance', () => {
    const adapter = getAdapter('generic');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(GenericAdapter);
  });

  it('getAdapter("unknown-harness") returns undefined', () => {
    expect(getAdapter('unknown-harness')).toBeUndefined();
  });

  it('listAdapters() includes all 6 built-in adapters', () => {
    const ids = listAdapters();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('windsurf');
    expect(ids).toContain('cline');
    expect(ids).toContain('ob1');
    expect(ids).toContain('generic');
    expect(ids.length).toBeGreaterThanOrEqual(6);
  });

  it('detectAdapter() works after barrel import (side-effect registration)', () => {
    // detectAdapter with no matching dirs should fall back to generic
    const adapter = detectAdapter('/tmp/nonexistent-dir-12345');
    expect(adapter?.id).toBe('generic');
  });

  it('exports framework constants', () => {
    expect(ADAPTER_PRIORITY).toContain('claude-code');
    expect(ADAPTER_PRIORITY).toContain('cline');
    expect(ADAPTER_PRIORITY).toContain('generic');
    expect(TOOL_CATEGORIES.length).toBe(8);
    expect(CLAUDE_CODE_TOOLS.read_file).toBe('Read');
  });

  it('ADAPTER_PRIORITY has cline before generic', () => {
    const clineIdx = ADAPTER_PRIORITY.indexOf('cline');
    const genericIdx = ADAPTER_PRIORITY.indexOf('generic');
    expect(clineIdx).toBeGreaterThan(-1);
    expect(clineIdx).toBeLessThan(genericIdx);
  });

  it('exports singleton instances', () => {
    expect(claudeCodeAdapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(cursorAdapter).toBeInstanceOf(CursorAdapter);
    expect(windsurfAdapter).toBeInstanceOf(WindsurfAdapter);
    expect(clineAdapter).toBeInstanceOf(ClineAdapter);
    expect(ob1Adapter).toBeInstanceOf(OB1Adapter);
    expect(genericAdapter).toBeInstanceOf(GenericAdapter);
  });

  it('exports resolveToolMatcher', () => {
    const adapter = getAdapter('claude-code')!;
    const result = resolveToolMatcher(adapter, ['read_file']);
    expect(result).toBe('Read');
  });

  it('detection conflict: .cursor/ + .clinerules/hooks/ → CursorAdapter wins (higher priority)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-conflict-'));
    mkdirSync(join(tmpDir, '.cursor'));
    mkdirSync(join(tmpDir, '.clinerules', 'hooks'), { recursive: true });
    const detected = detectAdapter(tmpDir);
    expect(detected).toBeDefined();
    expect(detected!.id).toBe('cursor');
  });

  it('detection: .clinerules/hooks/ only → ClineAdapter', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-only-'));
    mkdirSync(join(tmpDir, '.clinerules', 'hooks'), { recursive: true });
    const detected = detectAdapter(tmpDir);
    expect(detected).toBeDefined();
    expect(detected!.id).toBe('cline');
  });

  it('getAdapter("ob1") returns OB1Adapter instance', () => {
    const adapter = getAdapter('ob1');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(OB1Adapter);
  });

  it('detection: .ob1/hooks/ only → OB1Adapter', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-only-'));
    mkdirSync(join(tmpDir, '.ob1', 'hooks'), { recursive: true });
    const detected = detectAdapter(tmpDir);
    expect(detected).toBeDefined();
    expect(detected!.id).toBe('ob1');
  });

  it('ADAPTER_PRIORITY has ob1 before generic', () => {
    const ob1Idx = ADAPTER_PRIORITY.indexOf('ob1');
    const genericIdx = ADAPTER_PRIORITY.indexOf('generic');
    expect(ob1Idx).toBeGreaterThan(-1);
    expect(ob1Idx).toBeLessThan(genericIdx);
  });
});
