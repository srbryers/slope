import { describe, it, expect } from 'vitest';

/**
 * Executor tests — focused on exported behavior and integration points.
 * The executor's internal functions (buildPrompt, validateTicketsOnDisk, etc.)
 * are private, so we test them indirectly through runSprint with mocked deps.
 * We also test isShuttingDown (the only pure exported function).
 */

import { isShuttingDown, buildPrompt, saveResult } from '../../../src/cli/loop/executor.js';
import type { BacklogTicket, SprintResult, LoopConfig } from '../../../src/cli/loop/types.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('isShuttingDown', () => {
  it('returns false initially', () => {
    expect(isShuttingDown()).toBe(false);
  });
});

describe('buildPrompt', () => {
  const baseTicket: BacklogTicket = {
    key: 'S-001-1',
    title: 'Add user authentication',
    description: 'Implement JWT-based authentication for API endpoints',
    acceptance_criteria: ['Users can log in with email/password', 'JWT tokens are validated on protected routes'],
    club: 'short_iron',
    max_files: 3,
    estimated_tokens: 1200,
    modules: ['src/auth/login.ts', 'src/auth/middleware.ts'],
    files: {
      primary: ['src/auth/login.ts', 'src/auth/middleware.ts'],
    },
  };

  it('includes basic prompt structure with ticket metadata', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('SLOPE project');
    expect(prompt).toContain('TypeScript monorepo');
    expect(prompt).toContain('S-001-1: Add user authentication');
    expect(prompt).toContain('Implement JWT-based authentication for API endpoints');
    expect(prompt).toContain('S-001-1');
  });

  it('formats acceptance criteria as checkbox list', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('[ ] Users can log in with email/password');
    expect(prompt).toContain('[ ] JWT tokens are validated on protected routes');
  });

  it('includes target files section with primary files', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('## Target Files');
    expect(prompt).toContain('src/auth/login.ts');
    expect(prompt).toContain('src/auth/middleware.ts');
  });

  it('includes plan-then-execute approach for API models', () => {
    const prompt = buildPrompt(baseTicket, 'openrouter/anthropic/claude-haiku-4-5');

    expect(prompt).toContain('plan then execute');
    expect(prompt).toContain('List the specific changes needed per file');
  });

  it('includes simple approach for local (ollama) models', () => {
    const prompt = buildPrompt(baseTicket, 'ollama/qwen3-coder-next-fast');

    expect(prompt).toContain('local model');
    expect(prompt).toContain('ONE file at a time');
    expect(prompt).toContain('smallest possible change');
  });

  it('limits file list to first 5 files', () => {
    const ticketWithManyFiles: BacklogTicket = {
      ...baseTicket,
      files: {
        primary: [
          'src/file1.ts', 'src/file2.ts', 'src/file3.ts',
          'src/file4.ts', 'src/file5.ts', 'src/file6.ts', 'src/file7.ts',
        ],
      },
    };

    const prompt = buildPrompt(ticketWithManyFiles, 'qwen2.5:32b');

    expect(prompt).toContain('src/file1.ts');
    expect(prompt).toContain('src/file5.ts');
    expect(prompt).not.toContain('src/file6.ts');
  });

  it('falls back to modules when no primary files', () => {
    const ticketNoFiles: BacklogTicket = {
      ...baseTicket,
      files: undefined,
      modules: ['src/core/auth.ts'],
    };

    const prompt = buildPrompt(ticketNoFiles, 'qwen2.5:32b');

    expect(prompt).toContain('src/core/auth.ts');
  });

  it('shows placeholder when no files or modules', () => {
    const ticketNoFiles: BacklogTicket = {
      ...baseTicket,
      files: undefined,
      modules: [],
    };

    const prompt = buildPrompt(ticketNoFiles, 'qwen2.5:32b');

    expect(prompt).toContain('read the description to identify target files');
  });

  it('includes commit message guidance with ticket key', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain("S-001-1: <what you changed>");
  });

  it('includes substantiveness rule', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('substantive changes');
    expect(prompt).toContain('do NOT add only comments');
  });

  it('includes token budget section', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('Token Budget');
    expect(prompt).toContain('tokens');
    expect(prompt).toContain('focus on the core change');
  });

  it('calculates budget based on club (short_iron = 8K for API)', () => {
    const prompt = buildPrompt(baseTicket, 'openrouter/anthropic/claude-haiku-4-5');

    expect(prompt).toContain('~8000 tokens');
  });

  it('halves budget for local models (short_iron = 4K for local)', () => {
    const prompt = buildPrompt(baseTicket, 'ollama/qwen3-coder-next-fast');

    expect(prompt).toContain('~4000 tokens');
  });

  it('uses putter budget (4K API, 2K local)', () => {
    const putterTicket: BacklogTicket = {
      ...baseTicket,
      club: 'putter',
    };
    const apiPrompt = buildPrompt(putterTicket, 'openrouter/anthropic/claude-haiku-4-5');
    const localPrompt = buildPrompt(putterTicket, 'ollama/qwen3-coder-next-fast');

    expect(apiPrompt).toContain('~4000 tokens');
    expect(localPrompt).toContain('~2000 tokens');
  });

  it('uses driver budget (24K API, 12K local)', () => {
    const driverTicket: BacklogTicket = {
      ...baseTicket,
      club: 'driver',
    };
    const apiPrompt = buildPrompt(driverTicket, 'openrouter/anthropic/claude-haiku-4-5');
    const localPrompt = buildPrompt(driverTicket, 'ollama/qwen3-coder-next-fast');

    expect(apiPrompt).toContain('~24000 tokens');
    expect(localPrompt).toContain('~12000 tokens');
  });

  it('includes verification commands', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('pnpm typecheck');
    expect(prompt).toContain('pnpm test');
  });

  it('instructs to read files before modifying', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');

    expect(prompt).toContain('Read each target file BEFORE modifying it');
  });
});

describe('saveResult', () => {
  it('writes result to correct path with proper JSON formatting', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-test-'));
    try {
      const config: LoopConfig = {
        modelLocal: 'qwen2.5:32b',
        modelApi: 'minimax/api-key',
        ollamaApiBase: 'http://localhost:11434',
        ollamaFlashAttention: false,
        ollamaKvCacheType: 'q8',
        modelApiTimeout: 120,
        modelLocalTimeout: 60,
        escalateOnFail: true,
        agentGuideMaxWords: 2000,
        resultsDir: 'results',
        logDir: 'logs',
        backlogPath: '.slope/backlog.json',
        agentGuide: 'slope-loop/SKILL.md',
        sprintHistory: 'slope-loop/sprint-history.md',
        loopTestCmd: 'pnpm test',
        modelRegenThreshold: 10,
      };

      const result: SprintResult = {
        sprint_id: 'S-001',
        title: 'Test Sprint',
        strategy: 'balanced',
        completed_at: '2026-03-03T12:00:00Z',
        branch: 'sprint/S-001',
        tickets_total: 2,
        tickets_passing: 2,
        tickets_noop: 0,
        tickets: [],
      };

      saveResult(result, tmpDir, config);

      const finalPath = join(tmpDir, 'results', 'S-001.json');
      const content = readFileSync(finalPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.sprint_id).toBe('S-001');
      expect(parsed.title).toBe('Test Sprint');
      expect(parsed.tickets_passing).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('performs atomic write using tmp file and rename', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slope-test-'));
    try {
      const config: LoopConfig = {
        modelLocal: 'qwen2.5:32b',
        modelApi: 'minimax/api-key',
        ollamaApiBase: 'http://localhost:11434',
        ollamaFlashAttention: false,
        ollamaKvCacheType: 'q8',
        modelApiTimeout: 120,
        modelLocalTimeout: 60,
        escalateOnFail: true,
        agentGuideMaxWords: 2000,
        resultsDir: 'results',
        logDir: 'logs',
        backlogPath: '.slope/backlog.json',
        agentGuide: 'slope-loop/SKILL.md',
        sprintHistory: 'slope-loop/sprint-history.md',
        loopTestCmd: 'pnpm test',
        modelRegenThreshold: 10,
      };

      const result: SprintResult = {
        sprint_id: 'S-002',
        title: 'Atomic Test',
        strategy: 'balanced',
        completed_at: '2026-03-03T13:00:00Z',
        branch: 'sprint/S-002',
        tickets_total: 1,
        tickets_passing: 1,
        tickets_noop: 0,
        tickets: [],
      };

      saveResult(result, tmpDir, config);

      const finalPath = join(tmpDir, 'results', 'S-002.json');
      const tmpPath = join(tmpDir, 'results', 'S-002.tmp.json');

      // Final file should exist
      expect(() => readFileSync(finalPath, 'utf8')).not.toThrow();

      // Tmp file should not exist (renamed away)
      expect(() => readFileSync(tmpPath, 'utf8')).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
