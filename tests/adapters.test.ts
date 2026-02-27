import { describe, it, expect, beforeEach } from 'vitest';
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

  it('getAdapter("generic") returns GenericAdapter instance', () => {
    const adapter = getAdapter('generic');
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(GenericAdapter);
  });

  it('getAdapter("unknown-harness") returns undefined', () => {
    expect(getAdapter('unknown-harness')).toBeUndefined();
  });

  it('listAdapters() includes all 4 built-in adapters', () => {
    const ids = listAdapters();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('windsurf');
    expect(ids).toContain('generic');
    expect(ids.length).toBeGreaterThanOrEqual(4);
  });

  it('detectAdapter() works after barrel import (side-effect registration)', () => {
    // detectAdapter with no matching dirs should fall back to generic
    const adapter = detectAdapter('/tmp/nonexistent-dir-12345');
    expect(adapter?.id).toBe('generic');
  });

  it('exports framework constants', () => {
    expect(ADAPTER_PRIORITY).toContain('claude-code');
    expect(ADAPTER_PRIORITY).toContain('generic');
    expect(TOOL_CATEGORIES.length).toBe(7);
    expect(CLAUDE_CODE_TOOLS.read_file).toBe('Read');
  });

  it('exports singleton instances', () => {
    expect(claudeCodeAdapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(cursorAdapter).toBeInstanceOf(CursorAdapter);
    expect(windsurfAdapter).toBeInstanceOf(WindsurfAdapter);
    expect(genericAdapter).toBeInstanceOf(GenericAdapter);
  });

  it('exports resolveToolMatcher', () => {
    const adapter = getAdapter('claude-code')!;
    const result = resolveToolMatcher(adapter, ['read_file']);
    expect(result).toBe('Read');
  });
});
