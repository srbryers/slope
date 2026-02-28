import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Register built-in metaphors
import '../../src/core/metaphors/index.js';

import { buildSummary, renderStep } from '../../src/cli/interactive-init.js';
import type { InterviewStep } from '../../src/core/interview-steps.js';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  text: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { error: vi.fn(), info: vi.fn() },
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as p from '@clack/prompts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-cli-init-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('renderStep', () => {
  it('handles text type with validation', async () => {
    vi.mocked(p.text).mockResolvedValue('my-app');
    const step: InterviewStep = {
      id: 'project-name',
      question: 'Project name?',
      type: 'text',
      default: 'default-app',
      validate: (v) => (String(v).trim() ? null : 'Required'),
    };
    const result = await renderStep(step, {});
    expect(result).toBe('my-app');
    expect(p.text).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Project name?',
      defaultValue: 'default-app',
    }));
  });

  it('handles select type with options', async () => {
    vi.mocked(p.select).mockResolvedValue('gaming');
    const step: InterviewStep = {
      id: 'metaphor',
      question: 'Choose metaphor:',
      type: 'select',
      options: [
        { value: 'golf', label: 'Golf', description: 'Classic' },
        { value: 'gaming', label: 'Gaming', description: 'Games' },
      ],
      default: 'golf',
    };
    const result = await renderStep(step, {});
    expect(result).toBe('gaming');
    expect(p.select).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Choose metaphor:',
      initialValue: 'golf',
    }));
  });

  it('handles multiselect with initial values', async () => {
    vi.mocked(p.multiselect).mockResolvedValue(['claude-code', 'cursor']);
    const step: InterviewStep = {
      id: 'platforms',
      question: 'Which platforms?',
      type: 'multiselect',
      options: [
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'cursor', label: 'Cursor' },
      ],
      default: ['claude-code'],
    };
    const result = await renderStep(step, {});
    expect(result).toEqual(['claude-code', 'cursor']);
    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['claude-code'],
    }));
  });

  it('handles confirm type', async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const step: InterviewStep = {
      id: 'deep-analysis',
      question: 'Run analysis?',
      type: 'confirm',
      default: false,
    };
    const result = await renderStep(step, {});
    expect(result).toBe(true);
    expect(p.confirm).toHaveBeenCalledWith(expect.objectContaining({
      initialValue: false,
    }));
  });
});

describe('buildSummary', () => {
  it('includes project name, metaphor, and platforms', () => {
    const summary = buildSummary(
      {
        'project-name': 'My App',
        'metaphor': 'gaming',
        'platforms': ['claude-code', 'cursor'],
        'sprint-number': '5',
      },
      { detected: { detectedPlatforms: [] } },
    );
    expect(summary).toContain('My App');
    expect(summary).toContain('gaming');
    expect(summary).toContain('claude-code, cursor');
    expect(summary).toContain('5');
  });

  it('handles minimal answers', () => {
    const summary = buildSummary(
      { 'project-name': 'Minimal' },
      { detected: { detectedPlatforms: [] } },
    );
    expect(summary).toContain('Minimal');
    expect(summary).toContain('golf'); // default
  });
});

describe('init command backward compatibility', () => {
  it('non-interactive flag-based init still works after refactor', async () => {
    const { initCommand } = await import('../../src/cli/commands/init.js');

    // Mock process.cwd and process.exit
    const origCwd = process.cwd;
    const origExit = process.exit;
    process.cwd = () => tmpDir;
    process.exit = vi.fn() as never;

    try {
      // Run non-interactive init with --claude-code flag
      // This should not trigger the interactive path
      await initCommand(['--metaphor=golf']);

      // Config should be created
      expect(existsSync(join(tmpDir, '.slope', 'config.json'))).toBe(true);
    } finally {
      process.cwd = origCwd;
      process.exit = origExit;
    }
  });
});

describe('TTY handling', () => {
  it('non-TTY input produces helpful error message', async () => {
    const mod = await import('../../src/cli/commands/init.js');

    const origCwd = process.cwd;
    const origExit = process.exit;
    const origIsTTY = process.stdin.isTTY;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    process.cwd = () => tmpDir;
    // Make process.exit throw so execution actually stops
    process.exit = vi.fn().mockImplementation(() => { throw new Error('EXIT'); }) as never;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      await expect(mod.initCommand(['-i'])).rejects.toThrow('EXIT');
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('TTY'),
      );
    } finally {
      process.cwd = origCwd;
      process.exit = origExit;
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
      consoleError.mockRestore();
    }
  });
});
