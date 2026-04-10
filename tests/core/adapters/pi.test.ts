import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiAdapter } from '../../../src/core/adapters/pi.js';
import type { GuardResult } from '../../../src/core/guard.js';

describe('PiAdapter', () => {
  let adapter: PiAdapter;

  beforeEach(() => {
    adapter = new PiAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('pi');
    expect(adapter.displayName).toBe('Pi');
  });

  describe('supportedEvents', () => {
    it('contains PreToolUse, PostToolUse, and Stop', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop']));
    });

    it('does not contain PreCompact', () => {
      expect(adapter.supportedEvents.has('PreCompact')).toBe(false);
    });
  });

  describe('supportsContextInjection', () => {
    it('is true', () => {
      expect(adapter.supportsContextInjection).toBe(true);
    });
  });

  describe('hooksConfigPath', () => {
    it('returns .pi/extensions/slope/index.ts path', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBe('/tmp/test/.pi/extensions/slope/index.ts');
    });
  });

  describe('detect', () => {
    it('returns true when .pi/ directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-pi-'));
      mkdirSync(join(tmpDir, '.pi'), { recursive: true });
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false when .pi/ does not exist', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-pi-'));
      expect(adapter.detect(tmpDir)).toBe(false);
    });
  });

  describe('formatPreToolOutput', () => {
    it('returns deny with blockReason', () => {
      const result: GuardResult = { blockReason: 'blocked' };
      const output = adapter.formatPreToolOutput(result) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toBe('blocked');
    });

    it('returns context as additionalContext', () => {
      const result: GuardResult = { context: 'warning text' };
      const output = adapter.formatPreToolOutput(result) as { hookSpecificOutput: { additionalContext?: string } };
      expect(output.hookSpecificOutput.additionalContext).toBe('warning text');
    });

    it('returns empty for no-op result', () => {
      const result: GuardResult = {};
      const output = adapter.formatPreToolOutput(result) as { hookSpecificOutput: Record<string, unknown> };
      expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
      expect(output.hookSpecificOutput.additionalContext).toBeUndefined();
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns block decision for blockReason', () => {
      const result: GuardResult = { blockReason: 'test block' };
      const output = adapter.formatPostToolOutput(result) as { decision?: string; reason?: string };
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('test block');
    });

    it('returns context as additionalContext', () => {
      const result: GuardResult = { context: 'info text' };
      const output = adapter.formatPostToolOutput(result) as { hookSpecificOutput?: { additionalContext?: string } };
      expect(output.hookSpecificOutput?.additionalContext).toBe('info text');
    });

    it('returns empty for no-op', () => {
      const result: GuardResult = {};
      expect(adapter.formatPostToolOutput(result)).toEqual({});
    });
  });

  describe('formatStopOutput', () => {
    it('returns block for blockReason', () => {
      const result: GuardResult = { blockReason: 'stop blocked' };
      const output = adapter.formatStopOutput(result) as { decision?: string; reason?: string };
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('stop blocked');
    });

    it('returns empty for no-op', () => {
      expect(adapter.formatStopOutput({})).toEqual({});
    });
  });

  describe('installGuards', () => {
    it('creates .pi/extensions/slope/ directory', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-pi-install-'));
      mkdirSync(join(tmpDir, '.pi'), { recursive: true });

      adapter.installGuards(tmpDir, []);

      expect(existsSync(join(tmpDir, '.pi', 'extensions', 'slope'))).toBe(true);
    });
  });
});
