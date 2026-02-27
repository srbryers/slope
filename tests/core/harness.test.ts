import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAdapter,
  getAdapter,
  listAdapters,
  detectAdapter,
  clearAdapters,
  resolveToolMatcher,
  CLAUDE_CODE_TOOLS,
  TOOL_CATEGORIES,
  ADAPTER_PRIORITY,
} from '../../src/core/harness.js';
import type { HarnessAdapter, ToolNameMap, ToolCategory } from '../../src/core/harness.js';
import type { GuardResult } from '../../src/core/guard.js';

function makeAdapter(id: string, detectResult = false): HarnessAdapter {
  return {
    id: id as HarnessAdapter['id'],
    displayName: `${id} adapter`,
    toolNames: CLAUDE_CODE_TOOLS,
    formatPreToolOutput: (r: GuardResult) => ({ pre: r }),
    formatPostToolOutput: (r: GuardResult) => ({ post: r }),
    formatStopOutput: (r: GuardResult) => ({ stop: r }),
    generateHooksConfig: () => ({}),
    installGuards: () => {},
    detect: () => detectResult,
  };
}

describe('harness adapter registry', () => {
  beforeEach(() => {
    clearAdapters();
  });

  it('registerAdapter + getAdapter round-trips', () => {
    const adapter = makeAdapter('claude-code');
    registerAdapter(adapter);
    expect(getAdapter('claude-code')).toBe(adapter);
  });

  it('getAdapter returns undefined for unregistered id', () => {
    expect(getAdapter('claude-code')).toBeUndefined();
  });

  it('registerAdapter overwrites existing registration', () => {
    const a1 = makeAdapter('claude-code');
    const a2 = makeAdapter('claude-code');
    registerAdapter(a1);
    registerAdapter(a2);
    expect(getAdapter('claude-code')).toBe(a2);
  });

  it('listAdapters returns all registered ids', () => {
    registerAdapter(makeAdapter('claude-code'));
    registerAdapter(makeAdapter('cursor'));
    registerAdapter(makeAdapter('generic'));
    expect(listAdapters()).toEqual(['claude-code', 'cursor', 'generic']);
  });

  it('listAdapters returns empty array when none registered', () => {
    expect(listAdapters()).toEqual([]);
  });

  it('clearAdapters removes all registrations', () => {
    registerAdapter(makeAdapter('claude-code'));
    registerAdapter(makeAdapter('cursor'));
    clearAdapters();
    expect(listAdapters()).toEqual([]);
    expect(getAdapter('claude-code')).toBeUndefined();
  });
});

describe('detectAdapter', () => {
  beforeEach(() => {
    clearAdapters();
  });

  it('returns the first adapter whose detect() returns true', () => {
    registerAdapter(makeAdapter('claude-code', true));
    registerAdapter(makeAdapter('cursor', false));
    const result = detectAdapter('/tmp');
    expect(result?.id).toBe('claude-code');
  });

  it('skips generic adapter during primary detection pass', () => {
    registerAdapter(makeAdapter('generic', true));
    registerAdapter(makeAdapter('claude-code', true));
    const result = detectAdapter('/tmp');
    expect(result?.id).toBe('claude-code');
  });

  it('falls back to generic if no other adapter matches', () => {
    registerAdapter(makeAdapter('claude-code', false));
    registerAdapter(makeAdapter('generic', true));
    const result = detectAdapter('/tmp');
    expect(result?.id).toBe('generic');
  });

  it('returns undefined if nothing matches and no generic registered', () => {
    registerAdapter(makeAdapter('claude-code', false));
    expect(detectAdapter('/tmp')).toBeUndefined();
  });

  it('returns undefined when no adapters registered', () => {
    expect(detectAdapter('/tmp')).toBeUndefined();
  });

  it('respects ADAPTER_PRIORITY order — claude-code wins over cursor', () => {
    // Register in reverse priority order
    registerAdapter(makeAdapter('cursor', true));
    registerAdapter(makeAdapter('claude-code', true));
    const result = detectAdapter('/tmp');
    expect(result?.id).toBe('claude-code');
  });

  it('respects ADAPTER_PRIORITY order — cursor wins over windsurf', () => {
    registerAdapter(makeAdapter('windsurf', true));
    registerAdapter(makeAdapter('cursor', true));
    const result = detectAdapter('/tmp');
    expect(result?.id).toBe('cursor');
  });

  it('detects third-party adapters not in ADAPTER_PRIORITY', () => {
    registerAdapter(makeAdapter('claude-code', false));
    registerAdapter(makeAdapter('my-custom-harness', true));
    registerAdapter(makeAdapter('generic', true));
    const result = detectAdapter('/tmp');
    expect(result?.id).toBe('my-custom-harness');
  });
});

describe('ADAPTER_PRIORITY', () => {
  it('starts with claude-code and ends with generic', () => {
    expect(ADAPTER_PRIORITY[0]).toBe('claude-code');
    expect(ADAPTER_PRIORITY[ADAPTER_PRIORITY.length - 1]).toBe('generic');
  });

  it('includes cursor and windsurf', () => {
    expect(ADAPTER_PRIORITY).toContain('cursor');
    expect(ADAPTER_PRIORITY).toContain('windsurf');
  });
});

describe('CLAUDE_CODE_TOOLS', () => {
  it('maps all tool categories', () => {
    for (const cat of TOOL_CATEGORIES) {
      expect(CLAUDE_CODE_TOOLS[cat]).toBeDefined();
      expect(typeof CLAUDE_CODE_TOOLS[cat]).toBe('string');
    }
  });

  it('has expected Claude Code tool names', () => {
    expect(CLAUDE_CODE_TOOLS.read_file).toBe('Read');
    expect(CLAUDE_CODE_TOOLS.write_file).toBe('Edit|Write');
    expect(CLAUDE_CODE_TOOLS.search_files).toBe('Glob');
    expect(CLAUDE_CODE_TOOLS.search_content).toBe('Grep');
    expect(CLAUDE_CODE_TOOLS.execute_command).toBe('Bash');
    expect(CLAUDE_CODE_TOOLS.create_subagent).toBe('Task');
    expect(CLAUDE_CODE_TOOLS.exit_plan).toBe('ExitPlanMode');
  });
});

describe('TOOL_CATEGORIES', () => {
  it('contains exactly 7 categories', () => {
    expect(TOOL_CATEGORIES).toHaveLength(7);
  });

  it('matches ToolNameMap keys', () => {
    const mapKeys = Object.keys(CLAUDE_CODE_TOOLS).sort();
    const catsSorted = [...TOOL_CATEGORIES].sort();
    expect(catsSorted).toEqual(mapKeys);
  });
});

describe('resolveToolMatcher', () => {
  const adapter = makeAdapter('claude-code');

  it('returns undefined for undefined categories (match all)', () => {
    expect(resolveToolMatcher(adapter, undefined)).toBeUndefined();
  });

  it('resolves a single category', () => {
    expect(resolveToolMatcher(adapter, ['read_file'])).toBe('Read');
  });

  it('resolves multiple categories with deduplication', () => {
    const result = resolveToolMatcher(adapter, ['read_file', 'search_files']);
    expect(result).toBe('Read|Glob');
  });

  it('expands pipe-separated tool names', () => {
    // write_file maps to 'Edit|Write', so should produce individual entries
    const result = resolveToolMatcher(adapter, ['write_file']);
    expect(result).toBe('Edit|Write');
  });

  it('deduplicates across categories', () => {
    // Custom adapter where two categories map to the same tool
    const customTools: ToolNameMap = {
      ...CLAUDE_CODE_TOOLS,
      search_files: 'Read',
      search_content: 'Read',
    };
    const customAdapter: HarnessAdapter = {
      ...adapter,
      toolNames: customTools,
    };
    const result = resolveToolMatcher(customAdapter, ['read_file', 'search_files', 'search_content']);
    expect(result).toBe('Read');
  });

  it('returns empty string for empty categories array', () => {
    expect(resolveToolMatcher(adapter, [])).toBe('');
  });
});
