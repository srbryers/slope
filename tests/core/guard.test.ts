import { describe, it, expect } from 'vitest';
import {
  GUARD_DEFINITIONS,
  formatPreToolUseOutput,
  formatPostToolUseOutput,
  formatStopOutput,
  generateClaudeCodeHooksConfig,
} from '../../src/core/guard.js';
import type { GuardResult } from '../../src/core/guard.js';
// Register adapter so format functions can look it up from the registry
import '../../src/core/adapters/claude-code.js';

describe('GUARD_DEFINITIONS', () => {
  it('has 22 guard definitions', () => {
    expect(GUARD_DEFINITIONS).toHaveLength(22);
  });

  it('all guards have required fields', () => {
    for (const d of GUARD_DEFINITIONS) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact']).toContain(d.hookEvent);
      expect(['scoring', 'full']).toContain(d.level);
    }
  });

  it('has unique guard name+hookEvent pairs', () => {
    const keys = GUARD_DEFINITIONS.map(d => `${d.name}:${d.hookEvent}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all current guards are level=full', () => {
    // No scoring-level guards yet — all are full
    expect(GUARD_DEFINITIONS.every(d => d.level === 'full')).toBe(true);
  });

  it('PreToolUse guards have matchers', () => {
    const pre = GUARD_DEFINITIONS.filter(d => d.hookEvent === 'PreToolUse');
    expect(pre.length).toBeGreaterThan(0);
    for (const d of pre) {
      expect(d.matcher).toBeTruthy();
    }
  });
});

describe('formatPreToolUseOutput', () => {
  it('formats context-only guidance', () => {
    const result: GuardResult = { context: 'Watch out for this area' };
    const output = formatPreToolUseOutput(result);
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.additionalContext).toBe('Watch out for this area');
    expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it('formats deny decision', () => {
    const result: GuardResult = { decision: 'deny', blockReason: 'Blocked by SLOPE' };
    const output = formatPreToolUseOutput(result);
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe('Blocked by SLOPE');
  });

  it('formats combined context + decision', () => {
    const result: GuardResult = { context: 'Heads up', decision: 'allow' };
    const output = formatPreToolUseOutput(result);
    expect(output.hookSpecificOutput.additionalContext).toBe('Heads up');
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('omits undefined fields', () => {
    const result: GuardResult = { context: 'Info' };
    const output = formatPreToolUseOutput(result);
    expect('permissionDecision' in output.hookSpecificOutput).toBe(false);
    expect('permissionDecisionReason' in output.hookSpecificOutput).toBe(false);
  });
});

describe('formatPostToolUseOutput', () => {
  it('formats context-only feedback', () => {
    const result: GuardResult = { context: 'Post-shot note' };
    const output = formatPostToolUseOutput(result);
    expect(output.hookSpecificOutput?.additionalContext).toBe('Post-shot note');
    expect(output.decision).toBeUndefined();
  });

  it('formats block with reason', () => {
    const result: GuardResult = { blockReason: 'Tests failed', context: 'Fix before proceeding' };
    const output = formatPostToolUseOutput(result);
    expect(output.decision).toBe('block');
    expect(output.reason).toBe('Tests failed');
    expect(output.hookSpecificOutput?.additionalContext).toBe('Fix before proceeding');
  });

  it('returns empty object when no guidance', () => {
    const result: GuardResult = {};
    const output = formatPostToolUseOutput(result);
    expect(output).toEqual({});
  });
});

describe('formatStopOutput', () => {
  it('formats block decision', () => {
    const result: GuardResult = { blockReason: 'Uncommitted changes' };
    const output = formatStopOutput(result);
    expect(output.decision).toBe('block');
    expect(output.reason).toBe('Uncommitted changes');
  });

  it('returns empty object when clean', () => {
    const result: GuardResult = {};
    const output = formatStopOutput(result);
    expect(output).toEqual({});
  });
});

describe('generateClaudeCodeHooksConfig', () => {
  it('generates config for PreToolUse guards', () => {
    const guards = GUARD_DEFINITIONS.filter(d => d.hookEvent === 'PreToolUse');
    const config = generateClaudeCodeHooksConfig(guards, 'slope-guard.sh');

    expect(config.PreToolUse).toBeDefined();
    expect(config.PreToolUse.length).toBeGreaterThan(0);

    // Each entry should have hooks array with command type
    for (const entry of config.PreToolUse) {
      expect(entry.hooks).toBeDefined();
      for (const h of entry.hooks) {
        expect(h.type).toBe('command');
        expect(h.command).toContain('slope-guard.sh');
      }
    }
  });

  it('groups guards by hookEvent and matcher', () => {
    // hazard and scope-drift both match Edit|Write on PreToolUse
    const guards = GUARD_DEFINITIONS.filter(d =>
      d.name === 'hazard' || d.name === 'scope-drift',
    );
    const config = generateClaudeCodeHooksConfig(guards, 'guard.sh');

    // Both share the same matcher, so should be in one entry
    expect(config.PreToolUse).toHaveLength(1);
    expect(config.PreToolUse[0].hooks).toHaveLength(2);
    expect(config.PreToolUse[0].matcher).toBe('Edit|Write');
  });

  it('generates config for all hook event types', () => {
    const config = generateClaudeCodeHooksConfig(GUARD_DEFINITIONS, 'guard.sh');

    expect(config.PreToolUse).toBeDefined();
    expect(config.PostToolUse).toBeDefined();
    expect(config.Stop).toBeDefined();
    expect(config.PreCompact).toBeDefined();
  });

  it('includes statusMessage from guard description', () => {
    const guards = [GUARD_DEFINITIONS[0]]; // explore guard
    const config = generateClaudeCodeHooksConfig(guards, 'guard.sh');
    const hook = config.PreToolUse[0].hooks[0];
    expect(hook.statusMessage).toContain('SLOPE');
  });
});
