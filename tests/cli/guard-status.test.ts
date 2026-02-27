import { describe, it, expect } from 'vitest';
import { isEventSupported, getHooksConfigPath, HARNESS_EVENT_SUPPORT } from '../../src/cli/commands/guard.js';

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
