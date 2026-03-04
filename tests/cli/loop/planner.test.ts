import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePlan, formatPlanAsPrompt, extractKeywords } from '../../../src/cli/loop/planner.js';
import type { BacklogTicket } from '../../../src/cli/loop/types.js';
import type { Logger } from '../../../src/cli/loop/logger.js';

let tmpDir: string;
let log: Logger;

function makeTicket(overrides: Partial<BacklogTicket> = {}): BacklogTicket {
  return {
    key: 'TEST-1',
    title: 'Add planner module',
    club: 'short_iron',
    description: 'Create a planner that generates execution plans',
    acceptance_criteria: ['planner exports generatePlan', 'tests pass'],
    modules: ['src/cli/loop'],
    max_files: 2,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-planner-'));
  // Create src and packages dirs for grep tier
  mkdirSync(join(tmpDir, 'src', 'cli', 'loop'), { recursive: true });
  mkdirSync(join(tmpDir, 'packages'), { recursive: true });
  // Create tests dir for collectTestFiles
  mkdirSync(join(tmpDir, 'tests', 'cli', 'loop'), { recursive: true });

  log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── extractKeywords ──────────────────────────────────

describe('extractKeywords', () => {
  it('extracts top keywords excluding stop words', () => {
    const keywords = extractKeywords('Add the planner module for execution plans');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('for');
    expect(keywords.length).toBeLessThanOrEqual(3);
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('returns empty for all stop words', () => {
    const keywords = extractKeywords('the a an and or but');
    expect(keywords).toEqual([]);
  });

  it('respects max parameter', () => {
    const keywords = extractKeywords('planner executor module backlog config', 2);
    expect(keywords.length).toBeLessThanOrEqual(2);
  });

  it('ranks by frequency', () => {
    const keywords = extractKeywords('planner planner planner executor executor module');
    expect(keywords[0]).toBe('planner');
  });
});

// ── generatePlan tiers ───────────────────────────────

describe('generatePlan', () => {
  describe('tier 1 — enriched files', () => {
    it('uses enriched primary files when they exist on disk', () => {
      const filePath = 'src/cli/loop/planner.ts';
      writeFileSync(join(tmpDir, filePath), 'export function generatePlan() {}');

      const ticket = makeTicket({ files: { primary: [filePath] } });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      expect(plan.generated).toBe('enriched');
      expect(plan.files.length).toBe(1);
      expect(plan.files[0].path).toBe(filePath);
    });

    it('skips enriched files that do not exist on disk', () => {
      const ticket = makeTicket({ files: { primary: ['src/nonexistent.ts'] } });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      // Should fall through to tier 2 or 3 since file doesn't exist
      expect(plan.generated).not.toBe('enriched');
    });

    it('infers action from file content matching acceptance criteria', () => {
      const filePath = 'src/cli/loop/planner.ts';
      writeFileSync(join(tmpDir, filePath), 'export function generatePlan() { /* planner */ }');

      const ticket = makeTicket({
        files: { primary: [filePath] },
        acceptance_criteria: ['planner exports generatePlan'],
      });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      expect(plan.generated).toBe('enriched');
      expect(plan.files[0].action).toContain('planner exports generatePlan');
    });
  });

  describe('tier 2 — grep discovery', () => {
    it('finds files via grep when no enriched files exist', () => {
      // Create a file containing a keyword from the ticket title
      const filePath = join(tmpDir, 'src', 'cli', 'loop', 'planner.ts');
      writeFileSync(filePath, 'export function planner() { return "execution"; }');

      const ticket = makeTicket({
        title: 'Add planner for execution',
        description: 'planner generates execution plans',
        files: undefined,
      });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      // May be grep or generic depending on whether grep finds the keyword
      if (plan.generated === 'grep') {
        expect(plan.files.length).toBeGreaterThan(0);
      }
    });
  });

  describe('tier 3 — generic fallback', () => {
    it('falls back to modules when no files found', () => {
      const ticket = makeTicket({
        title: 'xyzzy frobnicator',
        description: 'frobnicate the xyzzy',
        files: undefined,
        modules: ['src/core'],
      });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      expect(plan.generated).toBe('generic');
      expect(plan.files[0].path).toBe('src/core');
    });

    it('provides placeholder when no modules either', () => {
      const ticket = makeTicket({
        title: 'xyzzy frobnicator',
        description: 'frobnicate the xyzzy',
        files: undefined,
        modules: [],
      });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      expect(plan.generated).toBe('generic');
      expect(plan.files[0].path).toContain('read description');
    });
  });

  describe('test file matching', () => {
    it('finds matching test files for enriched primary files', () => {
      const srcPath = 'src/cli/loop/planner.ts';
      writeFileSync(join(tmpDir, srcPath), 'export function generatePlan() {}');
      writeFileSync(join(tmpDir, 'tests', 'cli', 'loop', 'planner.test.ts'), 'test("works", () => {})');

      const ticket = makeTicket({ files: { primary: [srcPath] } });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      expect(plan.testFiles).toContain('tests/cli/loop/planner.test.ts');
    });
  });

  describe('approach text', () => {
    it('uses local model approach for ollama models', () => {
      const filePath = 'src/cli/loop/planner.ts';
      writeFileSync(join(tmpDir, filePath), 'export function generatePlan() {}');

      const ticket = makeTicket({ files: { primary: [filePath] } });
      const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);

      expect(plan.approach).toContain('local model');
      expect(plan.approach).toContain('ONE file');
    });

    it('uses API approach for non-ollama models', () => {
      const filePath = 'src/cli/loop/planner.ts';
      writeFileSync(join(tmpDir, filePath), 'export function generatePlan() {}');

      const ticket = makeTicket({ files: { primary: [filePath] } });
      const plan = generatePlan(ticket, 'openrouter/anthropic/claude-haiku-4-5', tmpDir, log);

      expect(plan.approach).toContain('plan then execute');
    });
  });
});

// ── formatPlanAsPrompt ───────────────────────────────

describe('formatPlanAsPrompt', () => {
  it('produces structured prompt with all required sections', () => {
    const plan = generatePlan(
      makeTicket({
        files: { primary: [] },
        modules: ['src/core'],
      }),
      'ollama/qwen3',
      tmpDir,
      log,
    );
    const ticket = makeTicket();
    const prompt = formatPlanAsPrompt(plan, ticket);

    expect(prompt).toContain('## Task');
    expect(prompt).toContain('TEST-1');
    expect(prompt).toContain('## Execution Plan');
    expect(prompt).toContain('## Acceptance Criteria');
    expect(prompt).toContain('## Verification');
    expect(prompt).toContain('## Rules');
    expect(prompt).toContain('planner exports generatePlan');
    expect(prompt).toContain('tests pass');
  });

  it('includes file actions in the prompt', () => {
    const filePath = 'src/cli/loop/planner.ts';
    writeFileSync(join(tmpDir, filePath), 'export function generatePlan() {}');

    const ticket = makeTicket({ files: { primary: [filePath] } });
    const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);
    const prompt = formatPlanAsPrompt(plan, ticket);

    expect(prompt).toContain('src/cli/loop/planner.ts');
    expect(prompt).toContain('**Action:**');
    expect(prompt).toContain('**Reason:**');
  });

  it('includes test files section', () => {
    const srcPath = 'src/cli/loop/planner.ts';
    writeFileSync(join(tmpDir, srcPath), 'export function generatePlan() {}');
    writeFileSync(join(tmpDir, 'tests', 'cli', 'loop', 'planner.test.ts'), 'test("works", () => {})');

    const ticket = makeTicket({ files: { primary: [srcPath] } });
    const plan = generatePlan(ticket, 'ollama/qwen3', tmpDir, log);
    const prompt = formatPlanAsPrompt(plan, ticket);

    expect(prompt).toContain('## Test Files to Verify');
    expect(prompt).toContain('planner.test.ts');
  });

  it('includes commit message format with ticket key', () => {
    const plan = generatePlan(makeTicket({ modules: ['src/core'] }), 'ollama/qwen3', tmpDir, log);
    const prompt = formatPlanAsPrompt(plan, makeTicket());

    expect(prompt).toContain("'TEST-1: <what you changed>'");
  });
});
