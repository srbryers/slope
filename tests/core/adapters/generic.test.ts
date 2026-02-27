import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GenericAdapter } from '../../../src/core/adapters/generic.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import type { GuardResult } from '../../../src/core/guard.js';

describe('GenericAdapter', () => {
  let adapter: GenericAdapter;

  beforeEach(() => {
    adapter = new GenericAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('generic');
    expect(adapter.displayName).toBe('Generic (Shell)');
  });

  describe('formatPreToolOutput', () => {
    it('returns allow for empty result', () => {
      expect(adapter.formatPreToolOutput({})).toEqual({ action: 'allow' });
    });

    it('returns context with message', () => {
      const result: GuardResult = { context: 'Check the map first' };
      expect(adapter.formatPreToolOutput(result)).toEqual({
        action: 'context',
        message: 'Check the map first',
      });
    });

    it('returns deny with reason', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Not allowed' };
      expect(adapter.formatPreToolOutput(result)).toEqual({
        action: 'deny',
        reason: 'Not allowed',
      });
    });

    it('returns ask for ask decision', () => {
      const result: GuardResult = { decision: 'ask' };
      expect(adapter.formatPreToolOutput(result)).toEqual({
        action: 'ask',
      });
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns allow for empty result', () => {
      expect(adapter.formatPostToolOutput({})).toEqual({ action: 'allow' });
    });

    it('returns deny with block reason', () => {
      const result: GuardResult = { blockReason: 'Blocked!' };
      expect(adapter.formatPostToolOutput(result)).toEqual({
        action: 'deny',
        reason: 'Blocked!',
      });
    });

    it('returns context with message', () => {
      const result: GuardResult = { context: 'Consider committing' };
      expect(adapter.formatPostToolOutput(result)).toEqual({
        action: 'context',
        message: 'Consider committing',
      });
    });
  });

  describe('formatStopOutput', () => {
    it('returns allow for empty result', () => {
      expect(adapter.formatStopOutput({})).toEqual({ action: 'allow' });
    });

    it('returns deny with reason', () => {
      const result: GuardResult = { blockReason: 'Uncommitted work' };
      expect(adapter.formatStopOutput(result)).toEqual({
        action: 'deny',
        reason: 'Uncommitted work',
      });
    });
  });

  describe('generateHooksConfig', () => {
    it('generates manifest entries for all guards', () => {
      const manifest = adapter.generateHooksConfig(GUARD_DEFINITIONS, './slope-guard.sh');
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest).toHaveLength(GUARD_DEFINITIONS.length);
    });

    it('each entry has required fields', () => {
      const manifest = adapter.generateHooksConfig(GUARD_DEFINITIONS, './guard.sh');
      for (const entry of manifest as Array<Record<string, unknown>>) {
        expect(entry.name).toBeDefined();
        expect(entry.description).toBeDefined();
        expect(entry.hookEvent).toBeDefined();
        expect(entry.level).toBeDefined();
        expect(entry.command).toMatch(/^\.\/guard\.sh /);
      }
    });

    it('resolves matcher from toolCategories using generic tool names', () => {
      const manifest = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Array<Record<string, unknown>>;
      const explore = manifest.find(e => e.name === 'explore');
      const transcript = manifest.find(e => e.name === 'transcript');
      // Generic adapter should resolve to generic tool names, not Claude Code names
      const exploreMatcher = new Set((explore?.matcher as string)?.split('|'));
      expect(exploreMatcher).toEqual(new Set(['read_file', 'search_files', 'search_content']));
      expect(transcript?.matcher).toBeUndefined();
    });
  });

  describe('installGuards', () => {
    it('creates dispatcher, manifest, and README', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-generic-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 3));

      const hooksDir = join(tmpDir, '.slope', 'hooks');
      expect(existsSync(join(hooksDir, 'slope-guard.sh'))).toBe(true);
      expect(existsSync(join(hooksDir, 'guards-manifest.json'))).toBe(true);
      expect(existsSync(join(hooksDir, 'README.md'))).toBe(true);

      // Verify manifest content
      const manifest = JSON.parse(readFileSync(join(hooksDir, 'guards-manifest.json'), 'utf8'));
      expect(manifest).toHaveLength(3);
      expect(manifest[0].name).toBe(GUARD_DEFINITIONS[0].name);

      // Verify README mentions integration instructions
      const readme = readFileSync(join(hooksDir, 'README.md'), 'utf8');
      expect(readme).toContain('slope-guard.sh');
      expect(readme).toContain('PreToolUse');
    });

    it('does not overwrite existing dispatcher', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-generic-'));
      // First install
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 2));
      const firstContent = readFileSync(join(tmpDir, '.slope', 'hooks', 'slope-guard.sh'), 'utf8');

      // Second install — dispatcher preserved, manifest updated
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 4));
      const secondContent = readFileSync(join(tmpDir, '.slope', 'hooks', 'slope-guard.sh'), 'utf8');
      expect(secondContent).toBe(firstContent);

      // Manifest should reflect the latest guards
      const manifest = JSON.parse(readFileSync(join(tmpDir, '.slope', 'hooks', 'guards-manifest.json'), 'utf8'));
      expect(manifest).toHaveLength(4);
    });
  });

  describe('detect', () => {
    it('always returns true (fallback adapter)', () => {
      expect(adapter.detect('/tmp')).toBe(true);
      expect(adapter.detect('/nonexistent')).toBe(true);
    });
  });

  describe('supportedEvents', () => {
    it('contains PreToolUse, PostToolUse, Stop', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop']));
    });

    it('does not support PreCompact', () => {
      expect(adapter.supportedEvents.has('PreCompact')).toBe(false);
    });
  });

  describe('supportsContextInjection', () => {
    it('is false', () => {
      expect(adapter.supportsContextInjection).toBe(false);
    });
  });

  describe('hooksConfigPath', () => {
    it('returns null', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBeNull();
    });
  });

  describe('toolNames', () => {
    it('uses generic operation names', () => {
      expect(adapter.toolNames.read_file).toBe('read_file');
      expect(adapter.toolNames.write_file).toBe('write_file');
      expect(adapter.toolNames.execute_command).toBe('execute_command');
    });
  });
});
