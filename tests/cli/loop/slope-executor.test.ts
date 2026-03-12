import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  slopeExecutor,
  safePath,
  resolveModelId,
  lookupCost,
  runTool,
  buildSystemPrompt,
} from '../../../src/cli/loop/slope-executor.js';
import type { ExecutionContext, LoopConfig, BacklogTicket } from '../../../src/cli/loop/types.js';
import type { Logger } from '../../../src/cli/loop/logger.js';

const mockLog: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLog,
};

// ── safePath ────────────────────────────────────────

describe('safePath', () => {
  it('resolves a valid relative path', () => {
    const result = safePath('src/foo.ts', '/repo');
    expect(result).toBe('/repo/src/foo.ts');
  });

  it('resolves nested paths', () => {
    const result = safePath('src/cli/loop/executor.ts', '/repo');
    expect(result).toBe('/repo/src/cli/loop/executor.ts');
  });

  it('blocks path traversal with ../', () => {
    expect(() => safePath('../../../etc/passwd', '/repo')).toThrow('Path traversal blocked');
  });

  it('blocks absolute paths outside cwd', () => {
    expect(() => safePath('/etc/passwd', '/repo')).toThrow('Path traversal blocked');
  });

  it('allows paths that resolve within cwd', () => {
    // src/../src/foo.ts resolves to /repo/src/foo.ts — still within cwd
    const result = safePath('src/../src/foo.ts', '/repo');
    expect(result).toBe('/repo/src/foo.ts');
  });
});

// ── resolveModelId ──────────────────────────────────

describe('resolveModelId', () => {
  it('strips openrouter/anthropic/ prefix', () => {
    expect(resolveModelId('openrouter/anthropic/claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('strips anthropic/ prefix', () => {
    expect(resolveModelId('anthropic/claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
  });

  it('passes through bare model IDs unchanged', () => {
    expect(resolveModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
  });

  it('handles unknown prefixes by leaving them', () => {
    expect(resolveModelId('together/meta-llama/Llama-3')).toBe('together/meta-llama/Llama-3');
  });
});

// ── lookupCost ──────────────────────────────────────

describe('lookupCost', () => {
  it('returns haiku pricing for claude-haiku-4-5', () => {
    const cost = lookupCost('claude-haiku-4-5');
    expect(cost.in).toBe(0.80);
    expect(cost.out).toBe(4.00);
  });

  it('returns sonnet pricing for claude-sonnet-4-5', () => {
    const cost = lookupCost('claude-sonnet-4-5');
    expect(cost.in).toBe(3.00);
    expect(cost.out).toBe(15.00);
  });

  it('returns opus pricing for claude-opus-4-6', () => {
    const cost = lookupCost('claude-opus-4-6');
    expect(cost.in).toBe(15.00);
    expect(cost.out).toBe(75.00);
  });

  it('returns default cost for unknown models', () => {
    const cost = lookupCost('unknown-model');
    expect(cost.in).toBe(1.00);
    expect(cost.out).toBe(5.00);
  });

  it('matches partial model ID (includes check)', () => {
    // Model ID "claude-sonnet-4-6" should match the "claude-sonnet-4-6" key
    const cost = lookupCost('claude-sonnet-4-6');
    expect(cost.in).toBe(3.00);
  });
});

// ── runTool ─────────────────────────────────────────

describe('runTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-executor-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('read_file', () => {
    it('reads an existing file', () => {
      writeFileSync(join(tmpDir, 'test.txt'), 'hello world');
      const result = runTool('read_file', { path: 'test.txt' }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
      expect(result.output).toBe('hello world');
    });

    it('returns error for non-existent file', () => {
      const result = runTool('read_file', { path: 'missing.txt' }, tmpDir, mockLog);
      expect(result.isError).toBe(true);
      expect(result.output).toContain('File not found');
    });

    it('truncates files over 100KB', () => {
      const largeContent = 'x'.repeat(150_000);
      writeFileSync(join(tmpDir, 'large.txt'), largeContent);
      const result = runTool('read_file', { path: 'large.txt' }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
      expect(result.output).toContain('truncated');
      expect(result.output.length).toBeLessThan(largeContent.length);
    });
  });

  describe('write_file', () => {
    it('writes a new file', () => {
      const result = runTool('write_file', { path: 'new.txt', content: 'new content' }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
      expect(readFileSync(join(tmpDir, 'new.txt'), 'utf8')).toBe('new content');
    });

    it('creates parent directories', () => {
      const result = runTool('write_file', { path: 'deep/nested/dir/file.ts', content: 'export {}' }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
      expect(readFileSync(join(tmpDir, 'deep/nested/dir/file.ts'), 'utf8')).toBe('export {}');
    });

    it('overwrites existing files', () => {
      writeFileSync(join(tmpDir, 'existing.txt'), 'old');
      runTool('write_file', { path: 'existing.txt', content: 'new' }, tmpDir, mockLog);
      expect(readFileSync(join(tmpDir, 'existing.txt'), 'utf8')).toBe('new');
    });
  });

  describe('edit_file', () => {
    it('replaces exact string match', () => {
      writeFileSync(join(tmpDir, 'edit.ts'), 'const x = 1;\nconst y = 2;\n');
      const result = runTool('edit_file', {
        path: 'edit.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 42;',
      }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
      expect(readFileSync(join(tmpDir, 'edit.ts'), 'utf8')).toBe('const x = 42;\nconst y = 2;\n');
    });

    it('returns error when old_string not found', () => {
      writeFileSync(join(tmpDir, 'edit.ts'), 'const x = 1;');
      const result = runTool('edit_file', {
        path: 'edit.ts',
        old_string: 'const z = 999;',
        new_string: 'replacement',
      }, tmpDir, mockLog);
      expect(result.isError).toBe(true);
      expect(result.output).toContain('old_string not found');
    });

    it('returns error for non-existent file', () => {
      const result = runTool('edit_file', {
        path: 'missing.ts',
        old_string: 'foo',
        new_string: 'bar',
      }, tmpDir, mockLog);
      expect(result.isError).toBe(true);
      expect(result.output).toContain('File not found');
    });

    it('replaces only the first occurrence', () => {
      writeFileSync(join(tmpDir, 'dup.ts'), 'aaa\naaa\naaa\n');
      runTool('edit_file', {
        path: 'dup.ts',
        old_string: 'aaa',
        new_string: 'bbb',
      }, tmpDir, mockLog);
      expect(readFileSync(join(tmpDir, 'dup.ts'), 'utf8')).toBe('bbb\naaa\naaa\n');
    });
  });

  describe('bash', () => {
    it('executes a simple command', () => {
      const result = runTool('bash', { command: 'echo hello' }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
      expect(result.output.trim()).toBe('hello');
    });

    it('returns error output on failure', () => {
      const result = runTool('bash', { command: 'false' }, tmpDir, mockLog);
      expect(result.isError).toBe(true);
    });

    it('blocks rm -rf /', () => {
      const result = runTool('bash', { command: 'rm -rf /' }, tmpDir, mockLog);
      expect(result.isError).toBe(true);
      expect(result.output).toContain('Blocked');
    });

    it('blocks git push --force', () => {
      const result = runTool('bash', { command: 'git push --force origin main' }, tmpDir, mockLog);
      expect(result.isError).toBe(true);
      expect(result.output).toContain('Blocked');
    });

    it('allows safe rm commands', () => {
      writeFileSync(join(tmpDir, 'deleteme.txt'), 'bye');
      const result = runTool('bash', { command: `rm ${join(tmpDir, 'deleteme.txt')}` }, tmpDir, mockLog);
      expect(result.isError).toBe(false);
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', () => {
      const result = runTool('nonexistent', {}, tmpDir, mockLog);
      expect(result.isError).toBe(true);
      expect(result.output).toContain('Unknown tool');
    });
  });
});

// ── buildSystemPrompt ───────────────────────────────

describe('buildSystemPrompt', () => {
  let tmpDir: string;

  const baseTicket: BacklogTicket = {
    key: 'TEST-1',
    title: 'Test ticket',
    club: 'short_iron',
    description: 'Do something',
    acceptance_criteria: ['It works'],
    modules: ['src/test.ts'],
    max_files: 1,
  };

  const mockConfig = {
    agentGuide: 'SKILL.md',
    agentGuideMaxWords: 5000,
  } as LoopConfig;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-prompt-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes working directory', () => {
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).toContain(tmpDir);
  });

  it('includes the ticket key in commit guidance', () => {
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).toContain("TEST-1: <summary>");
  });

  it('includes rules about reading files first', () => {
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).toContain('ALWAYS read a file before editing it');
  });

  it('includes agent guide when file exists and under word limit', () => {
    writeFileSync(join(tmpDir, 'SKILL.md'), 'This is the guide content');
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).toContain('Agent Guide');
    expect(prompt).toContain('This is the guide content');
  });

  it('excludes agent guide when over word limit', () => {
    const longGuide = Array(6000).fill('word').join(' ');
    writeFileSync(join(tmpDir, 'SKILL.md'), longGuide);
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).not.toContain('Agent Guide');
  });

  it('excludes agent guide when file does not exist', () => {
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).not.toContain('Agent Guide');
  });

  it('lists available tools', () => {
    const ctx = { ticketKey: 'TEST-1', ticket: baseTicket } as ExecutionContext;
    const prompt = buildSystemPrompt(ctx, mockConfig, tmpDir);
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('edit_file');
    expect(prompt).toContain('write_file');
    expect(prompt).toContain('bash');
    expect(prompt).toContain('glob');
    expect(prompt).toContain('grep');
  });
});

// ── slopeExecutor interface ─────────────────────────

describe('slopeExecutor', () => {
  it('has id "slope"', () => {
    expect(slopeExecutor.id).toBe('slope');
  });

  it('implements the execute method', () => {
    expect(typeof slopeExecutor.execute).toBe('function');
  });
});
