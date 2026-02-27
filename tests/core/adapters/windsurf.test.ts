import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WindsurfAdapter } from '../../../src/core/adapters/windsurf.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import { resolveToolMatcher } from '../../../src/core/harness.js';
import type { GuardResult } from '../../../src/core/guard.js';
import type { WindsurfHookOutput, WindsurfHooksConfig } from '../../../src/core/adapters/windsurf.js';

describe('WindsurfAdapter', () => {
  let adapter: WindsurfAdapter;

  beforeEach(() => {
    adapter = new WindsurfAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('windsurf');
    expect(adapter.displayName).toBe('Windsurf');
  });

  describe('formatPreToolOutput', () => {
    it('returns allow for empty result', () => {
      const output = adapter.formatPreToolOutput({}) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
      expect(output.message).toBeUndefined();
    });

    it('returns deny for deny decision', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Not allowed' };
      const output = adapter.formatPreToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('deny');
      expect(output.message).toBe('Not allowed');
    });

    it('returns deny when blockReason set without decision', () => {
      const result: GuardResult = { blockReason: 'Something wrong' };
      const output = adapter.formatPreToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('deny');
      expect(output.message).toBe('Something wrong');
    });

    it('returns allow for allow decision', () => {
      const result: GuardResult = { decision: 'allow' };
      const output = adapter.formatPreToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
    });

    it('discards context (Windsurf cannot inject context)', () => {
      const result: GuardResult = { context: 'Check the map' };
      const output = adapter.formatPreToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
      // Context is not included — Windsurf doesn't support it
      expect(output.message).toBeUndefined();
    });

    it('maps ask decision to allow (Windsurf has no ask)', () => {
      const result: GuardResult = { decision: 'ask' };
      const output = adapter.formatPreToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns allow for empty result', () => {
      const output = adapter.formatPostToolOutput({}) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
    });

    it('returns deny with message', () => {
      const result: GuardResult = { blockReason: 'Blocked!' };
      const output = adapter.formatPostToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('deny');
      expect(output.message).toBe('Blocked!');
    });

    it('returns allow when only context present', () => {
      const result: GuardResult = { context: 'Consider committing' };
      const output = adapter.formatPostToolOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
    });
  });

  describe('formatStopOutput', () => {
    it('returns allow for empty result', () => {
      const output = adapter.formatStopOutput({}) as WindsurfHookOutput;
      expect(output.action).toBe('allow');
    });

    it('returns deny with message', () => {
      const result: GuardResult = { blockReason: 'Uncommitted work' };
      const output = adapter.formatStopOutput(result) as WindsurfHookOutput;
      expect(output.action).toBe('deny');
      expect(output.message).toBe('Uncommitted work');
    });
  });

  describe('generateHooksConfig', () => {
    it('generates hooks entries for supported events', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './slope-guard.sh') as WindsurfHooksConfig;
      expect(config.hooks).toBeDefined();
      expect(Array.isArray(config.hooks)).toBe(true);
      expect(config.hooks.length).toBeGreaterThan(0);
    });

    it('excludes Stop hook events (unsupported by Windsurf)', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as WindsurfHooksConfig;
      const events = config.hooks.map(h => h.event);
      expect(events).not.toContain('on-stop');
      // Only pre-tool-use and post-tool-use should be present
      for (const event of events) {
        expect(['pre-tool-use', 'post-tool-use']).toContain(event);
      }
    });

    it('each entry has required fields', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './guard.sh') as WindsurfHooksConfig;
      for (const entry of config.hooks) {
        expect(entry.event).toBeDefined();
        expect(entry.command).toMatch(/^\.\/guard\.sh /);
        expect(entry.timeout).toBe(10000);
        expect(entry.description).toMatch(/^SLOPE: /);
      }
    });

    it('resolves matcher from toolCategories using Windsurf tool names', () => {
      const config = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as WindsurfHooksConfig;
      const explore = config.hooks.find(e => e.command.endsWith(' explore'));
      // explore guard targets read_file, search_files, search_content
      // In Windsurf: read_file, find_files, search
      if (explore?.matcher) {
        const matcherSet = new Set(explore.matcher.split('|'));
        expect(matcherSet).toEqual(new Set(['read_file', 'find_files', 'search']));
      }
    });
  });

  describe('installGuards', () => {
    it('creates dispatcher, hooks.json, and manifest', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-windsurf-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 3));

      const hooksDir = join(tmpDir, '.windsurf', 'hooks');
      expect(existsSync(join(hooksDir, 'slope-guard.sh'))).toBe(true);
      expect(existsSync(join(tmpDir, '.windsurf', 'hooks.json'))).toBe(true);
      expect(existsSync(join(hooksDir, 'guards-manifest.json'))).toBe(true);
    });

    it('dispatcher script translates to exit codes', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-windsurf-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 1));

      const dispatcher = readFileSync(join(tmpDir, '.windsurf', 'hooks', 'slope-guard.sh'), 'utf8');
      // Should contain exit code translation logic
      expect(dispatcher).toContain('exit 2');
      expect(dispatcher).toContain('exit 0');
      expect(dispatcher).toContain('"deny"');
      // Should handle prettified JSON (spaces around colon)
      expect(dispatcher).toContain('[[:space:]]*:[[:space:]]*');
      // Should check slope guard exit code
      expect(dispatcher).toContain('if [ $? -ne 0 ]');
      // Should support SLOPE_GUARD_LOG for debugging
      expect(dispatcher).toContain('SLOPE_GUARD_LOG');
    });

    it('does not overwrite existing dispatcher', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-windsurf-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 2));
      const firstContent = readFileSync(join(tmpDir, '.windsurf', 'hooks', 'slope-guard.sh'), 'utf8');

      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 4));
      const secondContent = readFileSync(join(tmpDir, '.windsurf', 'hooks', 'slope-guard.sh'), 'utf8');
      expect(secondContent).toBe(firstContent);
    });

    it('does not duplicate hooks entries on re-install', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-windsurf-'));
      const guards = GUARD_DEFINITIONS.slice(0, 3);
      adapter.installGuards(tmpDir, guards);
      const firstConfig: WindsurfHooksConfig = JSON.parse(
        readFileSync(join(tmpDir, '.windsurf', 'hooks.json'), 'utf8'),
      );
      const firstCount = firstConfig.hooks.length;

      adapter.installGuards(tmpDir, guards);
      const secondConfig: WindsurfHooksConfig = JSON.parse(
        readFileSync(join(tmpDir, '.windsurf', 'hooks.json'), 'utf8'),
      );
      expect(secondConfig.hooks.length).toBe(firstCount);
    });
  });

  describe('detect', () => {
    it('returns true when .windsurf directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-windsurf-'));
      const wsDir = join(tmpDir, '.windsurf');
      require('node:fs').mkdirSync(wsDir);
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false for a directory without .windsurf', () => {
      expect(adapter.detect('/tmp')).toBe(false);
    });
  });

  describe('toolNames', () => {
    it('maps all tool categories to Windsurf-specific names', () => {
      expect(adapter.toolNames.read_file).toBe('read_file');
      expect(adapter.toolNames.write_file).toBe('create_file|edit_file');
      expect(adapter.toolNames.search_files).toBe('find_files');
      expect(adapter.toolNames.search_content).toBe('search');
      expect(adapter.toolNames.execute_command).toBe('run_command');
      expect(adapter.toolNames.create_subagent).toBe('create_subagent');
      expect(adapter.toolNames.exit_plan).toBe('exit_plan');
    });
  });

  describe('toolCategories drift prevention', () => {
    it('resolveToolMatcher resolves Windsurf tool names for all guards with toolCategories', () => {
      for (const g of GUARD_DEFINITIONS) {
        const resolved = resolveToolMatcher(adapter, g.toolCategories);
        if (g.toolCategories) {
          expect(resolved, `${g.name}: should resolve to non-empty string`).toBeTruthy();
          for (const name of resolved!.split('|')) {
            const allWindsurfNames = Object.values(adapter.toolNames).flatMap(n => n.split('|'));
            expect(allWindsurfNames, `${g.name}: ${name} should be a valid Windsurf tool`).toContain(name);
          }
        } else {
          expect(resolved, `${g.name}: no toolCategories should resolve to undefined`).toBeUndefined();
        }
      }
    });
  });
});
