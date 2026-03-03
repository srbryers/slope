import { describe, it, expect } from 'vitest';

/**
 * Executor tests — focused on exported behavior and integration points.
 * The executor's internal functions (buildPrompt, validateTicketsOnDisk, etc.)
 * are private, so we test them indirectly through runSprint with mocked deps.
 * We also test isShuttingDown (the only pure exported function).
 */

import { isShuttingDown, buildPrompt } from '../../../src/cli/loop/executor.js';
import type { BacklogTicket } from '../../../src/cli/loop/types.js';

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

// The executor's runSprint requires heavy mocking of child_process, fs, and
// all loop modules. We test the individual components (worktree, guard-runner,
// pr-lifecycle) separately and verify integration via dry-run in a later
// integration test.
