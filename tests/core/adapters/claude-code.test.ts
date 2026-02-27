import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCodeAdapter } from '../../../src/core/adapters/claude-code.js';
import { formatPreToolUseOutput, formatPostToolUseOutput, formatStopOutput, generateClaudeCodeHooksConfig, GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import { resolveToolMatcher } from '../../../src/core/harness.js';
import type { GuardResult } from '../../../src/core/guard.js';

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('claude-code');
    expect(adapter.displayName).toBe('Claude Code');
  });

  describe('formatPreToolOutput matches formatPreToolUseOutput', () => {
    const cases: Array<{ name: string; result: GuardResult }> = [
      { name: 'context only', result: { context: 'Check the map' } },
      { name: 'deny decision', result: { decision: 'deny', blockReason: 'Not allowed' } },
      { name: 'allow decision', result: { decision: 'allow' } },
      { name: 'context + decision', result: { context: 'Hint text', decision: 'ask' } },
      { name: 'empty result', result: {} },
    ];

    for (const { name, result } of cases) {
      it(name, () => {
        expect(adapter.formatPreToolOutput(result)).toEqual(formatPreToolUseOutput(result));
      });
    }
  });

  describe('formatPostToolOutput matches formatPostToolUseOutput', () => {
    const cases: Array<{ name: string; result: GuardResult }> = [
      { name: 'block reason', result: { blockReason: 'Blocked!' } },
      { name: 'block + context', result: { blockReason: 'Blocked!', context: 'Extra info' } },
      { name: 'context only', result: { context: 'Some guidance' } },
      { name: 'empty result', result: {} },
    ];

    for (const { name, result } of cases) {
      it(name, () => {
        expect(adapter.formatPostToolOutput(result)).toEqual(formatPostToolUseOutput(result));
      });
    }
  });

  describe('formatStopOutput matches formatStopOutput', () => {
    const cases: Array<{ name: string; result: GuardResult }> = [
      { name: 'block reason', result: { blockReason: 'Cannot stop yet' } },
      { name: 'empty result', result: {} },
    ];

    for (const { name, result } of cases) {
      it(name, () => {
        expect(adapter.formatStopOutput(result)).toEqual(formatStopOutput(result));
      });
    }
  });

  describe('generateHooksConfig matches generateClaudeCodeHooksConfig', () => {
    it('produces identical output for built-in guards', () => {
      const scriptPath = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/slope-guard.sh';
      const adapterConfig = adapter.generateHooksConfig(GUARD_DEFINITIONS, scriptPath);
      const legacyConfig = generateClaudeCodeHooksConfig(GUARD_DEFINITIONS, scriptPath);
      expect(adapterConfig).toEqual(legacyConfig);
    });

    it('produces identical output for a subset of guards', () => {
      const subset = GUARD_DEFINITIONS.slice(0, 3);
      const scriptPath = '/path/to/guard.sh';
      expect(adapter.generateHooksConfig(subset, scriptPath))
        .toEqual(generateClaudeCodeHooksConfig(subset, scriptPath));
    });
  });

  describe('detect', () => {
    it('returns true when .claude directory exists', () => {
      // Use the repo's own .claude dir
      expect(adapter.detect(process.cwd())).toBe(true);
    });

    it('returns false for a directory without .claude', () => {
      expect(adapter.detect('/tmp')).toBe(false);
    });
  });

  describe('toolNames', () => {
    it('maps all tool categories', () => {
      expect(adapter.toolNames.read_file).toBe('Read');
      expect(adapter.toolNames.write_file).toBe('Edit|Write');
      expect(adapter.toolNames.execute_command).toBe('Bash');
      expect(adapter.toolNames.create_subagent).toBe('Task');
      expect(adapter.toolNames.exit_plan).toBe('ExitPlanMode');
    });
  });

  describe('supportedEvents', () => {
    it('contains all 4 events', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']));
    });

    it('does not contain unknown events', () => {
      expect(adapter.supportedEvents.has('Unknown')).toBe(false);
    });
  });

  describe('supportsContextInjection', () => {
    it('is true', () => {
      expect(adapter.supportsContextInjection).toBe(true);
    });
  });

  describe('hooksConfigPath', () => {
    it('returns .claude/settings.json', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBe('/tmp/test/.claude/settings.json');
    });
  });

  describe('installGuards', () => {
    it('merges new guards into existing matcher entry instead of skipping', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cc-merge-'));

      // Install first 2 guards
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 2));
      const settingsPath = join(tmpDir, '.claude', 'settings.json');
      const first = JSON.parse(readFileSync(settingsPath, 'utf8'));

      // Count total hook commands across all entries for the first event
      const firstEvent = GUARD_DEFINITIONS[0].hookEvent;
      const firstCount = (first.hooks[firstEvent] as Array<{ hooks: unknown[] }>)
        .reduce((n, e) => n + e.hooks.length, 0);

      // Install first 4 guards — should merge new commands into existing entries
      adapter.installGuards(tmpDir, GUARD_DEFINITIONS.slice(0, 4));
      const second = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const secondCount = (second.hooks[firstEvent] as Array<{ hooks: unknown[] }>)
        .reduce((n, e) => n + e.hooks.length, 0);

      // Should have more hook commands (scope-drift merges into hazard's Edit|Write entry)
      expect(secondCount).toBeGreaterThan(firstCount);
    });

    it('does not duplicate hook commands on re-install', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-cc-dedup-'));
      const guards = GUARD_DEFINITIONS.slice(0, 4);

      adapter.installGuards(tmpDir, guards);
      const settingsPath = join(tmpDir, '.claude', 'settings.json');
      const first = JSON.parse(readFileSync(settingsPath, 'utf8'));

      // Re-install same guards
      adapter.installGuards(tmpDir, guards);
      const second = JSON.parse(readFileSync(settingsPath, 'utf8'));

      // Should be identical
      expect(second).toEqual(first);
    });
  });
});

describe('toolCategories on GUARD_DEFINITIONS', () => {
  it('every guard with a matcher has toolCategories', () => {
    for (const g of GUARD_DEFINITIONS) {
      if (g.matcher) {
        expect(g.toolCategories, `${g.name} should have toolCategories`).toBeDefined();
        expect(g.toolCategories!.length).toBeGreaterThan(0);
      }
    }
  });

  it('guards without matcher have no toolCategories (fires on all tools)', () => {
    const noMatcher = GUARD_DEFINITIONS.filter(g => !g.matcher);
    for (const g of noMatcher) {
      // compaction, stop-check, next-action have no matcher and no toolCategories
      // transcript has no matcher and no toolCategories
      expect(g.toolCategories, `${g.name} should not have toolCategories`).toBeUndefined();
    }
  });

  it('resolveToolMatcher(claudeCodeAdapter, toolCategories) matches matcher for all guards', () => {
    const adapter = new ClaudeCodeAdapter();
    for (const g of GUARD_DEFINITIONS) {
      const resolved = resolveToolMatcher(adapter, g.toolCategories);
      if (g.matcher) {
        // Compare as sorted sets — order doesn't matter for pipe-separated matchers
        const resolvedSet = new Set(resolved?.split('|'));
        const matcherSet = new Set(g.matcher.split('|'));
        expect(resolvedSet, `${g.name}: resolved toolCategories should match matcher`).toEqual(matcherSet);
      } else {
        expect(resolved, `${g.name}: no toolCategories should resolve to undefined`).toBeUndefined();
      }
    }
  });
});
