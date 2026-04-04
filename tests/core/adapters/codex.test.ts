import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAdapter } from '../../../src/core/adapters/codex.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import type { GuardResult } from '../../../src/core/guard.js';

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('codex');
    expect(adapter.displayName).toBe('Codex CLI');
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
    it('returns .codex/hooks.json path', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBe('/tmp/test/.codex/hooks.json');
    });
  });

  describe('detect', () => {
    it('returns true when .codex/ directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-'));
      mkdirSync(join(tmpDir, '.codex'), { recursive: true });
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false when .codex/ does not exist', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-'));
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
      const output = adapter.formatPostToolOutput(result);
      expect(output).toEqual({});
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
      const result: GuardResult = {};
      const output = adapter.formatStopOutput(result);
      expect(output).toEqual({});
    });
  });

  describe('generateHooksConfig', () => {
    it('generates config with guard entries', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard' || g.name === 'stop-check');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');
      expect(config).toBeDefined();
      // hazard is PreToolUse, stop-check is Stop
      expect(config.PreToolUse).toBeDefined();
      expect(config.Stop).toBeDefined();
    });

    it('skips PreCompact guards (unsupported)', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'PreCompact');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');
      expect(config.PreCompact).toBeUndefined();
    });
  });

  describe('installGuards', () => {
    it('creates .codex/hooks directory and hooks.json', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-install-'));
      mkdirSync(join(tmpDir, '.codex'), { recursive: true });

      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard');
      adapter.installGuards(tmpDir, guards);

      expect(existsSync(join(tmpDir, '.codex', 'hooks', 'slope-guard.sh'))).toBe(true);
      expect(existsSync(join(tmpDir, '.codex', 'hooks.json'))).toBe(true);

      const config = JSON.parse(readFileSync(join(tmpDir, '.codex', 'hooks.json'), 'utf8'));
      expect(config.PreToolUse).toBeDefined();
    });
  });
});
