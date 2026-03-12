import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OB1Adapter } from '../../../src/core/adapters/ob1.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import { resolveToolMatcher } from '../../../src/core/harness.js';
import type { GuardResult } from '../../../src/core/guard.js';
import type { OB1HookOutput } from '../../../src/core/adapters/ob1.js';

describe('OB1Adapter', () => {
  let adapter: OB1Adapter;

  beforeEach(() => {
    adapter = new OB1Adapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('ob1');
    expect(adapter.displayName).toBe('OB1');
  });

  describe('supportedEvents', () => {
    it('contains PreToolUse, PostToolUse, and Stop', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop']));
    });

    it('does not contain PreCompact', () => {
      expect(adapter.supportedEvents.has('PreCompact')).toBe(false);
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
    it('returns null (OB1 uses directory-based discovery, not a config file)', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBeNull();
    });
  });

  describe('detect', () => {
    it('returns true when .ob1/hooks/ directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      mkdirSync(join(tmpDir, '.ob1', 'hooks'), { recursive: true });
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false when only .ob1/ exists (no hooks subdir)', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      mkdirSync(join(tmpDir, '.ob1'));
      expect(adapter.detect(tmpDir)).toBe(false);
    });

    it('returns false when neither .ob1/ nor .ob1/hooks/ exist', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      expect(adapter.detect(tmpDir)).toBe(false);
    });
  });

  describe('formatPreToolOutput', () => {
    it('returns empty object for empty result', () => {
      const output = adapter.formatPreToolOutput({}) as OB1HookOutput;
      expect(output.error).toBeUndefined();
      expect(output.output).toBeUndefined();
    });

    it('returns output for context-only result', () => {
      const result: GuardResult = { context: 'Check the map first' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBeUndefined();
      expect(output.output).toBe('Check the map first');
    });

    it('returns error for deny decision', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Not allowed' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBe('Not allowed');
      expect(output.output).toBeUndefined();
    });

    it('returns error with output for deny with context', () => {
      const result: GuardResult = { decision: 'deny', blockReason: 'Blocked', context: 'Extra info' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBe('Blocked');
      expect(output.output).toBe('Extra info');
    });

    it('returns empty object for allow decision', () => {
      const result: GuardResult = { decision: 'allow' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBeUndefined();
      expect(output.output).toBeUndefined();
    });

    it('maps ask decision to allow (OB1 has no ask)', () => {
      const result: GuardResult = { decision: 'ask' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBeUndefined();
    });

    it('returns error when blockReason is set without decision', () => {
      const result: GuardResult = { blockReason: 'Something wrong' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBe('Something wrong');
    });

    it('uses fallback error message when blockReason is missing but decision is deny', () => {
      const result: GuardResult = { decision: 'deny' };
      const output = adapter.formatPreToolOutput(result) as OB1HookOutput;
      expect(output.error).toBeTruthy();
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns empty object for empty result', () => {
      const output = adapter.formatPostToolOutput({}) as OB1HookOutput;
      expect(output.error).toBeUndefined();
      expect(output.output).toBeUndefined();
    });

    it('returns error with blockReason', () => {
      const result: GuardResult = { blockReason: 'Blocked!' };
      const output = adapter.formatPostToolOutput(result) as OB1HookOutput;
      expect(output.error).toBe('Blocked!');
      expect(output.output).toBeUndefined();
    });

    it('returns output for context-only result', () => {
      const result: GuardResult = { context: 'Consider committing' };
      const output = adapter.formatPostToolOutput(result) as OB1HookOutput;
      expect(output.error).toBeUndefined();
      expect(output.output).toBe('Consider committing');
    });

    it('returns error with output when both blockReason and context present', () => {
      const result: GuardResult = { blockReason: 'Blocked', context: 'Extra' };
      const output = adapter.formatPostToolOutput(result) as OB1HookOutput;
      expect(output.error).toBe('Blocked');
      expect(output.output).toBe('Extra');
    });
  });

  describe('formatStopOutput', () => {
    it('returns empty object for empty result', () => {
      const output = adapter.formatStopOutput({}) as OB1HookOutput;
      expect(output.error).toBeUndefined();
      expect(output.output).toBeUndefined();
    });

    it('returns error with blockReason', () => {
      const result: GuardResult = { blockReason: 'Uncommitted work' };
      const output = adapter.formatStopOutput(result) as OB1HookOutput;
      expect(output.error).toBe('Uncommitted work');
      expect(output.output).toBeUndefined();
    });
  });

  describe('generateHooksConfig', () => {
    it('generates per-event scripts for guards', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './slope-guard.sh') as Record<string, string>;
      expect(typeof scripts).toBe('object');
      // Should have at least pre_tool_slope.sh and post_tool_slope.sh
      expect(Object.keys(scripts).length).toBeGreaterThan(0);
    });

    it('each script is a valid shell script', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './guard.sh') as Record<string, string>;
      for (const [filename, content] of Object.entries(scripts)) {
        expect(content, `${filename} should start with shebang`).toMatch(/^#!\/usr\/bin\/env bash/);
        expect(content, `${filename} should contain SLOPE markers`).toContain('SLOPE MANAGED');
        expect(content, `${filename} should contain SLOPE END`).toContain('SLOPE END');
      }
    });

    it('maps hook events to OB1 snake_case convention with _slope.sh suffix', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Record<string, string>;
      const filenames = Object.keys(scripts);
      for (const filename of filenames) {
        expect(['pre_tool_slope.sh', 'post_tool_slope.sh', 'post_agent_slope.sh']).toContain(filename);
      }
    });

    it('maps Stop event to post_agent_slope.sh (OB1 post_agent hook)', () => {
      const stopGuards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'Stop');
      if (stopGuards.length > 0) {
        const scripts = adapter.generateHooksConfig(stopGuards, './g.sh') as Record<string, string>;
        expect(scripts['post_agent_slope.sh']).toBeDefined();
      }
    });

    it('excludes PreCompact guards (unsupported by OB1)', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Record<string, string>;
      const preCompactGuards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'PreCompact');
      if (preCompactGuards.length > 0) {
        // No script file should correspond to PreCompact
        // (OB1 has no pre_compact event)
        for (const filename of Object.keys(scripts)) {
          expect(filename).not.toMatch(/compact/);
        }
      }
    });

    it('resolves matcher from toolCategories using OB1 tool names', () => {
      const scripts = adapter.generateHooksConfig(GUARD_DEFINITIONS, './g.sh') as Record<string, string>;
      const preToolScript = scripts['pre_tool_slope.sh'];
      // explore guard targets read_file, search_files, search_content
      // In OB1: read_file, glob|list_directory, grep_search
      if (preToolScript) {
        expect(preToolScript).toContain('explore');
      }
    });
  });

  describe('installGuards', () => {
    it('creates dispatcher and per-event scripts', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 3));

      const hooksDir = join(tmpDir, '.ob1', 'hooks');
      expect(existsSync(join(hooksDir, 'slope-guard.sh'))).toBe(true);
      // Should have at least one event script
      const hasEventScript =
        existsSync(join(hooksDir, 'pre_tool_slope.sh')) ||
        existsSync(join(hooksDir, 'post_tool_slope.sh'));
      expect(hasEventScript).toBe(true);
    });

    it('creates guards-manifest.json', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 3));

      const manifestPath = join(tmpDir, '.ob1', 'hooks', 'guards-manifest.json');
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(Array.isArray(manifest)).toBe(true);
    });

    it('does not overwrite existing dispatcher', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 2));
      const firstContent = readFileSync(join(tmpDir, '.ob1', 'hooks', 'slope-guard.sh'), 'utf8');

      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 4));
      const secondContent = readFileSync(join(tmpDir, '.ob1', 'hooks', 'slope-guard.sh'), 'utf8');
      expect(secondContent).toBe(firstContent);
    });

    it('creates executable event scripts', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS);

      const hooksDir = join(tmpDir, '.ob1', 'hooks');
      // Check any event script that exists
      for (const scriptFile of ['pre_tool_slope.sh', 'post_tool_slope.sh', 'post_agent_slope.sh']) {
        const scriptPath = join(hooksDir, scriptFile);
        if (existsSync(scriptPath)) {
          const mode = statSync(scriptPath).mode;
          expect(mode & 0o111, `${scriptFile} should be executable`).toBeGreaterThan(0);
        }
      }
    });

    it('manifest includes ob1HookType field', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-ob1-'));
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS);

      const manifestPath = join(tmpDir, '.ob1', 'hooks', 'guards-manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      for (const entry of manifest) {
        expect(entry.ob1HookType).toBeDefined();
        expect(['pre_tool', 'post_tool', 'post_agent']).toContain(entry.ob1HookType);
      }
    });
  });

  describe('toolNames', () => {
    it('maps all tool categories to OB1-specific names', () => {
      expect(adapter.toolNames.read_file).toBe('read_file');
      expect(adapter.toolNames.write_file).toBe('replace|write_file|apply_patch');
      expect(adapter.toolNames.search_files).toBe('glob|list_directory');
      expect(adapter.toolNames.search_content).toBe('grep_search');
      expect(adapter.toolNames.execute_command).toBe('run_shell_command');
      expect(adapter.toolNames.create_subagent).toBe('worker|general|explore|plan|codebase_investigator|browser|vision-analyzer|handoff_to_agent|web');
      expect(adapter.toolNames.exit_plan).toBe('');
    });
  });

  describe('toolCategories drift prevention', () => {
    it('resolveToolMatcher resolves OB1 tool names for all guards with toolCategories', () => {
      for (const g of GUARD_DEFINITIONS) {
        const resolved = resolveToolMatcher(adapter, g.toolCategories);
        if (g.toolCategories) {
          // Some guards may have toolCategories that include exit_plan (which maps to empty string)
          // In that case, resolved may be empty after filtering
          const allOb1Names = Object.values(adapter.toolNames).flatMap(n => n.split('|')).filter(Boolean);
          if (resolved) {
            for (const name of resolved.split('|').filter(Boolean)) {
              expect(allOb1Names, `${g.name}: ${name} should be a valid OB1 tool`).toContain(name);
            }
          }
        } else {
          expect(resolved, `${g.name}: no toolCategories should resolve to undefined`).toBeUndefined();
        }
      }
    });
  });
});
