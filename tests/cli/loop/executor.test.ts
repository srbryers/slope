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
    files: {
      primary: ['src/auth/login.ts', 'src/auth/middleware.ts'],
      related: ['src/types/user.ts'],
    },
  };

  it('includes basic prompt structure with ticket metadata', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('SLOPE project');
    expect(prompt).toContain('TypeScript monorepo');
    expect(prompt).toContain('TICKET: Add user authentication');
    expect(prompt).toContain('DESCRIPTION: Implement JWT-based authentication for API endpoints');
    expect(prompt).toContain('S-001-1');
  });

  it('formats acceptance criteria as semicolon-separated list', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('ACCEPTANCE CRITERIA: Users can log in with email/password; JWT tokens are validated on protected routes');
  });

  it('includes planning approach for minimax model', () => {
    const prompt = buildPrompt(baseTicket, 'minimax/api-key');
    
    expect(prompt).toContain('APPROACH: Plan before coding');
    expect(prompt).toContain('List files to modify');
    expect(prompt).toContain('changes per file');
    expect(prompt).toContain('verification steps');
  });

  it('includes planning approach for claude model', () => {
    const prompt = buildPrompt(baseTicket, 'claude-3.5-sonnet');
    
    expect(prompt).toContain('APPROACH: Plan before coding');
    expect(prompt).toContain('List files to modify');
  });

  it('includes minimal approach for local models', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('APPROACH: Make the smallest possible change');
    expect(prompt).toContain('Focus on a single file at a time');
    expect(prompt).toContain('Keep edits minimal');
  });

  it('injects primary files when available', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('FILES TO MODIFY:');
    expect(prompt).toContain('- src/auth/login.ts');
    expect(prompt).toContain('- src/auth/middleware.ts');
  });

  it('limits file list to first 5 files', () => {
    const ticketWithManyFiles: BacklogTicket = {
      ...baseTicket,
      files: {
        primary: [
          'src/file1.ts',
          'src/file2.ts',
          'src/file3.ts',
          'src/file4.ts',
          'src/file5.ts',
          'src/file6.ts',
          'src/file7.ts',
        ],
        related: [],
      },
    };
    
    const prompt = buildPrompt(ticketWithManyFiles, 'qwen2.5:32b');
    
    expect(prompt).toContain('- src/file1.ts');
    expect(prompt).toContain('- src/file5.ts');
    expect(prompt).not.toContain('- src/file6.ts');
  });

  it('omits FILES TO MODIFY section when no primary files', () => {
    const ticketNoFiles: BacklogTicket = {
      ...baseTicket,
      files: {
        primary: [],
        related: [],
      },
    };
    
    const prompt = buildPrompt(ticketNoFiles, 'qwen2.5:32b');
    
    expect(prompt).not.toContain('FILES TO MODIFY:');
  });

  it('includes commit message guidance with ticket key', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('Commit with a message starting with \'S-001-1:\'');
  });

  it('includes standard rules for all models', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('Make minimal, focused changes');
    expect(prompt).toContain('do not refactor unrelated code');
    expect(prompt).toContain('pnpm test');
    expect(prompt).toContain('pnpm typecheck');
  });

  it('includes final instruction to read source files first', () => {
    const prompt = buildPrompt(baseTicket, 'qwen2.5:32b');
    
    expect(prompt).toContain('START by reading the relevant source files');
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

// The executor's runSprint requires heavy mocking of child_process, fs, and
// all loop modules. We test the individual components (worktree, guard-runner,
// pr-lifecycle) separately and verify integration via dry-run in a later
// integration test.
