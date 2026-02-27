import { describe, it, expect } from 'vitest';
import { isEventSupported, getHooksConfigPath, HARNESS_EVENT_SUPPORT } from '../../src/cli/commands/guard.js';
import { ClaudeCodeAdapter } from '../../src/core/adapters/claude-code.js';
import { CursorAdapter } from '../../src/core/adapters/cursor.js';
import { WindsurfAdapter } from '../../src/core/adapters/windsurf.js';
import { GenericAdapter } from '../../src/core/adapters/generic.js';

describe('isEventSupported', () => {
  it('windsurf does not support Stop', () => {
    expect(isEventSupported('windsurf', 'Stop')).toBe(false);
  });

  it('windsurf does not support PreCompact', () => {
    expect(isEventSupported('windsurf', 'PreCompact')).toBe(false);
  });

  it('cursor does not support PreCompact', () => {
    expect(isEventSupported('cursor', 'PreCompact')).toBe(false);
  });

  it('cursor supports Stop', () => {
    expect(isEventSupported('cursor', 'Stop')).toBe(true);
  });

  it('claude-code supports Stop', () => {
    expect(isEventSupported('claude-code', 'Stop')).toBe(true);
  });

  it('claude-code supports PreToolUse', () => {
    expect(isEventSupported('claude-code', 'PreToolUse')).toBe(true);
  });

  it('claude-code supports PreCompact', () => {
    expect(isEventSupported('claude-code', 'PreCompact')).toBe(true);
  });

  it('unknown harness defaults to supported', () => {
    expect(isEventSupported('unknown-harness', 'PreToolUse')).toBe(true);
    expect(isEventSupported('unknown-harness', 'Stop')).toBe(true);
    expect(isEventSupported('unknown-harness', 'PreCompact')).toBe(true);
  });

  it('all harnesses support PreToolUse and PostToolUse', () => {
    for (const id of Object.keys(HARNESS_EVENT_SUPPORT)) {
      expect(isEventSupported(id, 'PreToolUse')).toBe(true);
      expect(isEventSupported(id, 'PostToolUse')).toBe(true);
    }
  });
});

describe('getHooksConfigPath', () => {
  it('returns .claude/settings.json for claude-code', () => {
    expect(getHooksConfigPath('/proj', 'claude-code')).toBe('/proj/.claude/settings.json');
  });

  it('returns .cursor/hooks.json for cursor', () => {
    expect(getHooksConfigPath('/proj', 'cursor')).toBe('/proj/.cursor/hooks.json');
  });

  it('returns .windsurf/hooks.json for windsurf', () => {
    expect(getHooksConfigPath('/proj', 'windsurf')).toBe('/proj/.windsurf/hooks.json');
  });

  it('returns null for unknown harness', () => {
    expect(getHooksConfigPath('/proj', 'unknown')).toBeNull();
  });

  it('returns null for generic harness', () => {
    expect(getHooksConfigPath('/proj', 'generic')).toBeNull();
  });
});

describe('adapter.supportedEvents (replaces isEventSupported)', () => {
  const cc = new ClaudeCodeAdapter();
  const cursor = new CursorAdapter();
  const windsurf = new WindsurfAdapter();
  const generic = new GenericAdapter();

  it('windsurf does not support Stop', () => {
    expect(windsurf.supportedEvents.has('Stop')).toBe(false);
  });

  it('windsurf does not support PreCompact', () => {
    expect(windsurf.supportedEvents.has('PreCompact')).toBe(false);
  });

  it('cursor does not support PreCompact', () => {
    expect(cursor.supportedEvents.has('PreCompact')).toBe(false);
  });

  it('cursor supports Stop', () => {
    expect(cursor.supportedEvents.has('Stop')).toBe(true);
  });

  it('claude-code supports all 4 events', () => {
    expect(cc.supportedEvents.has('PreToolUse')).toBe(true);
    expect(cc.supportedEvents.has('PostToolUse')).toBe(true);
    expect(cc.supportedEvents.has('Stop')).toBe(true);
    expect(cc.supportedEvents.has('PreCompact')).toBe(true);
  });

  it('all adapters support PreToolUse and PostToolUse', () => {
    for (const a of [cc, cursor, windsurf, generic]) {
      expect(a.supportedEvents.has('PreToolUse'), `${a.id} PreToolUse`).toBe(true);
      expect(a.supportedEvents.has('PostToolUse'), `${a.id} PostToolUse`).toBe(true);
    }
  });
});

describe('adapter.hooksConfigPath (replaces getHooksConfigPath)', () => {
  it('claude-code returns .claude/settings.json', () => {
    expect(new ClaudeCodeAdapter().hooksConfigPath('/proj')).toBe('/proj/.claude/settings.json');
  });

  it('cursor returns .cursor/hooks.json', () => {
    expect(new CursorAdapter().hooksConfigPath('/proj')).toBe('/proj/.cursor/hooks.json');
  });

  it('windsurf returns .windsurf/hooks.json', () => {
    expect(new WindsurfAdapter().hooksConfigPath('/proj')).toBe('/proj/.windsurf/hooks.json');
  });

  it('generic returns null', () => {
    expect(new GenericAdapter().hooksConfigPath('/proj')).toBeNull();
  });
});

describe('adapter.supportsContextInjection (replaces hardcoded check)', () => {
  it('claude-code supports context injection', () => {
    expect(new ClaudeCodeAdapter().supportsContextInjection).toBe(true);
  });

  it('cursor supports context injection', () => {
    expect(new CursorAdapter().supportsContextInjection).toBe(true);
  });

  it('windsurf does not support context injection', () => {
    expect(new WindsurfAdapter().supportsContextInjection).toBe(false);
  });

  it('generic does not support context injection', () => {
    expect(new GenericAdapter().supportsContextInjection).toBe(false);
  });
});
