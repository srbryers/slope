import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CursorAdapter } from '../../../src/core/adapters/cursor.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import { resolveToolMatcher } from '../../../src/core/harness.js';
import type { GuardResult } from '../../../src/core/guard.js';
import type { CursorHookOutput, CursorHooksConfig } from '../../../src/core/adapters/cursor.js';

describe('CursorAdapter', () => {
  let adapter: CursorAdapter;

  beforeEach(() => {
    adapter = new CursorAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('cursor');
    expect(adapter.displayName).toBe('Cursor');
  });

  describe('formatPreToolOutput', () => {
    it('returns allow for empty result', () => {
      const output = adapter.formatPreToolOutput({}) as CursorHookOutput;
      expect(output.decision).toBe('allow');
      expect(output.reason).toBeUndefined();
      expect(output.context).toBeUndefined();
    });

    it('returns allow with context', () => {
      const result: GuardResult = { context: 'Check the map first' };
      const output = adapter.formatPreToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('allow');
      expect(output.context).toBe('Check the map first');
    });

    it('returns block for deny decision', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Not allowed' };
      const output = adapter.formatPreToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Not allowed');
    });

    it('returns block for deny with context', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Blocked', context: 'Extra info' };
      const output = adapter.formatPreToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Blocked');
      expect(output.context).toBe('Extra info');
    });

    it('returns allow for allow decision', () => {
      const result: GuardResult = { decision: 'allow' };
      const output = adapter.formatPreToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('allow');
    });

    it('maps ask decision to allow (Cursor has no ask)', () => {
      const result: GuardResult = { decision: 'ask' };
      const output = adapter.formatPreToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('allow');
    });

    it('returns block when blockReason is set without decision', () => {
      const result: GuardResult = { blockReason: 'Something wrong' };
      const output = adapter.formatPreToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Something wrong');
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns allow for empty result', () => {
      const output = adapter.formatPostToolOutput({}) as CursorHookOutput;
      expect(output.decision).toBe('allow');
    });

    it('returns block with reason', () => {
      const result: GuardResult = { blockReason: 'Blocked!' };
      const output = adapter.formatPostToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Blocked!');
    });

    it('returns allow with context', () => {
      const result: GuardResult = { context: 'Consider committing' };
      const output = adapter.formatPostToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('allow');
      expect(output.context).toBe('Consider committing');
    });

    it('returns block with context when both present', () => {
      const result: GuardResult = { blockReason: 'Blocked', context: 'Extra' };
      const output = adapter.formatPostToolOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Blocked');
      expect(output.context).toBe('Extra');
    });
  });

  describe('formatStopOutput', () => {
    it('returns allow for empty result', () => {
      const output = adapter.formatStopOutput({}) as CursorHookOutput;
      expect(output.decision).toBe('allow');
    });

    it('returns block with reason', () => {
      const result: GuardResult = { blockReason: 'Uncommitted work' };
      const output = adapter.formatStopOutput(result) as CursorHookOutput;
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Uncommitted work');
    });
  });

  describe('generateHooksConfig', () => {
    it('generates hooks entries for all guards', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './slope-guard.sh') as CursorHooksConfig;
      expect(config.hooks).toBeDefined();
      expect(Array.isArray(config.hooks)).toBe(true);
      // Should have entries (some guards may be filtered if hookEvent not mapped)
      expect(config.hooks.length).toBeGreaterThan(0);
    });

    it('each entry has required fields', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './guard.sh') as CursorHooksConfig;
      for (const entry of config.hooks) {
        expect(entry.event).toBeDefined();
        expect(entry.command).toMatch(/^\.\/guard\.sh /);
        expect(entry.timeout).toBe(10000);
        expect(entry.description).toMatch(/^SLOPE: /);
      }
    });

    it('maps hook events to Cursor convention', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as CursorHooksConfig;
      const events = new Set(config.hooks.map(h => h.event));
      // Should use Cursor-style event names
      for (const event of events) {
        expect(['pre-tool-use', 'post-tool-use', 'on-stop']).toContain(event);
      }
    });

    it('excludes PreCompact guards (unsupported by Cursor)', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as CursorHooksConfig;
      const preCompactGuards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'PreCompact');
      if (preCompactGuards.length > 0) {
        for (const pg of preCompactGuards) {
          const found = config.hooks.some(h => h.command.endsWith(` ${pg.name}`));
          expect(found, `PreCompact guard '${pg.name}' should be excluded`).toBe(false);
        }
      }
    });

    it('resolves matcher from toolCategories using Cursor tool names', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as CursorHooksConfig;
      const explore = config.hooks.find(e => e.command.endsWith(' explore'));
      // explore guard targets read_file, search_files, search_content
      // In Cursor: read_file, list_directory, grep_search
      if (explore?.matcher) {
        const matcherSet = new Set(explore.matcher.split('|'));
        expect(matcherSet).toEqual(new Set(['read_file', 'list_directory', 'grep_search']));
      }
    });
  });

  describe('installGuards', () => {
    it('creates dispatcher and hooks.json', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cursor-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 3));

      const hooksDir = join(tmpDir, '.cursor', 'hooks');
      expect(existsSync(join(hooksDir, 'slope-guard.sh'))).toBe(true);
      expect(existsSync(join(tmpDir, '.cursor', 'hooks.json'))).toBe(true);

      // Verify hooks.json content
      const config: CursorHooksConfig = JSON.parse(
        readFileSync(join(tmpDir, '.cursor', 'hooks.json'), 'utf8'),
      );
      expect(config.hooks.length).toBe(GUARD_DEFINITIONS.slice(0, 3).filter(
        g => ['PreToolUse', 'PostToolUse', 'Stop'].includes(g.hookEvent),
      ).length);
    });

    it('does not overwrite existing dispatcher', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cursor-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 2));
      const firstContent = readFileSync(join(tmpDir, '.cursor', 'hooks', 'slope-guard.sh'), 'utf8');

      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 4));
      const secondContent = readFileSync(join(tmpDir, '.cursor', 'hooks', 'slope-guard.sh'), 'utf8');
      expect(secondContent).toBe(firstContent);
    });

    it('does not duplicate hooks entries on re-install', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cursor-'));
      const guards = GUARD_DEFINITIONS.slice(0, 3);
      adapter.installGuards(tmpDir, guards);
      const firstConfig: CursorHooksConfig = JSON.parse(
        readFileSync(join(tmpDir, '.cursor', 'hooks.json'), 'utf8'),
      );
      const firstCount = firstConfig.hooks.length;

      // Re-install same guards
      adapter.installGuards(tmpDir, guards);
      const secondConfig: CursorHooksConfig = JSON.parse(
        readFileSync(join(tmpDir, '.cursor', 'hooks.json'), 'utf8'),
      );
      expect(secondConfig.hooks.length).toBe(firstCount);
    });
  });

  describe('detect', () => {
    it('returns true when .cursor directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cursor-'));
      const cursorDir = join(tmpDir, '.cursor');
      mkdirSync(cursorDir);
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false for a directory without .cursor', () => {
      expect(adapter.detect('/tmp')).toBe(false);
    });
  });

  describe('toolNames', () => {
    it('maps all tool categories to Cursor-specific names', () => {
      expect(adapter.toolNames.read_file).toBe('read_file');
      expect(adapter.toolNames.write_file).toBe('file_edit|create_file');
      expect(adapter.toolNames.search_files).toBe('list_directory');
      expect(adapter.toolNames.search_content).toBe('grep_search');
      expect(adapter.toolNames.execute_command).toBe('run_terminal_command');
      expect(adapter.toolNames.create_subagent).toBe('create_subagent');
      expect(adapter.toolNames.exit_plan).toBe('exit_plan');
    });
  });

  describe('supportedEvents', () => {
    it('contains PreToolUse, PostToolUse, Stop but not PreCompact', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop']));
    });

    it('does not support PreCompact', () => {
      expect(adapter.supportedEvents.has('PreCompact')).toBe(false);
    });
  });

  describe('supportsContextInjection', () => {
    it('is true', () => {
      expect(adapter.supportsContextInjection).toBe(true);
    });
  });

  describe('hooksConfigPath', () => {
    it('returns .cursor/hooks.json', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBe('/tmp/test/.cursor/hooks.json');
    });
  });

  describe('toolCategories drift prevention', () => {
    it('resolveToolMatcher resolves Cursor tool names for all guards with toolCategories', () => {
      for (const g of GUARD_DEFINITIONS) {
        const resolved = resolveToolMatcher(adapter, g.toolCategories);
        if (g.toolCategories) {
          expect(resolved, `${g.name}: should resolve to non-empty string`).toBeTruthy();
          // Each resolved name should be a Cursor tool name
          for (const name of resolved!.split('|')) {
            const allCursorNames = Object.values(adapter.toolNames).flatMap(n => n.split('|'));
            expect(allCursorNames, `${g.name}: ${name} should be a valid Cursor tool`).toContain(name);
          }
        } else {
          expect(resolved, `${g.name}: no toolCategories should resolve to undefined`).toBeUndefined();
        }
      }
    });
  });
});
