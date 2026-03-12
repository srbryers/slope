import { describe, it, expect, beforeEach } from 'vitest';
import { registerExecutor, getExecutor, selectExecutor } from '../../../src/cli/loop/executor-adapter.js';
import type { ExecutorAdapter, ExecutionResult } from '../../../src/cli/loop/types.js';

// Minimal mock executors
function makeExecutor(id: 'aider' | 'slope'): ExecutorAdapter {
  return {
    id,
    async execute(): Promise<ExecutionResult> {
      return {
        outcome: 'completed',
        noop: false,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        duration_s: 0,
        transcript: [],
        files_changed: [],
      };
    },
  };
}

describe('executor-adapter', () => {
  // Re-register both before each test to ensure clean state
  // (the real module uses a global Map, so we need both registered)
  beforeEach(() => {
    registerExecutor(makeExecutor('aider'));
    registerExecutor(makeExecutor('slope'));
  });

  describe('registerExecutor / getExecutor', () => {
    it('registers and retrieves an executor by id', () => {
      const exec = getExecutor('aider');
      expect(exec.id).toBe('aider');
    });

    it('retrieves slope executor after registration', () => {
      const exec = getExecutor('slope');
      expect(exec.id).toBe('slope');
    });

    it('throws for unknown executor id', () => {
      expect(() => getExecutor('unknown' as any)).toThrow('Unknown executor: unknown');
    });
  });

  describe('selectExecutor', () => {
    it('returns aider when override is "aider"', () => {
      const exec = selectExecutor('openrouter/anthropic/claude-haiku-4-5', 'aider');
      expect(exec.id).toBe('aider');
    });

    it('returns slope when override is "slope"', () => {
      const exec = selectExecutor('ollama/qwen3-coder-next-fast', 'slope');
      expect(exec.id).toBe('slope');
    });

    it('auto-selects slope for API models when slope is registered', () => {
      const exec = selectExecutor('openrouter/anthropic/claude-haiku-4-5');
      expect(exec.id).toBe('slope');
    });

    it('auto-selects aider for local (ollama) models', () => {
      const exec = selectExecutor('ollama/qwen3-coder-next-fast');
      expect(exec.id).toBe('aider');
    });
  });
});
