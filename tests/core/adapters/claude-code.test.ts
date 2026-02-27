import { describe, it, expect, beforeEach } from 'vitest';
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
