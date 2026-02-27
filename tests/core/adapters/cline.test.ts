import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClineAdapter } from '../../../src/core/adapters/cline.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import { resolveToolMatcher } from '../../../src/core/harness.js';
import type { GuardResult } from '../../../src/core/guard.js';
import type { ClineHookOutput } from '../../../src/core/adapters/cline.js';

describe('ClineAdapter', () => {
  let adapter: ClineAdapter;

  beforeEach(() => {
    adapter = new ClineAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('cline');
    expect(adapter.displayName).toBe('Cline');
  });

  describe('supportedEvents', () => {
    it('contains PreToolUse, PostToolUse, Stop, and PreCompact', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']));
    });

    it('does not contain unsupported events', () => {
      expect(adapter.supportedEvents.has('Notification')).toBe(false);
      expect(adapter.supportedEvents.has('SubagentStop')).toBe(false);
    });
  });

  describe('supportsContextInjection', () => {
    it('is true', () => {
      expect(adapter.supportsContextInjection).toBe(true);
    });
  });

  describe('hooksConfigPath', () => {
    it('returns null (Cline uses directory-based discovery, not a config file)', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBeNull();
    });
  });

  describe('detect', () => {
    it('returns true when .clinerules/hooks/ directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-'));
      mkdirSync(join(tmpDir, '.clinerules', 'hooks'), { recursive: true });
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false when only .clinerules/ exists (no hooks)', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-'));
      mkdirSync(join(tmpDir, '.clinerules'));
      expect(adapter.detect(tmpDir)).toBe(false);
    });

    it('returns false when neither .clinerules/ nor .clinerules/hooks/ exist', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-'));
      expect(adapter.detect(tmpDir)).toBe(false);
    });
  });

  describe('formatPreToolOutput', () => {
    it('returns cancel: false for empty result', () => {
      const output = adapter.formatPreToolOutput({}) as ClineHookOutput;
      expect(output.cancel).toBe(false);
      expect(output.errorMessage).toBeUndefined();
      expect(output.contextModification).toBeUndefined();
    });

    it('returns cancel: false with contextModification', () => {
      const result: GuardResult = { context: 'Check the map first' };
      const output = adapter.formatPreToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(false);
      expect(output.contextModification).toBe('Check the map first');
    });

    it('returns cancel: true for deny decision', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Not allowed' };
      const output = adapter.formatPreToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(true);
      expect(output.errorMessage).toBe('Not allowed');
    });

    it('returns cancel: true for deny with context', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Blocked', context: 'Extra info' };
      const output = adapter.formatPreToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(true);
      expect(output.errorMessage).toBe('Blocked');
      expect(output.contextModification).toBe('Extra info');
    });

    it('returns cancel: false for allow decision', () => {
      const result: GuardResult = { decision: 'allow' };
      const output = adapter.formatPreToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(false);
    });

    it('maps ask decision to cancel: false (Cline has no ask)', () => {
      const result: GuardResult = { decision: 'ask' };
      const output = adapter.formatPreToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(false);
    });

    it('returns cancel: true when blockReason is set without decision', () => {
      const result: GuardResult = { blockReason: 'Something wrong' };
      const output = adapter.formatPreToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(true);
      expect(output.errorMessage).toBe('Something wrong');
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns cancel: false for empty result', () => {
      const output = adapter.formatPostToolOutput({}) as ClineHookOutput;
      expect(output.cancel).toBe(false);
    });

    it('returns cancel: true with errorMessage', () => {
      const result: GuardResult = { blockReason: 'Blocked!' };
      const output = adapter.formatPostToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(true);
      expect(output.errorMessage).toBe('Blocked!');
    });

    it('returns cancel: false with contextModification', () => {
      const result: GuardResult = { context: 'Consider committing' };
      const output = adapter.formatPostToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(false);
      expect(output.contextModification).toBe('Consider committing');
    });

    it('returns cancel: true with context when both present', () => {
      const result: GuardResult = { blockReason: 'Blocked', context: 'Extra' };
      const output = adapter.formatPostToolOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(true);
      expect(output.errorMessage).toBe('Blocked');
      expect(output.contextModification).toBe('Extra');
    });
  });

  describe('formatStopOutput', () => {
    it('returns cancel: false for empty result', () => {
      const output = adapter.formatStopOutput({}) as ClineHookOutput;
      expect(output.cancel).toBe(false);
    });

    it('returns cancel: true with errorMessage', () => {
      const result: GuardResult = { blockReason: 'Uncommitted work' };
      const output = adapter.formatStopOutput(result) as ClineHookOutput;
      expect(output.cancel).toBe(true);
      expect(output.errorMessage).toBe('Uncommitted work');
    });
  });

  describe('generateHooksConfig', () => {
    it('generates per-event scripts for guards', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './slope-guard.sh') as Record<string, string>;
      expect(typeof scripts).toBe('object');
      // Should have at least PreToolUse and PostToolUse events
      expect(Object.keys(scripts).length).toBeGreaterThan(0);
    });

    it('each script is a valid shell script', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './guard.sh') as Record<string, string>;
      for (const [event, content] of Object.entries(scripts)) {
        expect(content, `${event} script should start with shebang`).toMatch(/^#!\/usr\/bin\/env bash/);
        expect(content, `${event} script should contain SLOPE markers`).toContain('SLOPE MANAGED');
        expect(content, `${event} script should contain SLOPE END`).toContain('SLOPE END');
      }
    });

    it('maps hook events to Cline PascalCase convention', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Record<string, string>;
      const events = Object.keys(scripts);
      for (const event of events) {
        expect(['PreToolUse', 'PostToolUse', 'TaskCancel', 'PreCompact']).toContain(event);
      }
    });

    it('includes PreCompact guards (supported by Cline)', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Record<string, string>;
      const preCompactGuards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'PreCompact');
      if (preCompactGuards.length > 0) {
        expect(scripts['PreCompact']).toBeDefined();
      }
    });

    it('resolves matcher from toolCategories using Cline tool names', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Record<string, string>;
      const preToolUse = scripts['PreToolUse'];
      // explore guard targets read_file, search_files, search_content
      // In Cline: read_file, list_files, search_files
      if (preToolUse) {
        expect(preToolUse).toContain('explore');
      }
    });
  });

  describe('installGuards', () => {
    it('creates dispatcher and per-event scripts', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 3));

      const hooksDir = join(tmpDir, '.clinerules', 'hooks');
      expect(existsSync(join(hooksDir, 'slope-guard.sh'))).toBe(true);
      // Should have at least one event script
      const hasEventScript = existsSync(join(hooksDir, 'PreToolUse')) || existsSync(join(hooksDir, 'PostToolUse'));
      expect(hasEventScript).toBe(true);
    });

    it('does not overwrite existing dispatcher', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 2));
      const firstContent = readFileSync(join(tmpDir, '.clinerules', 'hooks', 'slope-guard.sh'), 'utf8');

      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 4));
      const secondContent = readFileSync(join(tmpDir, '.clinerules', 'hooks', 'slope-guard.sh'), 'utf8');
      expect(secondContent).toBe(firstContent);
    });

    it('creates executable event scripts', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cline-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS);

      const hooksDir = join(tmpDir, '.clinerules', 'hooks');
      // Check any event script that exists
      for (const event of ['PreToolUse', 'PostToolUse', 'TaskCancel', 'PreCompact']) {
        const scriptPath = join(hooksDir, event);
        if (existsSync(scriptPath)) {
          const mode = statSync(scriptPath).mode;
          expect(mode & 0o111, `${event} should be executable`).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('toolNames', () => {
    it('maps all tool categories to Cline-specific names', () => {
      expect(adapter.toolNames.read_file).toBe('read_file');
      expect(adapter.toolNames.write_file).toBe('write_to_file|replace_in_file');
      expect(adapter.toolNames.search_files).toBe('list_files');
      expect(adapter.toolNames.search_content).toBe('search_files');
      expect(adapter.toolNames.execute_command).toBe('execute_command');
      expect(adapter.toolNames.create_subagent).toBe('use_mcp_tool');
      expect(adapter.toolNames.exit_plan).toBe('plan_mode_response');
    });
  });

  describe('toolCategories drift prevention', () => {
    it('resolveToolMatcher resolves Cline tool names for all guards with toolCategories', () => {
      for (const g of GUARD_DEFINITIONS) {
        const resolved = resolveToolMatcher(adapter, g.toolCategories);
        if (g.toolCategories) {
          expect(resolved, `${g.name}: should resolve to non-empty string`).toBeTruthy();
          // Each resolved name should be a Cline tool name
          for (const name of resolved!.split('|')) {
            const allClineNames = Object.values(adapter.toolNames).flatMap(n => n.split('|'));
            expect(allClineNames, `${g.name}: ${name} should be a valid Cline tool`).toContain(name);
          }
        } else {
          expect(resolved, `${g.name}: no toolCategories should resolve to undefined`).toBeUndefined();
        }
      }
    });
  });
});
